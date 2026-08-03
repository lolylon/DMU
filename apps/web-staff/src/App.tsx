import { FormEvent, useEffect, useMemo, useState } from 'react';
import { VideoRoom } from './VideoRoom';
import { createCmsSignatureFromBase64 } from './ncalayer';

type Membership = { organizationId: string; role: string };
type User = {
  id: string;
  email: string | null;
  displayName: string;
  totpEnabled: boolean;
  memberships: Membership[];
};

type CaseRow = {
  id: string;
  status: string;
  mode: string;
  createdAt: string;
  patient: { id: string; fullName: string };
  activeAppointment: null | {
    id: string;
    startsAt: string;
    endsAt: string;
    consultantUserId: string;
  };
};

type CaseDetail = CaseRow & {
  statusHistory: Array<{
    id: string;
    fromStatus: string | null;
    toStatus: string;
    reason: string | null;
    createdAt: string;
  }>;
};

type Conclusion = {
  id: string;
  status: string;
  complaints: string;
  anamnesis: string;
  examination: string;
  conclusionText: string;
  recommendations: string;
  authorPosition: string;
  versions?: Array<{
    id: string;
    versionNumber: number;
    contentHash: string;
    signedAt: string | null;
  }>;
};

type QueueItem = Conclusion & {
  case: { id: string; status: string; patient: { fullName: string } };
};

const tokenKey = 'miru_staff_token';
const CONSULTANT_IIN_HINT = '880101300000';

async function api<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message ?? data?.error ?? res.statusText;
    throw new Error(Array.isArray(msg) ? msg.join(', ') : String(msg));
  }
  return data as T;
}

export function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(tokenKey));
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('consultant@pilot.miru.local');
  const [password, setPassword] = useState('ChangeMeNow!99');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [media, setMedia] = useState<null | {
    sessionId: string;
    livekitUrl: string;
    token: string;
  }>(null);
  const [chatText, setChatText] = useState('');
  const [chat, setChat] = useState<Array<{ id: string; body: string; authorId: string }>>([]);
  const [conclusion, setConclusion] = useState<Conclusion | null>(null);
  const [draft, setDraft] = useState({
    complaints: '',
    anamnesis: '',
    examination: '',
    conclusionText: '',
    recommendations: '',
    authorPosition: 'Врач-консультант',
  });
  const [signerIin, setSignerIin] = useState(CONSULTANT_IIN_HINT);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [tab, setTab] = useState<'cases' | 'sign' | 'dash' | 'registry' | 'queue'>('cases');
  const [profileQueue, setProfileQueue] = useState<
    Array<{
      id: string;
      profileCode: string;
      status: string;
      case: { id: string; status: string; patient: { fullName: string } };
    }>
  >([]);
  const [participantUserId, setParticipantUserId] = useState('');
  const [profileCodeClaim, setProfileCodeClaim] = useState('therapy');
  const [dashboard, setDashboard] = useState<null | {
    organization: { nameRu: string; misMode: string };
    casesByStatus: Record<string, number>;
    readyToSign: number;
    pendingMisEntry: number;
    closedToday: number;
  }>(null);
  const [registry, setRegistry] = useState<null | {
    day: string;
    totals: { rendered: number; enteredInMis: number; pending: number };
    rows: Array<{
      caseId: string;
      patientName: string;
      caseStatus: string;
      referralNumber: string | null;
      enteredInMis: boolean;
    }>;
  }>(null);
  const [registryDay, setRegistryDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [referral, setReferral] = useState('');
  const [bridge, setBridge] = useState<null | {
    misMode: string;
    entry: null | { referralNumber: string | null; enteredInMis: boolean };
  }>(null);

  const orgId = useMemo(() => user?.memberships[0]?.organizationId ?? null, [user]);

  async function login(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await api<{ accessToken: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, totpCode: totpCode || undefined }),
      });
      localStorage.setItem(tokenKey, res.accessToken);
      setToken(res.accessToken);
      setUser(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    if (token) {
      try {
        await api('/api/auth/logout', { method: 'POST' }, token);
      } catch {
        /* ignore */
      }
    }
    localStorage.removeItem(tokenKey);
    setToken(null);
    setUser(null);
    setCases([]);
    setDetail(null);
    setConclusion(null);
  }

  async function refreshCases(t: string, organizationId: string) {
    const rows = await api<CaseRow[]>(`/api/cases?organizationId=${organizationId}`, {}, t);
    setCases(rows);
  }

  async function loadConclusion(t: string, caseId: string) {
    const c = await api<Conclusion | null>(`/api/conclusions/cases/${caseId}`, {}, t);
    setConclusion(c);
    if (c) {
      setDraft({
        complaints: c.complaints,
        anamnesis: c.anamnesis,
        examination: c.examination,
        conclusionText: c.conclusionText,
        recommendations: c.recommendations,
        authorPosition: c.authorPosition || 'Врач-консультант',
      });
    }
  }

  async function loadQueue(t: string, organizationId: string) {
    const rows = await api<QueueItem[]>(`/api/conclusions/queue?organizationId=${organizationId}`, {}, t);
    setQueue(rows);
  }

  useEffect(() => {
    if (!token || !orgId) return;
    setLoading(true);
    refreshCases(token, orgId)
      .catch((err) => setError(err instanceof Error ? err.message : 'Load failed'))
      .finally(() => setLoading(false));
  }, [token, orgId]);

  useEffect(() => {
    if (!token || !selectedId) {
      setDetail(null);
      setConclusion(null);
      return;
    }
    Promise.all([
      api<CaseDetail>(`/api/cases/${selectedId}`, {}, token),
      loadConclusion(token, selectedId),
    ])
      .then(([d]) => setDetail(d))
      .catch((err) => setError(err instanceof Error ? err.message : 'Case load failed'));
  }, [token, selectedId]);

  useEffect(() => {
    if (!token || !orgId || tab !== 'sign') return;
    loadQueue(token, orgId).catch((err) => setError(err instanceof Error ? err.message : 'Queue failed'));
  }, [token, orgId, tab]);

  useEffect(() => {
    if (!token || !orgId || tab !== 'dash') return;
    api<NonNullable<typeof dashboard>>(`/api/mis/dashboard?organizationId=${orgId}`, {}, token)
      .then(setDashboard)
      .catch((err) => setError(err instanceof Error ? err.message : 'Dashboard failed'));
  }, [token, orgId, tab]);

  useEffect(() => {
    if (!token || !orgId || tab !== 'queue') return;
    api<typeof profileQueue>(
      `/api/scheduling/queue?organizationId=${orgId}&profileCode=${profileCodeClaim}`,
      {},
      token,
    )
      .then(setProfileQueue)
      .catch((err) => setError(err instanceof Error ? err.message : 'Queue failed'));
  }, [token, orgId, tab, profileCodeClaim]);

  useEffect(() => {
    if (!token || !orgId || tab !== 'registry') return;
    api<NonNullable<typeof registry>>(
      `/api/mis/registry?organizationId=${orgId}&day=${registryDay}`,
      {},
      token,
    )
      .then(setRegistry)
      .catch((err) => setError(err instanceof Error ? err.message : 'Registry failed'));
  }, [token, orgId, tab, registryDay]);

  useEffect(() => {
    if (!token || !selectedId || tab !== 'cases') return;
    api<{
      misMode: string;
      entry: null | { referralNumber: string | null; enteredInMis: boolean };
    }>(`/api/mis/cases/${selectedId}`, {}, token)
      .then((b) => {
        setBridge(b);
        setReferral(b.entry?.referralNumber ?? '');
      })
      .catch(() => setBridge(null));
  }, [token, selectedId, tab, conclusion?.status, detail?.status]);

  async function saveDraft() {
    if (!token || !selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const c = await api<Conclusion>(
        `/api/conclusions/cases/${selectedId}/draft`,
        { method: 'POST', body: JSON.stringify(draft) },
        token,
      );
      setConclusion(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setLoading(false);
    }
  }

  async function submitSign() {
    if (!token || !selectedId) return;
    setLoading(true);
    setError(null);
    try {
      await api<Conclusion>(
        `/api/conclusions/cases/${selectedId}/draft`,
        { method: 'POST', body: JSON.stringify(draft) },
        token,
      );
      const c = await api<Conclusion>(
        `/api/conclusions/cases/${selectedId}/submit`,
        { method: 'POST' },
        token,
      );
      setConclusion(c);
      const d = await api<CaseDetail>(`/api/cases/${selectedId}`, {}, token);
      setDetail(d);
      if (orgId) await refreshCases(token, orgId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    } finally {
      setLoading(false);
    }
  }

  async function signWithNca(caseId: string) {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const challenge = await api<{
        contentBase64: string;
        contentHash: string;
        versionNumber: number;
      }>(`/api/conclusions/cases/${caseId}/sign-challenge`, { method: 'POST' }, token);
      const cmsBase64 = await createCmsSignatureFromBase64(challenge.contentBase64);
      await api(
        `/api/conclusions/cases/${caseId}/sign`,
        {
          method: 'POST',
          body: JSON.stringify({
            cmsBase64,
            signerIin,
            contentHash: challenge.contentHash,
            versionNumber: challenge.versionNumber,
          }),
        },
        token,
      );
      if (selectedId === caseId) {
        await loadConclusion(token, caseId);
        setDetail(await api<CaseDetail>(`/api/cases/${caseId}`, {}, token));
      }
      if (orgId) {
        await refreshCases(token, orgId);
        await loadQueue(token, orgId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'NCALayer sign failed');
    } finally {
      setLoading(false);
    }
  }

  async function signDev(caseId: string) {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      await api(
        `/api/conclusions/cases/${caseId}/sign-dev`,
        { method: 'POST', body: JSON.stringify({ signerIin }) },
        token,
      );
      if (selectedId === caseId) {
        await loadConclusion(token, caseId);
        setDetail(await api<CaseDetail>(`/api/cases/${caseId}`, {}, token));
      }
      if (orgId) {
        await refreshCases(token, orgId);
        await loadQueue(token, orgId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dev sign failed');
    } finally {
      setLoading(false);
    }
  }

  if (!token || !user) {
    return (
      <main className="shell">
        <p className="brand">Miru Remote</p>
        <h1>Вход медработника</h1>
        <p className="lead">
          Логин + пароль + TOTP. Секрет: <code>POST /api/bootstrap/demo</code> → поле{' '}
          <code>consultant.totpSecret</code> в Google Authenticator (Time-based).
        </p>
        <form className="form" onSubmit={login}>
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </label>
          <label>
            Пароль
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label>
            Код 2FA
            <input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} inputMode="numeric" />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? 'Вход…' : 'Войти'}
          </button>
        </form>
      </main>
    );
  }

  const canEditConclusion =
    detail &&
    (detail.status === 'AWAITING_CONCLUSION' || detail.status === 'AWAITING_SIGNATURE') &&
    conclusion?.status !== 'SIGNED' &&
    conclusion?.status !== 'DELIVERED';

  return (
    <main className="app">
      <header className="top">
        <div>
          <p className="brand">Miru Remote</p>
          <strong>{user.displayName}</strong>
          <span className="muted"> · {user.memberships.map((m) => m.role).join(', ')}</span>
        </div>
        <div className="tabs">
          <button type="button" className={tab === 'cases' ? 'tab active' : 'tab'} onClick={() => setTab('cases')}>
            Случаи
          </button>
          <button type="button" className={tab === 'sign' ? 'tab active' : 'tab'} onClick={() => setTab('sign')}>
            К подписи
          </button>
          <button type="button" className={tab === 'queue' ? 'tab active' : 'tab'} onClick={() => setTab('queue')}>
            Очередь профиля
          </button>
          <button type="button" className={tab === 'dash' ? 'tab active' : 'tab'} onClick={() => setTab('dash')}>
            Дашборд
          </button>
          <button
            type="button"
            className={tab === 'registry' ? 'tab active' : 'tab'}
            onClick={() => setTab('registry')}
          >
            Реестр МИС
          </button>
          <button type="button" className="ghost" onClick={logout}>
            Выйти
          </button>
        </div>
      </header>

      {error && <p className="error banner">{error}</p>}

      {tab === 'queue' && (
        <section className="panel">
          <h2>FIFO очередь по профилю</h2>
          <label className="inline">
            Профиль
            <input value={profileCodeClaim} onChange={(e) => setProfileCodeClaim(e.target.value)} />
          </label>
          <button
            type="button"
            disabled={loading}
            onClick={async () => {
              if (!token || !orgId) return;
              setLoading(true);
              try {
                const res = await api<{ empty: boolean; item?: { case: { id: string } } }>(
                  '/api/scheduling/queue/claim',
                  {
                    method: 'POST',
                    body: JSON.stringify({ organizationId: orgId, profileCode: profileCodeClaim }),
                  },
                  token,
                );
                if (res.empty) setError('Очередь пуста');
                else if (res.item) {
                  setSelectedId(res.item.case.id);
                  setTab('cases');
                }
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Claim failed');
              } finally {
                setLoading(false);
              }
            }}
          >
            Взять следующий (FIFO)
          </button>
          <ul className="list">
            {profileQueue.map((q) => (
              <li key={q.id} className="queue-row">
                <div>
                  <strong>{q.case.patient.fullName}</strong>
                  <span className="muted">
                    {' '}
                    · {q.profileCode} · {q.status}
                  </span>
                </div>
                <button type="button" className="ghost" onClick={() => { setSelectedId(q.case.id); setTab('cases'); }}>
                  Открыть
                </button>
              </li>
            ))}
            {profileQueue.length === 0 && <li className="muted">Нет заявок в очереди</li>}
          </ul>
        </section>
      )}

      {tab === 'dash' && dashboard && (
        <section className="panel">
          <h2>Дашборд МО — {dashboard.organization.nameRu}</h2>
          <p className="muted">Режим МИС: {dashboard.organization.misMode}</p>
          <ul className="stats">
            <li>Закрыто сегодня: <strong>{dashboard.closedToday}</strong></li>
            <li>К подписи: <strong>{dashboard.readyToSign}</strong></li>
            <li>Не внесено в МИС: <strong>{dashboard.pendingMisEntry}</strong></li>
          </ul>
          <h3>По статусам</h3>
          <ul className="list">
            {Object.entries(dashboard.casesByStatus).map(([st, n]) => (
              <li key={st}>
                <span className="badge">{st}</span> {n}
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'registry' && (
        <section className="panel">
          <h2>Реестр «оказано vs внесено»</h2>
          <label className="inline">
            День
            <input type="date" value={registryDay} onChange={(e) => setRegistryDay(e.target.value)} />
          </label>
          {registry && (
            <>
              <p>
                Оказано: <strong>{registry.totals.rendered}</strong> · внесено:{' '}
                <strong>{registry.totals.enteredInMis}</strong> · ожидает:{' '}
                <strong>{registry.totals.pending}</strong>
              </p>
              <ul className="list">
                {registry.rows.map((r) => (
                  <li key={r.caseId} className="queue-row">
                    <div>
                      <strong>{r.patientName}</strong>
                      <span className="muted">
                        {' '}
                        · {r.referralNumber ?? 'без направления'} · {r.caseStatus}
                      </span>
                    </div>
                    <span className="badge">{r.enteredInMis ? 'в МИС' : 'ожидает'}</span>
                  </li>
                ))}
                {registry.rows.length === 0 && <li className="muted">Нет записей за день</li>}
              </ul>
            </>
          )}
        </section>
      )}

      {tab === 'sign' && (
        <section className="panel">
          <h2>Очередь на подпись (NCALayer)</h2>
          <p className="muted">Пакетная подпись по ТЗ 9.3.5. ИИН в сертификате должен совпасть с учётной записью.</p>
          <label className="inline">
            ИИН подписанта
            <input value={signerIin} onChange={(e) => setSignerIin(e.target.value)} maxLength={12} />
          </label>
          <ul className="list">
            {queue.map((q) => (
              <li key={q.id} className="queue-row">
                <div>
                  <strong>{q.case.patient.fullName}</strong>
                  <span className="muted"> · {q.case.id.slice(0, 8)}…</span>
                </div>
                <div className="actions">
                  <button type="button" disabled={loading} onClick={() => signWithNca(q.case.id)}>
                    NCALayer
                  </button>
                  <button type="button" className="ghost" disabled={loading} onClick={() => signDev(q.case.id)}>
                    Dev-подпись
                  </button>
                </div>
              </li>
            ))}
            {queue.length === 0 && <li className="muted">Очередь пуста</li>}
          </ul>
        </section>
      )}

      {tab === 'cases' && (
        <div className="layout">
          <section className="panel">
            <h2>Случаи МО</h2>
            {loading && <p className="muted">Загрузка…</p>}
            <ul className="list">
              {cases.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={selectedId === c.id ? 'row active' : 'row'}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <span>{c.patient.fullName}</span>
                    <span className="badge">{c.status}</span>
                  </button>
                </li>
              ))}
              {!loading && cases.length === 0 && <li className="muted">Пока нет случаев</li>}
            </ul>
          </section>

          <section className="panel">
            <h2>Карточка случая</h2>
            {!detail && <p className="muted">Выберите случай слева</p>}
            {detail && (
              <div className="detail">
                <p>
                  <strong>{detail.patient.fullName}</strong>
                </p>
                <p className="muted">ID: {detail.id}</p>
                <p>
                  Статус: <span className="badge">{detail.status}</span> · режим {detail.mode}
                </p>
                {detail.activeAppointment && (
                  <p>
                    Слот:{' '}
                    {new Date(detail.activeAppointment.startsAt).toLocaleString('ru-KZ', {
                      timeZone: 'Asia/Almaty',
                    })}
                  </p>
                )}

                {(detail.status === 'BOOKED' || detail.status === 'IN_SESSION') && (
                  <div className="session-box">
                    <h3>Видеосессия</h3>
                    <p className="muted">Старт только при доступной записи (ТЗ 6.3.3).</p>
                    {!media && (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={async () => {
                          if (!token) return;
                          setLoading(true);
                          setError(null);
                          try {
                            const res = await api<{
                              sessionId: string;
                              livekitUrl: string;
                              token: string;
                            }>(`/api/sessions/cases/${detail.id}/start`, { method: 'POST' }, token);
                            setMedia({
                              sessionId: res.sessionId,
                              livekitUrl: res.livekitUrl,
                              token: res.token,
                            });
                            const msgs = await api<Array<{ id: string; body: string; authorId: string }>>(
                              `/api/sessions/${res.sessionId}/chat`,
                              {},
                              token,
                            );
                            setChat(msgs);
                            const d = await api<CaseDetail>(`/api/cases/${detail.id}`, {}, token);
                            setDetail(d);
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'Session start failed');
                          } finally {
                            setLoading(false);
                          }
                        }}
                      >
                        Начать / войти в сессию
                      </button>
                    )}
                    {media && (
                      <>
                        <VideoRoom
                          livekitUrl={media.livekitUrl}
                          token={media.token}
                          onLeave={() => setMedia(null)}
                        />
                        <div className="chat">
                          <h4>Чат сессии</h4>
                          <ul>
                            {chat.map((m) => (
                              <li key={m.id}>
                                <span className="muted">{m.authorId.slice(0, 6)}</span>: {m.body}
                              </li>
                            ))}
                          </ul>
                          <form
                            onSubmit={async (e) => {
                              e.preventDefault();
                              if (!token || !media || !chatText.trim()) return;
                              const msg = await api<{ id: string; body: string; authorId: string }>(
                                `/api/sessions/${media.sessionId}/chat`,
                                { method: 'POST', body: JSON.stringify({ body: chatText }) },
                                token,
                              );
                              setChat((c) => [...c, msg]);
                              setChatText('');
                            }}
                          >
                            <input value={chatText} onChange={(e) => setChatText(e.target.value)} />
                            <button type="submit">Отправить</button>
                          </form>
                        </div>
                        <button
                          type="button"
                          className="ghost"
                          onClick={async () => {
                            if (!token || !media) return;
                            await api(`/api/sessions/${media.sessionId}/end`, { method: 'POST' }, token);
                            setMedia(null);
                            const d = await api<CaseDetail>(`/api/cases/${detail.id}`, {}, token);
                            setDetail(d);
                            await loadConclusion(token, detail.id);
                          }}
                        >
                          Завершить сессию (запись + заключение)
                        </button>
                      </>
                    )}
                  </div>
                )}

                {(detail.status === 'AWAITING_CONCLUSION' ||
                  detail.status === 'AWAITING_SIGNATURE' ||
                  detail.status === 'AWAITING_PATIENT_DELIVERY' ||
                  detail.status === 'CLOSED' ||
                  conclusion) && (
                  <div className="session-box">
                    <h3>Заключение</h3>
                    {conclusion && (
                      <p>
                        Статус заключения: <span className="badge">{conclusion.status}</span>
                      </p>
                    )}
                    {canEditConclusion && (
                      <div className="conclusion-form">
                        {(
                          [
                            ['complaints', 'Жалобы'],
                            ['anamnesis', 'Анамнез'],
                            ['examination', 'Осмотр / данные'],
                            ['conclusionText', 'Заключение'],
                            ['recommendations', 'Рекомендации'],
                            ['authorPosition', 'Должность'],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key}>
                            {label}
                            <textarea
                              rows={key === 'authorPosition' ? 1 : 3}
                              value={draft[key]}
                              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                            />
                          </label>
                        ))}
                        <div className="actions">
                          <button type="button" disabled={loading} onClick={saveDraft}>
                            Сохранить черновик
                          </button>
                          <button type="button" disabled={loading} onClick={submitSign}>
                            К подписи
                          </button>
                        </div>
                      </div>
                    )}
                    {conclusion?.status === 'READY_TO_SIGN' && (
                      <div className="actions">
                        <label className="inline">
                          ИИН
                          <input value={signerIin} onChange={(e) => setSignerIin(e.target.value)} maxLength={12} />
                        </label>
                        <button type="button" disabled={loading} onClick={() => signWithNca(detail.id)}>
                          Подписать NCALayer
                        </button>
                        <button type="button" className="ghost" disabled={loading} onClick={() => signDev(detail.id)}>
                          Dev-подпись
                        </button>
                      </div>
                    )}
                    {conclusion?.versions && conclusion.versions.length > 0 && (
                      <ol className="history">
                        {conclusion.versions.map((v) => (
                          <li key={v.id}>
                            v{v.versionNumber} · {v.contentHash.slice(0, 12)}…
                            {v.signedAt && (
                              <span className="muted">
                                {' '}
                                ·{' '}
                                {new Date(v.signedAt).toLocaleString('ru-KZ', { timeZone: 'Asia/Almaty' })}
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                    {(conclusion?.status === 'SIGNED' || conclusion?.status === 'DELIVERED') && (
                      <button
                        type="button"
                        className="ghost"
                        onClick={async () => {
                          if (!token) return;
                          const doc = await api<{ url: string }>(
                            `/api/conclusions/cases/${detail.id}/document`,
                            {},
                            token,
                          );
                          window.open(doc.url, '_blank');
                        }}
                      >
                        Открыть печатную форму
                      </button>
                    )}
                  </div>
                )}

                <div className="session-box">
                  <h3>Участники и async</h3>
                  {detail.mode === 'ASYNC' && detail.status !== 'AWAITING_CONCLUSION' && detail.status !== 'CLOSED' && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={async () => {
                        if (!token) return;
                        setLoading(true);
                        try {
                          await api(`/api/cases/${detail.id}/async/submit`, { method: 'POST' }, token);
                          setDetail(await api<CaseDetail>(`/api/cases/${detail.id}`, {}, token));
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Async submit failed');
                        } finally {
                          setLoading(false);
                        }
                      }}
                    >
                      Async → к заключению (без видео)
                    </button>
                  )}
                  <div className="actions">
                    <input
                      placeholder="userId участника (ВА)"
                      value={participantUserId}
                      onChange={(e) => setParticipantUserId(e.target.value)}
                    />
                    <button
                      type="button"
                      className="ghost"
                      disabled={loading || !participantUserId}
                      onClick={async () => {
                        if (!token) return;
                        await api(
                          `/api/cases/${detail.id}/participants`,
                          {
                            method: 'POST',
                            body: JSON.stringify({
                              userId: participantUserId,
                              role: 'AMBULATORY_WORKER',
                            }),
                          },
                          token,
                        );
                        setDetail(await api<CaseDetail>(`/api/cases/${detail.id}`, {}, token));
                      }}
                    >
                      Добавить ВА (сценарий B)
                    </button>
                  </div>
                </div>

                <div className="session-box">
                  <h3>Досье и МИС</h3>
                  <div className="actions">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={async () => {
                        if (!token) return;
                        setLoading(true);
                        try {
                          const d = await api<{
                            url: string;
                            assemblyMs: number;
                            withinSla: boolean;
                            checksumSha256: string;
                          }>(`/api/dossiers/cases/${detail.id}`, { method: 'POST' }, token);
                          window.open(d.url, '_blank');
                          setError(
                            null,
                          );
                          alert(
                            `Досье собрано за ${d.assemblyMs} мс (SLA 60с: ${d.withinSla ? 'OK' : 'FAIL'})\nSHA-256: ${d.checksumSha256.slice(0, 16)}…`,
                          );
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Dossier failed');
                        } finally {
                          setLoading(false);
                        }
                      }}
                    >
                      Собрать досье
                    </button>
                  </div>
                  {bridge && (
                    <div className="conclusion-form">
                      <p className="muted">
                        МИС: {bridge.misMode}
                        {bridge.entry?.enteredInMis ? ' · внесено' : ' · не внесено'}
                      </p>
                      <label>
                        Номер направления
                        <input value={referral} onChange={(e) => setReferral(e.target.value)} />
                      </label>
                      <div className="actions">
                        <button
                          type="button"
                          disabled={loading}
                          onClick={async () => {
                            if (!token) return;
                            await api(
                              `/api/mis/cases/${detail.id}/referral`,
                              { method: 'POST', body: JSON.stringify({ referralNumber: referral }) },
                              token,
                            );
                            const b = await api<NonNullable<typeof bridge>>(
                              `/api/mis/cases/${detail.id}`,
                              {},
                              token,
                            );
                            setBridge(b);
                          }}
                        >
                          Сохранить направление
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          disabled={loading}
                          onClick={async () => {
                            if (!token) return;
                            await api(`/api/mis/cases/${detail.id}/entered`, { method: 'POST' }, token);
                            const b = await api<NonNullable<typeof bridge>>(
                              `/api/mis/cases/${detail.id}`,
                              {},
                              token,
                            );
                            setBridge(b);
                          }}
                        >
                          Отметить внесено в МИС
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <h3>История статусов</h3>
                <ol className="history">
                  {detail.statusHistory.map((h) => (
                    <li key={h.id}>
                      {h.fromStatus ?? '∅'} → <strong>{h.toStatus}</strong>
                      {h.reason ? ` (${h.reason})` : ''}
                      <span className="muted">
                        {' '}
                        · {new Date(h.createdAt).toLocaleString('ru-KZ', { timeZone: 'Asia/Almaty' })}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

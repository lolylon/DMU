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

const statusRu: Record<string, string> = {
  CREATED: 'Создан',
  AWAITING_CONSENT: 'Нужны согласия',
  AWAITING_BOOKING: 'Выберите время',
  BOOKED: 'Запись оформлена',
  IN_SESSION: 'Идёт консультация',
  AWAITING_CONCLUSION: 'Ждём заключение',
  AWAITING_SIGNATURE: 'На подписи',
  AWAITING_PATIENT_DELIVERY: 'Заключение готово',
  CLOSED: 'Закрыт',
  CANCELLED: 'Отменён',
  RESCHEDULED: 'Перенос',
};

function labelStatus(s: string) {
  return statusRu[s] ?? s;
}

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
  const [tab, setTab] = useState<'cases' | 'sign' | 'sos'>('cases');
  const [emergencies, setEmergencies] = useState<
    Array<{
      id: string;
      createdAt: string;
      note: string | null;
      device: { label: string; deviceCode: string };
    }>
  >([]);

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
    if (!token || !orgId || tab !== 'sos') return;
    const load = () =>
      api<typeof emergencies>(`/api/frontdesk/emergencies?organizationId=${orgId}`, {}, token)
        .then(setEmergencies)
        .catch((err) => setError(err instanceof Error ? err.message : 'SOS failed'));
    void load();
    const id = window.setInterval(() => void load(), 8000);
    return () => clearInterval(id);
  }, [token, orgId, tab]);

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

  if (!token || !user) {
    return (
      <main className="shell">
        <p className="brand">Miru Remote</p>
        <h1>Вход медработника</h1>
        <p className="lead">Email, пароль и код из Authenticator.</p>
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
        </div>
        <div className="tabs">
          <button type="button" className={tab === 'cases' ? 'tab active' : 'tab'} onClick={() => setTab('cases')}>
            Случаи
          </button>
          <button type="button" className={tab === 'sign' ? 'tab active' : 'tab'} onClick={() => setTab('sign')}>
            К подписи
          </button>
          <button type="button" className={tab === 'sos' ? 'tab active' : 'tab'} onClick={() => setTab('sos')}>
            SOS киоск
          </button>
          <button type="button" className="ghost" onClick={logout}>
            Выйти
          </button>
        </div>
      </header>

      {error && <p className="error banner">{error}</p>}

      {tab === 'sos' && (
        <section className="panel">
          <h2>Экстренные вызовы с киосков</h2>
          <p className="muted">Открытые вызовы с киосков</p>
          <ul className="list">
            {emergencies.map((e) => (
              <li key={e.id} className="queue-row">
                <div>
                  <strong>{e.device.label}</strong>
                  <span className="muted">
                    {' '}
                    · {e.device.deviceCode} · {new Date(e.createdAt).toLocaleString('ru-KZ')}
                  </span>
                  {e.note && <div className="muted">{e.note}</div>}
                </div>
                <button
                  type="button"
                  disabled={loading}
                  onClick={async () => {
                    if (!token) return;
                    setLoading(true);
                    try {
                      await api(`/api/frontdesk/emergencies/${e.id}/ack`, { method: 'POST' }, token);
                      setEmergencies((prev) => prev.filter((x) => x.id !== e.id));
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Ack failed');
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  Принято
                </button>
              </li>
            ))}
          </ul>
          {!emergencies.length && <p className="muted">Открытых вызовов нет</p>}
        </section>
      )}

      {tab === 'sign' && (
        <section className="panel">
          <h2>Очередь на подпись</h2>
          <p className="muted">Подпись через NCALayer</p>
          <label className="inline">
            ИИН подписанта
            <input value={signerIin} onChange={(e) => setSignerIin(e.target.value)} maxLength={12} />
          </label>
          <ul className="list">
            {queue.map((q) => (
              <li key={q.id} className="queue-row">
                <div>
                  <strong>{q.case.patient.fullName}</strong>
                </div>
                <div className="actions">
                  <button type="button" disabled={loading} onClick={() => signWithNca(q.case.id)}>
                    NCALayer
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
                    <span className="badge">{labelStatus(c.status)}</span>
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
                <p>
                  Статус: <span className="badge">{labelStatus(detail.status)}</span> ·{' '}
                  {detail.mode === 'REALTIME' ? 'Онлайн' : detail.mode}
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
                    <p className="muted">Видеосвязь с пациентом</p>
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
                                <span className="muted">Участник</span>: {m.body}
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
                      </div>
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
              </div>
            )}
          </section>
        </div>
      )}
    </main>
  );
}

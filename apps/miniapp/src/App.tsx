import { FormEvent, useEffect, useState } from 'react';
import { VideoRoom } from './VideoRoom';

type CaseRow = {
  id: string;
  status: string;
  mode: string;
  activeAppointment: null | { id: string; startsAt: string; endsAt: string };
};

type ConsentDoc = {
  id: string;
  kind: string;
  version: string;
  language: string;
  body: string;
};

type CaseDetail = CaseRow & {
  pendingConsents: ConsentDoc[];
  acceptances: Array<{ id: string; method: string }>;
};

type Slot = { id: string; startsAt: string; endsAt: string; consultantUserId: string };

const tokenKey = 'miru_patient_token';

async function api<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message ?? res.statusText;
    throw new Error(Array.isArray(msg) ? msg.join(', ') : String(msg));
  }
  return data as T;
}

type Step = 'auth' | 'list' | 'case' | 'catalog';

export function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(tokenKey));
  const [step, setStep] = useState<Step>(token ? 'list' : 'auth');
  const [iin, setIin] = useState('900000000009');
  const [code, setCode] = useState('');
  const [debugHint, setDebugHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [catalogOrgs, setCatalogOrgs] = useState<
    Array<{ id: string; nameRu: string; catalogCity: string | null }>
  >([]);
  const [catalogOffers, setCatalogOffers] = useState<
    Array<{ profileCode: string; titleRu: string; durationMin: number; descriptionRu: string }>
  >([]);
  const [catalogOrgName, setCatalogOrgName] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [busy, setBusy] = useState(false);
  const [media, setMedia] = useState<null | { livekitUrl: string; token: string; sessionId: string }>(
    null,
  );
  const [conclusionView, setConclusionView] = useState<null | {
    available: boolean;
    status?: string;
    conclusionText?: string;
    recommendations?: string;
    signedAt?: string | null;
    documentUrl?: string | null;
    deliveredAt?: string | null;
    caseStatus?: string;
  }>(null);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ debugCode?: string; message: string }>('/api/patient/auth/request-code', {
        method: 'POST',
        body: JSON.stringify({ iin }),
      });
      setDebugHint(res.debugCode ? `Код (только dev): ${res.debugCode}` : res.message);
      if (res.debugCode) setCode(res.debugCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api<{ accessToken: string }>('/api/patient/auth/verify', {
        method: 'POST',
        body: JSON.stringify({ iin, code }),
      });
      localStorage.setItem(tokenKey, res.accessToken);
      setToken(res.accessToken);
      setStep('list');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  async function loadCases(t: string) {
    const rows = await api<CaseRow[]>('/api/patient/cases', {}, t);
    setCases(rows);
  }

  useEffect(() => {
    if (!token || step !== 'list') return;
    loadCases(token).catch((err) => setError(err instanceof Error ? err.message : 'Ошибка'));
  }, [token, step]);

  async function openCase(id: string) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api<CaseDetail>(`/api/patient/cases/${id}`, {}, token);
      setDetail(d);
      setStep('case');
      if (d.status === 'AWAITING_BOOKING' || d.status === 'RESCHEDULED') {
        const from = new Date().toISOString();
        const to = new Date(Date.now() + 7 * 86400000).toISOString();
        const s = await api<Slot[]>(`/api/patient/cases/${id}/slots?from=${from}&to=${to}`, {}, token);
        setSlots(s);
      } else {
        setSlots([]);
      }
      if (
        d.status === 'AWAITING_PATIENT_DELIVERY' ||
        d.status === 'CLOSED' ||
        d.status === 'AWAITING_SIGNATURE'
      ) {
        const cv = await api<typeof conclusionView>(`/api/patient/conclusions/${id}`, {}, token);
        setConclusionView(cv);
      } else {
        setConclusionView(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  async function acceptConsent(docId: string) {
    if (!token || !detail) return;
    setBusy(true);
    try {
      await api(`/api/patient/cases/${detail.id}/consents/accept`, {
        method: 'POST',
        body: JSON.stringify({ consentDocumentId: docId, deviceId: 'miniapp-web' }),
      }, token);
      await openCase(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  async function book(slotId: string) {
    if (!token || !detail) return;
    setBusy(true);
    try {
      await api(`/api/patient/cases/${detail.id}/book`, {
        method: 'POST',
        body: JSON.stringify({ slotId }),
      }, token);
      await openCase(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    localStorage.removeItem(tokenKey);
    setToken(null);
    setStep('auth');
    setDetail(null);
    setCases([]);
  }

  if (step === 'catalog') {
    return (
      <main className="shell">
        <button type="button" className="link" onClick={() => setStep('auth')}>
          ← Назад
        </button>
        <p className="brand">Miru</p>
        <h1>Витрина ДМУ</h1>
        <p className="lead">Публичный каталог МО (без ПМД). Запись — после входа по ИИН.</p>
        {error && <p className="error">{error}</p>}
        {!catalogOrgName && (
          <ul className="cards">
            {catalogOrgs.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className="card"
                  onClick={async () => {
                    try {
                      const res = await api<{
                        organization: { nameRu: string };
                        offers: typeof catalogOffers;
                      }>(`/api/catalog/organizations/${o.id}/offers`);
                      setCatalogOffers(res.offers);
                      setCatalogOrgName(res.organization.nameRu);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Ошибка');
                    }
                  }}
                >
                  <strong>{o.nameRu}</strong>
                  {o.catalogCity && <span className="muted">{o.catalogCity}</span>}
                </button>
              </li>
            ))}
            {catalogOrgs.length === 0 && <li className="muted">Нет опубликованных МО</li>}
          </ul>
        )}
        {catalogOrgName && (
          <section>
            <button type="button" className="link" onClick={() => setCatalogOrgName(null)}>
              ← К списку МО
            </button>
            <h2>{catalogOrgName}</h2>
            <ul className="cards">
              {catalogOffers.map((off) => (
                <li key={off.profileCode} className="consent">
                  <h3>{off.titleRu}</h3>
                  <p className="muted">{off.durationMin} мин · {off.profileCode}</p>
                  <p>{off.descriptionRu}</p>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setStep('auth')}>
              Войти и записаться
            </button>
          </section>
        )}
      </main>
    );
  }

  if (step === 'auth') {
    return (
      <main className="shell">
        <p className="brand">Miru</p>
        <h1>Вход пациента</h1>
        <p className="lead">ИИН + код подтверждения (ТЗ 7.1.1). Медицинское содержание в SMS не передаётся.</p>
        <button
          type="button"
          className="link"
          onClick={async () => {
            setError(null);
            try {
              const orgs = await api<typeof catalogOrgs>('/api/catalog/organizations');
              setCatalogOrgs(orgs);
              setCatalogOrgName(null);
              setCatalogOffers([]);
              setStep('catalog');
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Ошибка витрины');
            }
          }}
        >
          Смотреть витрину МО
        </button>
        <form className="form" onSubmit={requestCode}>
          <label>
            ИИН
            <input value={iin} onChange={(e) => setIin(e.target.value)} inputMode="numeric" maxLength={12} />
          </label>
          <button type="submit" disabled={busy}>
            Получить код
          </button>
        </form>
        <form className="form" onSubmit={verify}>
          <label>
            Код из SMS
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
          </label>
          {debugHint && <p className="hint">{debugHint}</p>}
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy || !code}>
            Войти
          </button>
        </form>
      </main>
    );
  }

  if (step === 'list') {
    return (
      <main className="shell">
        <div className="row-between">
          <p className="brand">Miru</p>
          <button type="button" className="link" onClick={logout}>
            Выйти
          </button>
        </div>
        <h1>Мои консультации</h1>
        {error && <p className="error">{error}</p>}
        <ul className="cards">
          {cases.map((c) => (
            <li key={c.id}>
              <button type="button" className="card" onClick={() => openCase(c.id)}>
                <span className="badge">{c.status}</span>
                <span>{c.mode}</span>
                {c.activeAppointment && (
                  <span className="muted">
                    {new Date(c.activeAppointment.startsAt).toLocaleString('ru-KZ', {
                      timeZone: 'Asia/Almaty',
                    })}
                  </span>
                )}
              </button>
            </li>
          ))}
          {cases.length === 0 && <li className="muted">Пока нет случаев</li>}
        </ul>
      </main>
    );
  }

  return (
    <main className="shell">
      <button type="button" className="link" onClick={() => setStep('list')}>
        ← К списку
      </button>
      <h1>Консультация</h1>
      {detail && (
        <>
          <p>
            Статус: <span className="badge">{detail.status}</span>
          </p>
          {detail.activeAppointment && (
            <p>
              Запись:{' '}
              {new Date(detail.activeAppointment.startsAt).toLocaleString('ru-KZ', {
                timeZone: 'Asia/Almaty',
              })}
            </p>
          )}

          {detail.status === 'AWAITING_CONSENT' && (
            <section>
              <h2>Согласия</h2>
              <p className="muted">Нужно принять оферту и согласия (ТЗ 7.1). Акцепт фиксируется с хэшем текста.</p>
              {detail.pendingConsents.map((d) => (
                <article key={d.id} className="consent">
                  <h3>
                    {d.kind} v{d.version}
                  </h3>
                  <p className="body">{d.body}</p>
                  <button type="button" disabled={busy} onClick={() => acceptConsent(d.id)}>
                    Принимаю
                  </button>
                </article>
              ))}
              {detail.pendingConsents.length === 0 && <p className="muted">Все документы приняты</p>}
            </section>
          )}

          {(detail.status === 'AWAITING_BOOKING' || detail.status === 'RESCHEDULED') && (
            <section>
              <h2>Выбор времени</h2>
              <ul className="slots">
                {slots.map((s) => (
                  <li key={s.id}>
                    <button type="button" disabled={busy} onClick={() => book(s.id)}>
                      {new Date(s.startsAt).toLocaleString('ru-KZ', { timeZone: 'Asia/Almaty' })}
                    </button>
                  </li>
                ))}
                {slots.length === 0 && <li className="muted">Нет свободных слотов</li>}
              </ul>
            </section>
          )}

          {(detail.status === 'BOOKED' || detail.status === 'IN_SESSION') && (
            <section>
              <h2>Видеосессия</h2>
              <p className="muted">Без доступной записи сессия не стартует (ТЗ 6.3.3).</p>
              {!media ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!token) return;
                    setBusy(true);
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
                      await openCase(detail.id);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Ошибка');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Войти в сессию
                </button>
              ) : (
                <VideoRoom
                  livekitUrl={media.livekitUrl}
                  token={media.token}
                  onLeave={() => setMedia(null)}
                />
              )}
            </section>
          )}

          {conclusionView?.available && (
            <section>
              <h2>Заключение врача</h2>
              <p className="muted">
                Статус: {conclusionView.status}
                {conclusionView.signedAt &&
                  ` · подписано ${new Date(conclusionView.signedAt).toLocaleString('ru-KZ', {
                    timeZone: 'Asia/Almaty',
                  })}`}
              </p>
              {conclusionView.conclusionText && <p>{conclusionView.conclusionText}</p>}
              {conclusionView.recommendations && (
                <>
                  <h3>Рекомендации</h3>
                  <p>{conclusionView.recommendations}</p>
                </>
              )}
              {conclusionView.documentUrl && (
                <p>
                  <a href={conclusionView.documentUrl} target="_blank" rel="noreferrer">
                    Открыть документ
                  </a>
                </p>
              )}
              {detail.status === 'AWAITING_PATIENT_DELIVERY' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (!token) return;
                    setBusy(true);
                    try {
                      await api(`/api/patient/conclusions/${detail.id}/confirm`, { method: 'POST' }, token);
                      await openCase(detail.id);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Ошибка');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Получил(а) заключение
                </button>
              )}
              {conclusionView.deliveredAt && (
                <p className="hint">
                  Получено{' '}
                  {new Date(conclusionView.deliveredAt).toLocaleString('ru-KZ', {
                    timeZone: 'Asia/Almaty',
                  })}
                </p>
              )}
            </section>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}

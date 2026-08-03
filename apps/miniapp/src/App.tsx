import { FormEvent, useEffect, useState } from 'react';
import { VideoRoom } from './VideoRoom';
import { initTelegramWebApp } from './telegram';

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
const nameKey = 'miru_patient_name';
const pendingCatalogKey = 'miru_pending_catalog';
const SLOT_RANGE_DAYS = 14;

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

function consentTitle(kind: string) {
  const map: Record<string, string> = {
    offer: 'Оферта',
    dmu_consent: 'Согласие на ДМУ',
    pmd_consent: 'Согласие на обработку данных',
  };
  return map[kind] ?? 'Документ';
}

function slotWindow() {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + SLOT_RANGE_DAYS * 86400000).toISOString();
  return { from, to };
}

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
  const [iin, setIin] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tgChatId, setTgChatId] = useState<string | null>(null);
  const [inTelegram, setInTelegram] = useState(false);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [catalogOrgs, setCatalogOrgs] = useState<
    Array<{ id: string; nameRu: string; catalogCity: string | null }>
  >([]);
  const [catalogOrgId, setCatalogOrgId] = useState<string | null>(null);
  const [catalogOffers, setCatalogOffers] = useState<
    Array<{ profileCode: string; titleRu: string; durationMin: number; descriptionRu: string }>
  >([]);
  const [catalogOrgName, setCatalogOrgName] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [busy, setBusy] = useState(false);
  const [patientName, setPatientName] = useState(() => localStorage.getItem(nameKey) || '');
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
      // Dev: silently prefill code when API returns debugCode (no UI hint)
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
        body: JSON.stringify({
          iin,
          code,
          ...(tgChatId ? { telegramChatId: tgChatId } : {}),
        }),
      });
      localStorage.setItem(tokenKey, res.accessToken);
      setToken(res.accessToken);
      if (tgChatId) {
        api('/api/patient/me/telegram', {
          method: 'POST',
          body: JSON.stringify({ telegramChatId: tgChatId }),
        }, res.accessToken).catch(() => undefined);
      }
      if (sessionStorage.getItem(pendingCatalogKey) === '1') {
        sessionStorage.removeItem(pendingCatalogKey);
        await openCatalog(res.accessToken);
      } else {
        setStep('list');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  async function openCatalog(_token?: string) {
    setError(null);
    try {
      const orgs = await api<typeof catalogOrgs>('/api/catalog/organizations');
      setCatalogOrgs(orgs);
      setCatalogOrgName(null);
      setCatalogOrgId(null);
      setCatalogOffers([]);
      setStep('catalog');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка витрины');
    }
  }

  async function startBookingOffer(profileCode: string) {
    if (!token || !catalogOrgId) return;
    const name = patientName.trim();
    if (name.length < 2) {
      setError('Укажите ФИО');
      return;
    }
    localStorage.setItem(nameKey, name);
    setBusy(true);
    setError(null);
    try {
      const d = await api<CaseDetail>(
        '/api/patient/cases/from-catalog',
        {
          method: 'POST',
          body: JSON.stringify({
            organizationId: catalogOrgId,
            profileCode,
            patientFullName: name,
          }),
        },
        token,
      );
      setDetail(d);
      setStep('case');
      await refreshSlotsForCase(d);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка записи');
    } finally {
      setBusy(false);
    }
  }

  async function refreshSlotsForCase(d: CaseDetail) {
    if (!token) return;
    if (d.status === 'AWAITING_BOOKING' || d.status === 'RESCHEDULED') {
      const { from, to } = slotWindow();
      const s = await api<Slot[]>(`/api/patient/cases/${d.id}/slots?from=${from}&to=${to}`, {}, token);
      setSlots(s);
    } else {
      setSlots([]);
    }
  }

  async function loadCases(t: string) {
    const rows = await api<CaseRow[]>('/api/patient/cases', {}, t);
    setCases(rows);
  }

  useEffect(() => {
    const tg = initTelegramWebApp();
    setInTelegram(tg.inTelegram);
    setTgChatId(tg.chatId);
  }, []);

  useEffect(() => {
    if (!token || step !== 'list') return;
    loadCases(token).catch((err) => setError(err instanceof Error ? err.message : 'Ошибка'));
  }, [token, step]);

  useEffect(() => {
    if (!token || !tgChatId) return;
    api('/api/patient/me/telegram', {
      method: 'POST',
      body: JSON.stringify({ telegramChatId: tgChatId }),
    }, token).catch(() => undefined);
  }, [token, tgChatId]);

  async function openCase(id: string) {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api<CaseDetail>(`/api/patient/cases/${id}`, {}, token);
      setDetail(d);
      setStep('case');
      await refreshSlotsForCase(d);
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

  async function cancelAppt() {
    if (!token || !detail?.activeAppointment) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/patient/appointments/${detail.activeAppointment.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'patient_cancel_miniapp' }),
      }, token);
      setMedia(null);
      await openCase(detail.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отменить');
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
        <button type="button" className="link" onClick={() => setStep(token ? 'list' : 'auth')}>
          ← Назад
        </button>
        <p className="brand">Miru</p>
        <h1>Запись</h1>
        {error && <p className="error">{error}</p>}
        {token && (
          <label className="name-field">
            Ваше ФИО
            <input
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              autoComplete="name"
              placeholder="Как к вам обращаться"
            />
          </label>
        )}
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
                      setCatalogOrgId(o.id);
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
            <button
              type="button"
              className="link"
              onClick={() => {
                setCatalogOrgName(null);
                setCatalogOrgId(null);
              }}
            >
              ← К списку МО
            </button>
            <h2>{catalogOrgName}</h2>
            <ul className="cards">
              {catalogOffers.map((off) => (
                <li key={off.profileCode} className="consent">
                  <h3>{off.titleRu}</h3>
                  <p className="muted">{off.durationMin} мин</p>
                  {off.descriptionRu ? <p>{off.descriptionRu}</p> : null}
                  {token && catalogOrgId ? (
                    <button type="button" disabled={busy} onClick={() => void startBookingOffer(off.profileCode)}>
                      Записаться
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        sessionStorage.setItem(pendingCatalogKey, '1');
                        setStep('auth');
                      }}
                    >
                      Войти и записаться
                    </button>
                  )}
                </li>
              ))}
              {catalogOffers.length === 0 && <li className="muted">Нет активных услуг</li>}
            </ul>
          </section>
        )}
      </main>
    );
  }

  if (step === 'auth') {
    return (
      <main className="shell">
        <p className="brand">Miru</p>
        <h1>Вход</h1>
        <p className="lead">
          {inTelegram
            ? 'Введите ИИН и код подтверждения. Уведомления придут в этот чат.'
            : 'Введите ИИН и код из SMS.'}
        </p>
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
            Код
            <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy || !code}>
            Войти
          </button>
        </form>
        <button
          type="button"
          className="link"
          style={{ marginTop: '1rem' }}
          onClick={() => {
            sessionStorage.setItem(pendingCatalogKey, '1');
            void openCatalog();
          }}
        >
          Сначала посмотреть услуги
        </button>
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
        <button type="button" className="cta" disabled={busy} onClick={() => void openCatalog()}>
          Записаться
        </button>
        <ul className="cards">
          {cases.map((c) => (
            <li key={c.id}>
              <button type="button" className="card" onClick={() => openCase(c.id)}>
                <span className="badge">{labelStatus(c.status)}</span>
                {c.activeAppointment ? (
                  <span className="muted">
                    {new Date(c.activeAppointment.startsAt).toLocaleString('ru-KZ', {
                      timeZone: 'Asia/Almaty',
                    })}
                  </span>
                ) : (
                  <span className="muted">Онлайн-консультация</span>
                )}
              </button>
            </li>
          ))}
          {cases.length === 0 && <li className="muted">Пока нет записей</li>}
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
            Статус: <span className="badge">{labelStatus(detail.status)}</span>
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
              <p className="muted">Примите документы, чтобы выбрать время.</p>
              {detail.pendingConsents.map((d) => (
                <article key={d.id} className="consent">
                  <h3>{consentTitle(d.kind)}</h3>
                  <p className="body">{d.body}</p>
                  <button type="button" disabled={busy} onClick={() => acceptConsent(d.id)}>
                    Принимаю
                  </button>
                </article>
              ))}
              {detail.pendingConsents.length === 0 && <p className="muted">Готово…</p>}
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
              <h2>Видеосвязь</h2>
              {detail.activeAppointment && detail.status === 'BOOKED' && (
                <button type="button" className="ghost" disabled={busy} onClick={() => void cancelAppt()}>
                  Отменить запись
                </button>
              )}
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
              {conclusionView.signedAt && (
                <p className="muted">
                  {new Date(conclusionView.signedAt).toLocaleString('ru-KZ', {
                    timeZone: 'Asia/Almaty',
                  })}
                </p>
              )}
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
            </section>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </main>
  );
}

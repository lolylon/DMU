import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

const APP_VERSION = '0.1.0';
const TOKEN_KEY = 'miru_kiosk_token';
const PATIENT_KEY = 'miru_kiosk_patient';
const LANG_KEY = 'miru_kiosk_lang';

type Lang = 'ru' | 'kk';
type Step =
  | 'pair'
  | 'idle'
  | 'iin'
  | 'code'
  | 'menu'
  | 'consent'
  | 'slots'
  | 'appointments'
  | 'done'
  | 'emergency';

type Offer = {
  id: string;
  profileCode: string;
  titleRu: string;
  titleKk: string;
  descriptionRu: string | null;
  descriptionKk: string | null;
  durationMin: number;
};

type Slot = { id: string; startsAt: string; endsAt: string };
type Appt = {
  id: string;
  slot: { startsAt: string; endsAt: string };
  case: { id: string; profileCode: string | null };
};

type CaseDetail = {
  id: string;
  status: string;
  pendingConsents?: Array<{ id: string; kind: string; body: string; version: string }>;
};

const copy = {
  ru: {
    brand: 'Айжан',
    pairTitle: 'Привязка терминала',
    pairLead: 'Один раз: кнопка пилота или короткий код от администратора.',
    pairPilot: 'Подключить пилотный терминал',
    pairCodeLabel: 'Код привязки',
    pairCodeHint: 'Пилот: PILOT1',
    pairBtn: 'Привязать по коду',
    pairAdvanced: 'Расширенные настройки',
    pairTokenLabel: 'Длинный deviceToken (редко нужно)',
    pairTokenBtn: 'Привязать по token',
    heroTitle: 'Самозапись на ДМУ',
    start: 'Начать запись',
    myAppts: 'Мои записи',
    emergency: 'Экстренный вызов',
    iinTitle: 'Введите ИИН',
    codeTitle: 'Код подтверждения',
    getCode: 'Получить код',
    login: 'Войти',
    pickService: 'Выберите услугу',
    finish: 'Завершить',
    consents: 'Согласия',
    accept: 'Принимаю и продолжить',
    slots: 'Свободные слоты',
    noSlots: 'Нет свободных слотов на 7 дней.',
    backServices: 'К услугам',
    doneTitle: 'Запись оформлена',
    emergencyTitle: 'Экстренный вызов',
    ready: 'Готово',
    back: '← Назад',
    appointments: 'Активные записи',
    cancel: 'Отменить',
    noAppts: 'Активных записей нет',
    min: 'мин',
  },
  kk: {
    brand: 'Айжан',
    pairTitle: 'Терминалды байлау',
    pairLead: 'Бір рет: пилот түймесі немесе әкімшінің қысқа коды.',
    pairPilot: 'Пилоттық терминалды қосу',
    pairCodeLabel: 'Байлау коды',
    pairCodeHint: 'Пилот: PILOT1',
    pairBtn: 'Кодпен байлау',
    pairAdvanced: 'Қосымша',
    pairTokenLabel: 'Ұзын deviceToken (сирек)',
    pairTokenBtn: 'Token-мен байлау',
    heroTitle: 'ҚМУ-ға өзін-өзі жазу',
    start: 'Жазуды бастау',
    myAppts: 'Менің жазбаларым',
    emergency: 'Жедел шақыру',
    iinTitle: 'ЖСН енгізіңіз',
    codeTitle: 'Растау коды',
    getCode: 'Код алу',
    login: 'Кіру',
    pickService: 'Қызметті таңдаңыз',
    finish: 'Аяқтау',
    consents: 'Келісімдер',
    accept: 'Қабылдаймын',
    slots: 'Бос слоттар',
    noSlots: '7 күнге бос слот жоқ.',
    backServices: 'Қызметтерге',
    doneTitle: 'Жазба рәсімделді',
    emergencyTitle: 'Жедел шақыру',
    ready: 'Дайын',
    back: '← Артқа',
    appointments: 'Белсенді жазбалар',
    cancel: 'Болдырмау',
    noAppts: 'Белсенді жазба жоқ',
    min: 'мин',
  },
} as const;

async function api<T>(
  path: string,
  init: RequestInit = {},
  opts?: { kiosk?: string | null; patient?: string | null },
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (opts?.kiosk) headers.set('X-Kiosk-Token', opts.kiosk);
  if (opts?.patient) headers.set('Authorization', `Bearer ${opts.patient}`);
  const res = await fetch(path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message ?? res.statusText;
    throw new Error(Array.isArray(msg) ? msg.join(', ') : String(msg));
  }
  return data as T;
}

function NumPad({
  onDigit,
  onBack,
  onClear,
}: {
  onDigit: (d: string) => void;
  onBack: () => void;
  onClear: () => void;
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'];
  return (
    <div className="numpad">
      {keys.map((k) => (
        <button
          key={k}
          type="button"
          className="numpad-key"
          onClick={() => {
            if (k === 'C') onClear();
            else if (k === '⌫') onBack();
            else onDigit(k);
          }}
        >
          {k}
        </button>
      ))}
    </div>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('ru-KZ', { timeZone: 'Asia/Almaty' });
}

export function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem(LANG_KEY) as Lang) || 'ru');
  const t = copy[lang];
  const [kioskToken, setKioskToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [patientToken, setPatientToken] = useState(() => localStorage.getItem(PATIENT_KEY));
  const [step, setStep] = useState<Step>(() => (localStorage.getItem(TOKEN_KEY) ? 'idle' : 'pair'));
  const [pairInput, setPairInput] = useState('');
  const [pairCode, setPairCode] = useState('PILOT1');
  const [showAdvancedPair, setShowAdvancedPair] = useState(false);
  const [orgName, setOrgName] = useState('Miru FrontDesk');
  const [orgAddress, setOrgAddress] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('');
  const [emergencyOk, setEmergencyOk] = useState(false);
  const [otaNote, setOtaNote] = useState<string | null>(null);
  const [iin, setIin] = useState('');
  const [code, setCode] = useState('');
  const [debugHint, setDebugHint] = useState<string | null>(null);
  const [patientName, setPatientName] = useState('Пилотный пациент');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null);
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [appointments, setAppointments] = useState<Appt[]>([]);
  const [ticket, setTicket] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [afterAuth, setAfterAuth] = useState<'menu' | 'appointments'>('menu');
  const submitLock = useRef(false);
  const lastAutoIin = useRef('');

  const langToggle = useMemo(
    () => (
      <div className="lang">
        <button
          type="button"
          className={lang === 'ru' ? 'active' : ''}
          onClick={() => {
            localStorage.setItem(LANG_KEY, 'ru');
            setLang('ru');
          }}
        >
          RU
        </button>
        <button
          type="button"
          className={lang === 'kk' ? 'active' : ''}
          onClick={() => {
            localStorage.setItem(LANG_KEY, 'kk');
            setLang('kk');
          }}
        >
          KK
        </button>
      </div>
    ),
    [lang],
  );

  async function refreshDevice(token: string) {
    const me = await api<{
      organization: { nameRu: string; catalogCity?: string | null; catalogAddress?: string | null };
      device: { label: string };
      emergencyAvailable: boolean;
    }>('/api/frontdesk/me', {}, { kiosk: token });
    setOrgName(me.organization.nameRu);
    setOrgAddress(
      [me.organization.catalogCity, me.organization.catalogAddress].filter(Boolean).join(', '),
    );
    setDeviceLabel(me.device.label);
    setEmergencyOk(me.emergencyAvailable);
    const ota = await api<{
      updateAvailable: boolean;
      latest?: { version: string; notesRu?: string | null; mandatory: boolean };
    }>(
      '/api/frontdesk/ota/report',
      { method: 'POST', body: JSON.stringify({ appVersion: APP_VERSION }) },
      { kiosk: token },
    );
    setOtaNote(
      ota.updateAvailable && ota.latest
        ? `OTA ${ota.latest.version}${ota.latest.mandatory ? ' ★' : ''}`
        : null,
    );
  }

  useEffect(() => {
    if (!kioskToken) return;
    refreshDevice(kioskToken).catch((e) => {
      setError(e instanceof Error ? e.message : 'Ошибка киоска');
      localStorage.removeItem(TOKEN_KEY);
      setKioskToken(null);
      setStep('pair');
    });
  }, [kioskToken]);

  useEffect(() => {
    if (step !== 'idle' && step !== 'done') return;
    const tmr = window.setTimeout(
      () => {
        localStorage.removeItem(PATIENT_KEY);
        setPatientToken(null);
        setCaseDetail(null);
        setSelectedOffer(null);
        setTicket(null);
        setIin('');
        setCode('');
        setStep('idle');
      },
      step === 'done' ? 25000 : 120000,
    );
    return () => clearTimeout(tmr);
  }, [step]);

  function resetSession() {
    localStorage.removeItem(PATIENT_KEY);
    setPatientToken(null);
    setCaseDetail(null);
    setSelectedOffer(null);
    setTicket(null);
    setError(null);
    setIin('');
    setCode('');
    setStep('idle');
  }

  async function finishPair(token: string) {
    await refreshDevice(token);
    localStorage.setItem(TOKEN_KEY, token);
    setKioskToken(token);
    setStep('idle');
  }

  async function pairWithCode(e?: FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ deviceToken: string }>('/api/frontdesk/pair', {
        method: 'POST',
        body: JSON.stringify({ code: pairCode.trim() }),
      });
      await finishPair(res.deviceToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка привязки');
    } finally {
      setBusy(false);
    }
  }

  async function pairPilot() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/bootstrap/pilot-kiosk');
      const res = await api<{ deviceToken: string }>('/api/frontdesk/pair', {
        method: 'POST',
        body: JSON.stringify({ code: 'PILOT1' }),
      });
      await finishPair(res.deviceToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка привязки');
    } finally {
      setBusy(false);
    }
  }

  async function pairWithToken(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const token = pairInput.trim();
      const res = await api<{ deviceToken: string }>('/api/frontdesk/pair', {
        method: 'POST',
        body: JSON.stringify({ deviceToken: token }),
      });
      await finishPair(res.deviceToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка привязки');
    } finally {
      setBusy(false);
    }
  }

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    if (!kioskToken || submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ debugCode?: string; message: string }>(
        '/api/frontdesk/auth/request-code',
        { method: 'POST', body: JSON.stringify({ iin }) },
        { kiosk: kioskToken },
      );
      setDebugHint(res.debugCode ? `Dev: ${res.debugCode}` : res.message);
      if (res.debugCode) setCode(res.debugCode);
      setStep('code');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
      submitLock.current = false;
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!kioskToken || submitLock.current) return;
    submitLock.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ accessToken: string; user: { displayName: string } }>(
        '/api/frontdesk/auth/verify',
        { method: 'POST', body: JSON.stringify({ iin, code: code.trim() }) },
        { kiosk: kioskToken },
      );
      localStorage.setItem(PATIENT_KEY, res.accessToken);
      setPatientToken(res.accessToken);
      setPatientName(res.user.displayName);
      const offersRes = await api<{ offers: Offer[] }>('/api/frontdesk/offers', {}, { kiosk: kioskToken });
      setOffers(offersRes.offers);
      if (afterAuth === 'appointments') {
        const rows = await api<Appt[]>(
          '/api/frontdesk/appointments',
          {},
          { kiosk: kioskToken, patient: res.accessToken },
        );
        setAppointments(rows);
        setStep('appointments');
      } else {
        setStep('menu');
      }
      setAfterAuth('menu');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
      submitLock.current = false;
    }
  }

  async function openAppointments() {
    if (!kioskToken) return;
    setBusy(true);
    setError(null);
    try {
      if (!patientToken) {
        setAfterAuth('appointments');
        setStep('iin');
        return;
      }
      const rows = await api<Appt[]>(
        '/api/frontdesk/appointments',
        {},
        { kiosk: kioskToken, patient: patientToken },
      );
      setAppointments(rows);
      setStep('appointments');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
      setAfterAuth('appointments');
      setStep('iin');
    } finally {
      setBusy(false);
    }
  }

  async function cancelAppt(id: string) {
    if (!kioskToken || !patientToken) return;
    setBusy(true);
    try {
      await api(
        `/api/frontdesk/appointments/${id}/cancel`,
        { method: 'POST', body: JSON.stringify({ reason: 'Отмена на киоске' }) },
        { kiosk: kioskToken, patient: patientToken },
      );
      await openAppointments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отмены');
    } finally {
      setBusy(false);
    }
  }

  async function pickOffer(offer: Offer) {
    if (!kioskToken || !patientToken) return;
    setBusy(true);
    setError(null);
    try {
      const detail = await api<CaseDetail>(
        '/api/frontdesk/booking/start',
        {
          method: 'POST',
          body: JSON.stringify({ patientFullName: patientName, profileCode: offer.profileCode }),
        },
        { kiosk: kioskToken, patient: patientToken },
      );
      setSelectedOffer(offer);
      setCaseDetail(detail);
      if (!detail.pendingConsents?.length) await loadSlots(offer.profileCode);
      else setStep('consent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  async function acceptAllConsents() {
    if (!kioskToken || !patientToken || !caseDetail) return;
    setBusy(true);
    setError(null);
    try {
      for (const doc of caseDetail.pendingConsents ?? []) {
        await api(
          `/api/frontdesk/cases/${caseDetail.id}/consents/accept`,
          { method: 'POST', body: JSON.stringify({ consentDocumentId: doc.id }) },
          { kiosk: kioskToken, patient: patientToken },
        );
      }
      await loadSlots(selectedOffer?.profileCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка согласия');
    } finally {
      setBusy(false);
    }
  }

  async function loadSlots(profileCode?: string) {
    if (!kioskToken) return;
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 7 * 86400000).toISOString();
    const q = new URLSearchParams({ from, to });
    if (profileCode) q.set('profileCode', profileCode);
    const rows = await api<Slot[]>(`/api/frontdesk/slots?${q}`, {}, { kiosk: kioskToken });
    setSlots(rows);
    setStep('slots');
  }

  async function book(slotId: string) {
    if (!kioskToken || !patientToken || !caseDetail) return;
    setBusy(true);
    setError(null);
    try {
      const appt = await api<{
        ticket: {
          organizationName?: string;
          address?: string;
          caseId: string;
          startsAt: string;
          endsAt: string;
          patientName: string;
        };
      }>(
        `/api/frontdesk/cases/${caseDetail.id}/book`,
        { method: 'POST', body: JSON.stringify({ slotId }) },
        { kiosk: kioskToken, patient: patientToken },
      );
      const title =
        lang === 'kk'
          ? selectedOffer?.titleKk ?? selectedOffer?.titleRu
          : selectedOffer?.titleRu;
      setTicket(
        [
          title,
          fmt(appt.ticket.startsAt),
          appt.ticket.organizationName ?? orgName,
          appt.ticket.address || orgAddress,
          appt.ticket.patientName,
          `ID ${appt.ticket.caseId.slice(0, 8)}…`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка записи');
    } finally {
      setBusy(false);
    }
  }

  async function emergency() {
    if (!kioskToken) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ messageRu: string }>(
        '/api/frontdesk/emergency',
        { method: 'POST', body: JSON.stringify({ note: 'kiosk_button' }) },
        { kiosk: kioskToken },
      );
      setTicket(res.messageRu);
      setStep('emergency');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Экстренный контур недоступен');
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (step !== 'iin' || iin.length !== 12) return;
    if (lastAutoIin.current === iin || submitLock.current || busy) return;
    lastAutoIin.current = iin;
    const id = window.setTimeout(() => {
      (document.getElementById('iin-form') as HTMLFormElement | null)?.requestSubmit();
    }, 80);
    return () => clearTimeout(id);
  }, [iin, step, busy]);

  if (step === 'pair') {
    return (
      <main className="kiosk">
        {langToggle}
        <p className="brand">{t.brand}</p>
        <h1>{t.pairTitle}</h1>
        <p className="lead">{t.pairLead}</p>
        {error && <p className="error">{error}</p>}
        <button type="button" className="cta" disabled={busy} onClick={() => void pairPilot()}>
          {t.pairPilot}
        </button>
        <form className="form" onSubmit={(e) => void pairWithCode(e)}>
          <label>
            {t.pairCodeLabel}
            <input
              value={pairCode}
              onChange={(e) => setPairCode(e.target.value.toUpperCase())}
              autoComplete="off"
              placeholder="XXXX-XXXX"
            />
          </label>
          <p className="hint">{t.pairCodeHint}</p>
          <button type="submit" disabled={busy || pairCode.trim().length < 4}>
            {t.pairBtn}
          </button>
        </form>
        <button
          type="button"
          className="link"
          onClick={() => setShowAdvancedPair((v) => !v)}
        >
          {t.pairAdvanced}
        </button>
        {showAdvancedPair && (
          <form className="form" onSubmit={(e) => void pairWithToken(e)}>
            <label>
              {t.pairTokenLabel}
              <input value={pairInput} onChange={(e) => setPairInput(e.target.value)} />
            </label>
            <button type="submit" disabled={busy || pairInput.length < 16}>
              {t.pairTokenBtn}
            </button>
          </form>
        )}
      </main>
    );
  }

  if (step === 'idle') {
    return (
      <main className="kiosk hero">
        <div className="hero-plane" aria-hidden />
        <div className="hero-copy">
          {langToggle}
          <p className="brand">{t.brand}</p>
          <h1>{t.heroTitle}</h1>
          <p className="lead">
            {orgName}
            {deviceLabel ? ` · ${deviceLabel}` : ''}
          </p>
          {otaNote && <p className="ota">{otaNote}</p>}
          {error && <p className="error">{error}</p>}
          <div className="cta-row">
            <button type="button" className="cta" onClick={() => setStep('iin')}>
              {t.start}
            </button>
            <button type="button" className="cta ghost" disabled={busy} onClick={() => void openAppointments()}>
              {t.myAppts}
            </button>
            {emergencyOk && (
              <button type="button" className="cta danger" onClick={() => void emergency()}>
                {t.emergency}
              </button>
            )}
          </div>
        </div>
      </main>
    );
  }

  if (step === 'iin') {
    const iinShown = iin.padEnd(12, '·').replace(/(.{4})/g, '$1 ').trim();
    return (
      <main className="kiosk pin">
        {langToggle}
        <button type="button" className="link" onClick={resetSession}>
          {t.back}
        </button>
        <p className="brand">{t.brand}</p>
        <h1>{t.iinTitle}</h1>
        <p className="hint">Пилот: 900000000009</p>
        {error && <p className="error">{error}</p>}
        <form
          className="form pin-form"
          id="iin-form"
          onSubmit={requestCode}
        >
          <div className="big-value">{iinShown}</div>
          <button type="submit" className="cta sticky-cta" disabled={busy || iin.length !== 12}>
            {t.getCode}
          </button>
          <NumPad
            onDigit={(d) => setIin((v) => (v + d).slice(0, 12))}
            onBack={() => setIin((v) => v.slice(0, -1))}
            onClear={() => setIin('')}
          />
        </form>
      </main>
    );
  }

  if (step === 'code') {
    return (
      <main className="kiosk pin">
        {langToggle}
        <button type="button" className="link" onClick={() => setStep('iin')}>
          {t.back}
        </button>
        <p className="brand">{t.brand}</p>
        <h1>{t.codeTitle}</h1>
        {debugHint && <p className="hint">{debugHint}</p>}
        {error && <p className="error">{error}</p>}
        <form className="form pin-form" id="code-form" onSubmit={verify}>
          <div className="big-value">{code || '••••••'}</div>
          <button type="submit" className="cta sticky-cta" disabled={busy || code.length < 4}>
            {t.login}
          </button>
          <NumPad
            onDigit={(d) => setCode((v) => (v + d).slice(0, 6))}
            onBack={() => setCode((v) => v.slice(0, -1))}
            onClear={() => setCode('')}
          />
        </form>
      </main>
    );
  }

  if (step === 'menu') {
    return (
      <main className="kiosk">
        {langToggle}
        <button type="button" className="link" onClick={resetSession}>
          {t.finish}
        </button>
        <p className="brand">{t.brand}</p>
        <h1>{t.pickService}</h1>
        <p className="lead">{patientName}</p>
        {error && <p className="error">{error}</p>}
        <ul className="tiles">
          {offers.map((o) => (
            <li key={o.id}>
              <button type="button" className="tile" disabled={busy} onClick={() => void pickOffer(o)}>
                <strong>{lang === 'kk' ? o.titleKk || o.titleRu : o.titleRu}</strong>
                <span>
                  {o.durationMin} {t.min}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="cta ghost" disabled={busy} onClick={() => void openAppointments()}>
          {t.myAppts}
        </button>
      </main>
    );
  }

  if (step === 'appointments') {
    return (
      <main className="kiosk">
        {langToggle}
        <button type="button" className="link" onClick={() => (patientToken ? setStep('menu') : resetSession())}>
          {t.back}
        </button>
        <p className="brand">{t.brand}</p>
        <h1>{t.appointments}</h1>
        {error && <p className="error">{error}</p>}
        <ul className="tiles">
          {appointments.map((a) => (
            <li key={a.id}>
              <div className="tile static">
                <div>
                  <strong>{fmt(a.slot.startsAt)}</strong>
                  <div className="muted">{a.case.profileCode ?? a.case.id.slice(0, 8)}</div>
                </div>
                <button type="button" className="danger-sm" disabled={busy} onClick={() => void cancelAppt(a.id)}>
                  {t.cancel}
                </button>
              </div>
            </li>
          ))}
        </ul>
        {!appointments.length && <p className="muted">{t.noAppts}</p>}
      </main>
    );
  }

  if (step === 'consent' && caseDetail) {
    return (
      <main className="kiosk">
        {langToggle}
        <p className="brand">{t.brand}</p>
        <h1>{t.consents}</h1>
        {error && <p className="error">{error}</p>}
        <div className="consent-list">
          {(caseDetail.pendingConsents ?? []).map((c) => (
            <article key={c.id} className="consent">
              <h2>
                {c.kind} · v{c.version}
              </h2>
              <p>{c.body}</p>
            </article>
          ))}
        </div>
        <button type="button" className="cta" disabled={busy} onClick={() => void acceptAllConsents()}>
          {t.accept}
        </button>
      </main>
    );
  }

  if (step === 'slots') {
    return (
      <main className="kiosk">
        {langToggle}
        <button type="button" className="link" onClick={() => setStep('menu')}>
          {t.backServices}
        </button>
        <p className="brand">{t.brand}</p>
        <h1>{t.slots}</h1>
        {error && <p className="error">{error}</p>}
        <ul className="tiles">
          {slots.map((s) => (
            <li key={s.id}>
              <button type="button" className="tile" disabled={busy} onClick={() => void book(s.id)}>
                {fmt(s.startsAt)}
              </button>
            </li>
          ))}
        </ul>
        {!slots.length && (
          <div className="empty">
            <p className="muted">{t.noSlots}</p>
            <button type="button" className="cta ghost" onClick={() => setStep('menu')}>
              {t.backServices}
            </button>
          </div>
        )}
      </main>
    );
  }

  if (step === 'done' || step === 'emergency') {
    return (
      <main className="kiosk">
        {langToggle}
        <p className="brand">{t.brand}</p>
        <h1>{step === 'emergency' ? t.emergencyTitle : t.doneTitle}</h1>
        <pre className="ticket">{ticket}</pre>
        <button type="button" className="cta" onClick={resetSession}>
          {t.ready}
        </button>
      </main>
    );
  }

  return null;
}

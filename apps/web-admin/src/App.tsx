import { FormEvent, useEffect, useState } from 'react';

type Membership = { organizationId: string; role: string };
type User = {
  id: string;
  email: string | null;
  displayName: string;
  totpEnabled: boolean;
  memberships: Membership[];
};

type OrgRow = {
  id: string;
  bin: string;
  nameRu: string;
  nameKk: string;
  status: string;
  misMode: string;
  catalogPublic: boolean;
  _count: { memberships: number; departments: number };
};

type Readiness = {
  allRequiredDone: boolean;
  requiredDone: number;
  requiredTotal: number;
  items: Array<{
    key: string;
    labelRu: string;
    required: boolean;
    kind: string;
    done: boolean;
  }>;
};

type OrgDetail = OrgRow & {
  catalogCity: string | null;
  catalogAddress: string | null;
  departments: Array<{ id: string; nameRu: string }>;
  readiness: Readiness;
  members: Array<{
    email: string | null;
    displayName: string;
    role: string;
    totpEnabled: boolean;
  }>;
};

const tokenKey = 'miru_admin_token';

async function api<T>(path: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.message ?? data?.error ?? res.statusText;
    throw new Error(Array.isArray(msg) ? msg.join(', ') : typeof msg === 'object' ? JSON.stringify(msg) : String(msg));
  }
  return data as T;
}

export function App() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(tokenKey));
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('tech@pilot.miru.local');
  const [password, setPassword] = useState('ChangeMeNow!99');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [techLog, setTechLog] = useState<Array<{ id: string; action: string; createdAt: string }>>([]);
  const [busy, setBusy] = useState(false);

  const [newOrg, setNewOrg] = useState({
    bin: '990011223344',
    nameRu: 'Новая МО',
    nameKk: 'Жаңа МО',
    misMode: 'manual',
  });
  const [depName, setDepName] = useState('Терапия');
  const [newUser, setNewUser] = useState({
    email: '',
    displayName: '',
    role: 'CONSULTANT',
    temporaryPassword: 'ChangeMeNow!99',
    iin: '',
  });
  const [bulkJson, setBulkJson] = useState(
    '[\n  {"email":"registrar@example.kz","displayName":"Регистратор","role":"REGISTRAR","temporaryPassword":"ChangeMeNow!99"}\n]',
  );

  async function login(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
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
      setBusy(false);
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
    setOrgs([]);
    setDetail(null);
  }

  async function refreshOrgs(t: string) {
    const rows = await api<OrgRow[]>('/api/admin/orgs', {}, t);
    setOrgs(rows);
  }

  async function openOrg(id: string) {
    if (!token) return;
    setSelectedId(id);
    const d = await api<OrgDetail>(`/api/admin/orgs/${id}`, {}, token);
    setDetail(d);
    const log = await api<typeof techLog>(`/api/admin/tech-actions?organizationId=${id}`, {}, token);
    setTechLog(log);
  }

  useEffect(() => {
    if (!token) return;
    refreshOrgs(token).catch((err) => setError(err instanceof Error ? err.message : 'Load failed'));
  }, [token]);

  if (!token || !user) {
    return (
      <main className="shell">
        <p className="brand">Miru Admin</p>
        <h1>Панель внедрения</h1>
        <p className="lead">
          Только метаданные МО (ТЗ 11.2). TOTP: <code>POST /api/bootstrap/demo</code> →{' '}
          <code>tech.totpSecret</code> в Authenticator (Time-based).
        </p>
        <form className="form" onSubmit={login}>
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label>
            Пароль
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label>
            TOTP
            <input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} inputMode="numeric" />
          </label>
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>
            Войти
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="top">
        <div>
          <p className="brand">Miru Admin</p>
          <strong>{user.displayName}</strong>
          <span className="muted"> · {user.memberships.map((m) => m.role).join(', ')}</span>
        </div>
        <button type="button" className="ghost" onClick={logout}>
          Выйти
        </button>
      </header>

      {error && <p className="error banner">{error}</p>}

      <div className="layout">
        <section className="panel">
          <h2>Организации</h2>
          <form
            className="form compact"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!token) return;
              setBusy(true);
              setError(null);
              try {
                const created = await api<OrgDetail>('/api/admin/orgs', {
                  method: 'POST',
                  body: JSON.stringify(newOrg),
                }, token);
                await refreshOrgs(token);
                await openOrg(created.id);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Create failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              БИН
              <input value={newOrg.bin} onChange={(e) => setNewOrg({ ...newOrg, bin: e.target.value })} />
            </label>
            <label>
              Название RU
              <input value={newOrg.nameRu} onChange={(e) => setNewOrg({ ...newOrg, nameRu: e.target.value })} />
            </label>
            <label>
              Название KK
              <input value={newOrg.nameKk} onChange={(e) => setNewOrg({ ...newOrg, nameKk: e.target.value })} />
            </label>
            <button type="submit" disabled={busy}>
              Создать МО
            </button>
          </form>

          <ul className="list">
            {orgs.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className={selectedId === o.id ? 'row active' : 'row'}
                  onClick={() => openOrg(o.id).catch((err) => setError(String(err)))}
                >
                  <span>{o.nameRu}</span>
                  <span className="badge">{o.status}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <h2>Карточка МО</h2>
          {!detail && <p className="muted">Выберите или создайте организацию</p>}
          {detail && (
            <div className="detail">
              <p>
                <strong>{detail.nameRu}</strong> · БИН {detail.bin}
              </p>
              <p>
                Статус: <span className="badge">{detail.status}</span> · МИС {detail.misMode}
              </p>

              <h3>
                Чек-лист готовности ({detail.readiness.requiredDone}/{detail.readiness.requiredTotal})
              </h3>
              <ul className="checklist">
                {detail.readiness.items.map((i) => (
                  <li key={i.key} className={i.done ? 'ok' : i.required ? 'miss' : ''}>
                    <span>
                      {i.done ? '✓' : '○'} {i.labelRu}
                      {!i.required && <span className="muted"> (опц.)</span>}
                    </span>
                    {i.kind === 'manual' && !i.done && (
                      <button
                        type="button"
                        className="ghost small"
                        onClick={async () => {
                          if (!token) return;
                          await api(
                            `/api/admin/orgs/${detail.id}/readiness/${i.key}`,
                            { method: 'POST', body: JSON.stringify({ done: true }) },
                            token,
                          );
                          await openOrg(detail.id);
                        }}
                      >
                        Отметить
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              <div className="actions">
                <button
                  type="button"
                  disabled={busy || !detail.readiness.allRequiredDone}
                  onClick={async () => {
                    if (!token) return;
                    setBusy(true);
                    try {
                      await api(
                        `/api/admin/orgs/${detail.id}/status`,
                        { method: 'POST', body: JSON.stringify({ status: 'testing' }) },
                        token,
                      );
                      await openOrg(detail.id);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Status failed');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  В testing
                </button>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy || !detail.readiness.allRequiredDone}
                  onClick={async () => {
                    if (!token) return;
                    setBusy(true);
                    try {
                      await api(
                        `/api/admin/orgs/${detail.id}/status`,
                        { method: 'POST', body: JSON.stringify({ status: 'live' }) },
                        token,
                      );
                      await openOrg(detail.id);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Status failed');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  В live
                </button>
              </div>

              <h3>Отделения</h3>
              <ul className="list">
                {detail.departments.map((d) => (
                  <li key={d.id}>{d.nameRu}</li>
                ))}
              </ul>
              <form
                className="form compact"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!token) return;
                  await api(
                    `/api/admin/orgs/${detail.id}/departments`,
                    {
                      method: 'POST',
                      body: JSON.stringify({ nameRu: depName, nameKk: depName }),
                    },
                    token,
                  );
                  await openOrg(detail.id);
                }}
              >
                <input value={depName} onChange={(e) => setDepName(e.target.value)} />
                <button type="submit">Добавить отделение</button>
              </form>

              <h3>Пользователи (без ПМД)</h3>
              <ul className="list">
                {detail.members.map((m) => (
                  <li key={`${m.email}-${m.role}`}>
                    {m.displayName} · {m.email} · <span className="badge">{m.role}</span>
                    {m.totpEnabled ? '' : ' · 2FA off'}
                  </li>
                ))}
              </ul>
              <form
                className="form compact"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!token) return;
                  setBusy(true);
                  try {
                    await api(
                      `/api/admin/orgs/${detail.id}/users`,
                      {
                        method: 'POST',
                        body: JSON.stringify({
                          ...newUser,
                          iin: newUser.iin || undefined,
                        }),
                      },
                      token,
                    );
                    await openOrg(detail.id);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'User create failed');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <input
                  placeholder="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                />
                <input
                  placeholder="ФИО"
                  value={newUser.displayName}
                  onChange={(e) => setNewUser({ ...newUser, displayName: e.target.value })}
                />
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                >
                  {['CONSULTANT', 'REGISTRAR', 'ORG_ADMIN', 'DEPARTMENT_HEAD', 'AUDITOR', 'AMBULATORY_WORKER'].map(
                    (r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ),
                  )}
                </select>
                <input
                  placeholder="временный пароль ≥12"
                  value={newUser.temporaryPassword}
                  onChange={(e) => setNewUser({ ...newUser, temporaryPassword: e.target.value })}
                />
                <input
                  placeholder="ИИН (опц.)"
                  value={newUser.iin}
                  onChange={(e) => setNewUser({ ...newUser, iin: e.target.value })}
                />
                <button type="submit">Создать пользователя</button>
              </form>

              <h3>Массовый импорт</h3>
              <textarea rows={5} value={bulkJson} onChange={(e) => setBulkJson(e.target.value)} />
              <button
                type="button"
                onClick={async () => {
                  if (!token) return;
                  setBusy(true);
                  try {
                    const users = JSON.parse(bulkJson);
                    const res = await api<{ results: Array<{ email: string; ok: boolean; error?: string }> }>(
                      `/api/admin/orgs/${detail.id}/users/bulk`,
                      { method: 'POST', body: JSON.stringify({ users }) },
                      token,
                    );
                    const failed = res.results.filter((r) => !r.ok);
                    if (failed.length) {
                      setError(`Импорт: ошибок ${failed.length}: ${failed.map((f) => f.email).join(', ')}`);
                    }
                    await openOrg(detail.id);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Bulk failed');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Импортировать JSON
              </button>

              <h3>Согласия и настройки</h3>
              <div className="actions">
                <button
                  type="button"
                  onClick={async () => {
                    if (!token) return;
                    await api(`/api/admin/orgs/${detail.id}/consents/seed`, { method: 'POST' }, token);
                    await openOrg(detail.id);
                  }}
                >
                  Опубликовать оферту/согласия v1
                </button>
                <button
                  type="button"
                  className="ghost"
                  onClick={async () => {
                    if (!token) return;
                    await api(
                      `/api/admin/orgs/${detail.id}/settings`,
                      {
                        method: 'POST',
                        body: JSON.stringify({
                          misMode: 'manual',
                          catalogPublic: true,
                          catalogCity: 'Алматы',
                        }),
                      },
                      token,
                    );
                    await openOrg(detail.id);
                  }}
                >
                  МИС manual + витрина
                </button>
              </div>

              <h3>Tech action log</h3>
              <ol className="history">
                {techLog.slice(0, 30).map((t) => (
                  <li key={t.id}>
                    {t.action}
                    <span className="muted">
                      {' '}
                      · {new Date(t.createdAt).toLocaleString('ru-KZ', { timeZone: 'Asia/Almaty' })}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

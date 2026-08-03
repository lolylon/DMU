# Miru Platform

Платформа дистанционных медицинских услуг (**Miru Remote**) и фундамент для **Miru FrontDesk**.

Заказчик: ТОО «Miru Systems».

## Документы

- [Видео из дома → клиника](docs/video-remote.md) ← LiveKit Cloud / VPS, не localhost
- [Пилотный VPS (≈2 чел.)](docs/deploy-pilot-vps.md)
- [Архитектура](docs/architecture.md) / [PDF](docs/architecture.pdf)
- [Честный статус соответствия](docs/compliance-status.md) ← читать перед приёмкой
- [Чеклист недель](docs/week-checklist.md)
- [Поставка НФТ §11](docs/delivery-nfr11.md)

## Быстрый старт (Windows)

### Требования

- Node.js ≥ 20, pnpm 9, Docker Desktop

### Команды

```powershell
cd c:\Users\neckf\Desktop\DMU
Copy-Item .env.example .env
Copy-Item .env.example apps\api\.env
pnpm install
pnpm --filter @miru/shared build
pnpm docker:up
pnpm db:generate
pnpm --filter @miru/api exec prisma migrate deploy
pnpm dev
```

| URL | Назначение |
|---|---|
| http://localhost:3000/api/health | API |
| http://localhost:5173 | Staff (врач) |
| http://localhost:5174 | Admin (внедрение) |
| http://localhost:5175 | Пациент / витрина |
| http://localhost:5177 | FrontDesk киоск «Айжан» |

### Telegram Mini App

1. Токен бота в `.env` / `apps/api/.env` → `TELEGRAM_BOT_TOKEN` (не коммитить).
2. HTTPS-туннель к miniapp (dev): `npx cloudflared tunnel --url http://localhost:5175`
3. URL в BotFather (`/editapp`) и в env:

```powershell
# apps/api/.env
TELEGRAM_WEBAPP_URL=https://….trycloudflare.com
```

4. Кнопка меню бота:

```powershell
Invoke-RestMethod -Method POST -Uri http://localhost:3000/api/bootstrap/telegram-menu `
  -ContentType 'application/json' `
  -Body '{}'
```

Открыть: `t.me/dmu_kaz_bot/miru_remote` (или кнопка меню). После входа по ИИН сохраняется `telegramChatId` для уведомлений.

На Windows при ошибке ExecutionPolicy используй `pnpm.cmd`, не `pnpm`.

### Пилотные учётки + TOTP (постоянные ключи)

TOTP **не ротируется** при повторном bootstrap. Добавь в Authenticator **один раз**:

| Роль | Email | TOTP key |
|---|---|---|
| Консультант | `consultant@pilot.miru.local` | `MIRUCONSULTANT22` |
| ВА | `ambulatory@pilot.miru.local` | `MIRUAMBULATORY22` |
| Tech | `tech@pilot.miru.local` | `MIRUTECHADMIN2222` |

Пароль: `ChangeMeNow!99`. На экране входа Staff/Admin — **QR для скана** + ключ. Также: `GET http://localhost:3000/api/bootstrap/pilot-totp`.

```powershell
Invoke-RestMethod -Method POST -Uri http://localhost:3000/api/bootstrap/demo
```

| Роль | URL |
|---|---|
| Консультант | :5173 |
| ВА (сценарий B) | :5173 |
| Tech admin | :5174 |
| Пациент ИИН `900000000009` | :5175 / :5177 |

## Что умеет Remote сейчас

Полный контур: согласия → слот → видео (gate записи) → заключение → NCALayer/dev-подпись → пациент → МИС/реестр → досье → admin onboarding без SQL.

## Что не «конец ТЗ целиком»

См. `docs/compliance-status.md`: FrontDesk, production МИС, NCA CMS SDK, SMS-провайдер заказчика, verify egress media на контуре РК.

## Структура

```
apps/api, web-staff, web-admin, miniapp
packages/shared
deploy/          docker-compose (Postgres, Redis, MinIO, LiveKit, Egress)
docs/
```

## Безопасность

Секреты не коммитить. `ALLOW_BOOTSTRAP=true` запрещён в production (API не стартует). ПМД только в РК.

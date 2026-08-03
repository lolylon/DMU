# Miru Platform

Платформа дистанционных медицинских услуг (**Miru Remote**) и фундамент для **Miru FrontDesk**.

Заказчик: ТОО «Miru Systems».

## Документы

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

### Пилотные учётки + TOTP

```powershell
Invoke-RestMethod -Method POST -Uri http://localhost:3000/api/bootstrap/demo
```

Ответ **всегда** отдаёт свежие `totpSecret` (dev only). Добавь ключ в **Google Authenticator** → Time-based → 6 цифр при входе.

| Роль | Email | URL |
|---|---|---|
| Консультант | `consultant@pilot.miru.local` | :5173 |
| ВА (сценарий B) | `ambulatory@pilot.miru.local` | :5173 |
| Tech admin | `tech@pilot.miru.local` | :5174 |
| Пациент | ИИН `900000000009` | :5175 (код в `debugCode`) |

Пароль пилота: `ChangeMeNow!99` (только ALLOW_BOOTSTRAP).

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

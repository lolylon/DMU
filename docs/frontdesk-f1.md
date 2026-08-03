# FrontDesk F1 — киоск «Айжан»

Волна F1: привязка терминала, самозапись (ИИН → согласия → слот), экстренный вызов (с регламентом МО), проверка OTA.

## Запуск

```powershell
pnpm.cmd install
pnpm.cmd --filter @miru/api exec prisma migrate deploy
# API + bootstrap
Invoke-RestMethod -Method POST -Uri http://localhost:3000/api/bootstrap/demo
pnpm.cmd --filter @miru/web-frontdesk dev
```

URL: http://localhost:5177  

В ответе bootstrap — `frontdesk.pairCode` (`PILOT1`). На экране привязки: **«Подключить пилотный терминал»** или короткий код. Длинный `deviceToken` не нужен (остался в «Расширенных»).

Token киоска **стабильный** — повторный bootstrap его не инвалидирует.

## API

| Метод | Путь | Auth |
|---|---|---|
| POST | `/api/frontdesk/pair` | public — короткий код → bearer |
| POST | `/api/frontdesk/devices` | staff admin — выдаёт `pairCode` |
| POST | `/api/frontdesk/devices/:id/pair-code` | staff — новый код |
| GET | `/api/frontdesk/me` | `X-Kiosk-Token` |
| POST | `/api/frontdesk/auth/request-code` | kiosk |
| POST | `/api/frontdesk/auth/verify` | kiosk |
| GET | `/api/frontdesk/offers` / `slots` | kiosk |
| POST | `/api/frontdesk/booking/start` | kiosk + patient Bearer |
| POST | `/api/frontdesk/cases/:id/consents/accept` | kiosk + patient |
| POST | `/api/frontdesk/cases/:id/book` | kiosk + patient |
| POST | `/api/frontdesk/emergency` | kiosk (device+org flags) |
| GET/POST | `/api/frontdesk/ota/*` | kiosk |
| POST | `/api/frontdesk/releases` | tech |

Экстренный контур **не** в эксплуатации, пока `Organization.emergencyKioskEnabled` и регламент МО не подтверждены.

## Пилотный демо-путь

1. `POST /api/bootstrap/demo` — стабильный киоск + **FREE слоты на ~14 дней**
2. http://localhost:5177 — **«Подключить пилотный терминал»** (или код `PILOT1`) → запись / мои записи / SOS
3. Staff http://localhost:5173 — вкладки **Расписание** и **SOS киоск**

## Вне F1 (позже)

- Electron/kiosk shell + авто-OTA download
- F2: оплата, обращения
- Печать талона (опционально по решению заказчика)

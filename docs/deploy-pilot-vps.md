# Пилотный VPS (≈2 человека)

Временный облачный контур для UX-демо. **Не для реальных ПМД и не для аттестации ГТС**
(видео = LiveKit Cloud вне РК; площадка часто вне РК). Для аттестации — ВМ в ЦОД РК + self-hosted LiveKit + шифрование томов/бэкапов.

## Что купить

| Что | Минимум | Пример |
|---|---|---|
| VPS | 1 vCPU, **2 GB RAM**, 20 GB SSD, Ubuntu 22.04+ | Timeweb / Aeza / Hetzner CX22 (~$4–7/мес) |
| Домен | любой `.kz` / `.com` | нужен для HTTPS и Telegram Mini App |

DNS (у регистратора):

```
A     @       → IP_VPS
A     staff   → IP_VPS
A     admin   → IP_VPS
```

Открой в firewall: **22, 80, 443** (лучше SSH по ключу, без пароля).

## На сервере

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER   # затем re-login
git clone https://github.com/lolylon/DMU.git
cd DMU
cp deploy/.env.pilot.example .env.pilot
nano .env.pilot   # DOMAIN, пароли ролей, IIN_PEPPER, BOOTSTRAP_SECRET, LiveKit, Telegram
```

Запуск (bootstrap выключен):

```bash
docker compose -f deploy/docker-compose.pilot.yml --env-file .env.pilot up -d --build
```

### Одноразовый seed

1. В `.env.pilot`: `ALLOW_BOOTSTRAP=true` (уже задан `BOOTSTRAP_SECRET`).
2. `docker compose -f deploy/docker-compose.pilot.yml --env-file .env.pilot up -d api`
3. Seed:

```bash
curl -X POST https://ВАШ_ДОМЕН/api/bootstrap/demo \
  -H "x-bootstrap-secret: ВАШ_BOOTSTRAP_SECRET"
curl -X POST https://ВАШ_ДОМЕН/api/bootstrap/telegram-menu \
  -H "content-type: application/json" \
  -H "x-bootstrap-secret: ВАШ_BOOTSTRAP_SECRET" \
  -d '{"webAppUrl":"https://ВАШ_ДОМЕН"}'
```

4. Сразу `ALLOW_BOOTSTRAP=false` и снова `up -d api`.

Без заголовка `x-bootstrap-secret` bootstrap в `NODE_ENV=production` не работает.

## URL

| Кто | Адрес |
|---|---|
| Пациент / Telegram | `https://ДОМЕН` |
| Врач | `https://staff.ДОМЕН` |
| Admin | `https://admin.ДОМЕН` |

## Что закрыто в этом compose (код/конфиг)

- TLS на edge (Caddy + HSTS / security headers)
- Postgres/Redis/MinIO **не** торчат наружу
- Роли `miru_app` / `miru_admin` (admin без grants на таблицы ПМД)
- Redis AUTH, MinIO anonymous=none, SSE-S3 на put
- `IIN_PEPPER` / секреты обязательны; OTP debugCode не отдаётся в production
- Bootstrap только с секретом и по умолчанию выключен

## Что остаётся на заказчике / площадке (аттестация)

- Размещение **в РК**, модель угроз, ОРД, аттестация ГТС
- Шифрование тома ОС / бэкапы ≥30 суток только в РК
- Self-hosted LiveKit + egress в РК
- Регламент ключей, VPN/допуск, drill восстановления

См. `docs/compliance-status.md`.

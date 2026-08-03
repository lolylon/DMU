# Видео: пациент из дома → клиника

Пациент и врач **оба подключаются к общему SFU (LiveKit)**. Клиника не пробрасывает порты с ноутбука врача; телефон не ходит на `127.0.0.1`.

```
Пациент (Telegram/дом) ──wss/WebRTC──┐
                                     ├──► LiveKit + egress (контур РК)
Врач (клиника) ────────wss/WebRTC──┘         │
                                             ▼
                                           MinIO (запись в РК)
```

## Соответствие гос. требованиям (важно)

По `docs/architecture.md` (§1, §7):

| Вариант | Для локальной отладки | Для test/prod / аттестации |
|---|---|---|
| Docker LiveKit на ноутбуке | да (`ALLOW_LOCAL_LIVEKIT=true`) | нет |
| **LiveKit Cloud (зарубежный SaaS)** | только временный UX-spike | **нет** — «внешние SaaS видеосвязи» и зарубежные облака для контура с ПМД/записью запрещены |
| **Self-hosted LiveKit в ЦОД РК** (PS.kz / on-prem / аналог) + egress в MinIO РК | да | **да** — целевой контур |

Запись сессии (доказательная база) и медиатрафик консультации относятся к защищаемому контуру; их нельзя отдавать на иностранный managed SFU.

Разрешённые внешние сервисы **без ПМД в полезной нагрузке:** Telegram Bot API, SMS РК — это не замена LiveKit.

## Целевой путь (гос. контур): VPS/ЦОД в РК

1. ВМ в казахстанском ЦОД с публичным IP / TLS (`wss://livekit.your-domain.kz`).
2. На площадке: `livekit-server` + TURN + egress → MinIO в том же контуре.  
   Пример конфига: `deploy/livekit/livekit.remote.example.yaml`  
   Compose-профиль: `docker compose -f deploy/docker-compose.yml --profile remote-edge up -d` (на Linux VPS).
3. В `.env` API:

```env
ALLOW_LOCAL_LIVEKIT=false
LIVEKIT_URL=wss://livekit.your-domain.kz
LIVEKIT_PUBLIC_URL=wss://livekit.your-domain.kz
LIVEKIT_API_KEY=…
LIVEKIT_API_SECRET=…
# для приёмки / prod:
LIVEKIT_EGRESS_ENABLED=true
REQUIRE_LIVEKIT_EGRESS=true
```

4. `GET /api/health` → `video.remoteReady: true`.
5. Письменное решение заказчика по площадке (как для Postgres, §3.5.6).

## Временный UX-spike (не для сдачи)

LiveKit Cloud можно включить **только** чтобы проверить Telegram↔врач на демо, с пометкой «вне контура аттестации». В сдаваемый test/prod **не переносить**.

## Почему «cloudflared к ноутбуку» не решение

Туннель не заменяет SFU в РК: WebRTC-медиа с домашнего телефона до Docker на ПК нестабилен/неполон, и это всё равно не аттестуемый контур.

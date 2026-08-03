# Соответствие требованиям — честный статус (Miru Remote)

Дата: 2026-08-03.

## Вердикт

**Miru Remote (процессный пилот)** — доведён в коде до end-to-end контура.  
**«Полностью весь гос. ТЗ включая FrontDesk + крипто SDK + прод SMS»** — нет; это отдельные зависимости (см. ниже).

## Готово в продукте

- Auth: Argon2id, lockout, TOTP, rate limit, helmet/CORS  
- Tenancy, DenyTechPmd, object-level cases, AccessLog  
- Consent, cases, slots, sessions (LiveKit + egress wiring), chat/files  
- Scenario B participants, async path, profile FIFO queue  
- Conclusions + NCALayer + PDF + honest verificationOk  
- MIS manual bridge, registry, dossier ≤60s, catalog  
- Admin onboarding без SQL, readiness gate, tech log  
- Bootstrap всегда ротирует и печатает TOTP секреты (dev)  
- Telegram/SMS send при наличии env credentials  

## Ждёт заказчика / SDK / контур

| Пункт | Почему |
|---|---|
| FrontDesk | Отдельный продукт после Remote |
| NCA CMS crypto-verify | Официальный NCA SDK |
| Проверка MP4 egress на test РК | Инфра + прогон |
| SMS/Telegram prod | Токены в `.env` |
| Production МИС | Спеки API |
| Хостинг/аттестация РК | Вне кода |

См. также `docs/delivery-nfr11.md`, `docs/week-checklist.md`, `README.md`.

# Соответствие требованиям — честный статус (Miru Remote)

Дата: 2026-08-04.

## Вердикт

| Контур | Статус |
|---|---|
| **Локальный / UX-пилот** (синтетические пациенты) | End-to-end контур в коде есть; hardening для публичного VPS усилен |
| **Реальные ПМД на зарубежном VPS + LiveKit Cloud** | **Нельзя** заявлять соответствие (территория обработки, чужой медиа-контур) |
| **Аттестация ГТС / полный гос. ТЗ** | Нет: площадка РК, ОРД, self-hosted LiveKit, шифрование томов/бэкапов, NCA SDK, прод SMS — вне «просто deploy» |

## Готово в продукте (прикладной контур)

- Auth: Argon2id, lockout, TOTP, rate limit, helmet/CORS/HSTS, `trust proxy`
- Tenancy, DenyTechPmd (app), object-level cases, AccessLog (fail-closed)
- ИИН только peppered hash; patient OTP hashed; bootstrap по умолчанию выкл. + `x-bootstrap-secret` в production
- Admin SQL-путь через `ADMIN_DATABASE_URL` / роль `miru_admin` (без grants на таблицы ПМД)
- Consent, cases, slots, sessions (LiveKit + egress wiring), chat/files
- Conclusions + NCALayer + PDF + honest verificationOk
- MinIO: short-lived signed URL, SSE-S3 на put, anonymous deny в pilot compose
- Pilot compose: наружу только 80/443

## Сознательно не закрыто кодом (заказчик / ЦОД)

| Пункт | Почему |
|---|---|
| Хостинг/аттестация РК, ОРД, модель угроз (НФТ 11.6) | Орг. / площадка |
| Volume/TDE ключи, шифрованные бэкапы ≥30 сут только в РК | Ops |
| Self-hosted LiveKit в РК | Инфра (Cloud = только демо) |
| NCA CMS crypto-verify | Официальный SDK |
| Production МИС / SMS | Спеки и токены заказчика |
| FrontDesk F2 / Electron OTA | Позже |
| Cookie httpOnly + CSRF для staff | Сейчас Bearer + localStorage; XSS = риск сессии |

## Пилотный VPS

См. `docs/deploy-pilot-vps.md`. После seed: `ALLOW_BOOTSTRAP=false`. Только тестовые ИИН/учётки.

См. также `docs/delivery-nfr11.md`, `docs/architecture.md` §3.5–4.

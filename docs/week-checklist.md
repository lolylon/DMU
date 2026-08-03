# Week checklist — Miru Remote

## Before W1
- [ ] Архитектура согласована заказчиком
- [ ] Хостинг в РК подтверждён
- [ ] Режим МИС: интеграция / ручной мост
- [ ] SMS + Telegram test credentials

## W1 — Foundation
- [x] Login + Argon2id + password policy + lockout
- [x] 2FA (TOTP) for staff roles
- [x] Organization / membership isolation
- [x] AccessLog on PMD reads
- [x] Consent documents + acceptance (append-only)
- [x] Case + status history
- [x] Slots + booking
- [x] Mini App: IIN + consent + slots
- [x] Staff web: login + case card skeleton

## W2 — Session evidence
- [x] LiveKit rooms
- [x] Recording gate (storage + LiveKit; egress required in production)
- [x] Chat + files + checksums
- [x] Scenario B — add participant API (+ UX в staff)
- [x] Async cases — submit path without live session
- [x] Profile queue FIFO — enqueue / claim / list

## W3 — Closing the loop
- [x] Conclusions + versioning (immutable ConclusionVersion)
- [x] NCALayer batch signing (+ IIN bind, queue, PDF + HTML)
- [x] MIS port + manual bridge (outbox/inbox, mock/zhetysu/damumed stubs)
- [x] Dossier ≤60s (JSON package + checksum + SLA gate)
- [x] Public catalog (витрина МО / offers / slots)
- [x] Registry + org dashboard (оказано vs внесено)

## W4 — Admin + acceptance
- [x] Full org onboarding via admin UI (no SQL)
- [x] Bulk user import
- [x] Readiness checklist gate
- [x] Tech action log
- [x] Tests for documentation contour (policy + readiness + tech roles)
- [x] Delivery docs (NFR §11) — `docs/delivery-nfr11.md`
- [x] Pilot org dry-run path (bootstrap + Admin checklist `pilot_dry_run`)

## Government hardening (ongoing)
- [x] Честная матрица `docs/compliance-status.md`
- [x] Helmet + CORS + rate limit auth + bootstrap kill-switch in prod
- [x] Append-only DB grants migration
- [x] PDF заключения + `verificationOk` только при NCA_CMS_VERIFY
- [x] Egress wiring (compose + API); envelope_only явно в dev
- [ ] LiveKit Egress media verified on test-контуре РК
- [ ] NCA CMS SDK crypto-verify
- [ ] SMS/Telegram production adapters
- [ ] FrontDesk F1/F2
- [ ] Production MIS adapters (need API specs)

See `docs/compliance-status.md` for honest P0/P1 status.

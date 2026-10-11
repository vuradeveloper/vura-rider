# LAUNCH_TEST.md — RC3 launch test plan (run top to bottom, initial every box)

**Scope:** the whole customer journey on `release-candidate-3` — rider app,
driver APK (versionCode **2** / versionName **1.1**), server (migrations
001→001b→002→003 applied, `dist` fresh), flags at their LAUNCH defaults
(Module 1/2 flags as currently rolled out, **`performance_tier_enabled=false`**).

**Rule of the day: a red box stops the launch.** Record the commit SHAs you
are testing (they are the truth, not this file's name):

```
rider  release-candidate-3 = ________
driver release-candidate-3 = ________
server dist commit          = ________
```

Deep-dive references (this file only sequences them):
`FINAL_PREFLIGHT.md` (console-first deploy) · `DEPLOY_RC3.md` (this release) ·
`MODULE1_TEST.md` · `MODULE2_TEST.md` · `MODULE3_TEST.md` ·
`figma-ui/STAGE_ALL_MANUAL_TEST.md` · `PLAN_PUBLIC_SERVERS.md` §Verify.

---

## 0. Environment gates (before touching an app)

| # | Check | Expect | ✓ |
|---|-------|--------|---|
| 0.1 | EB console → `vura-rider-prod` | 1 instance only, health **Green**, latest version = the RC3 label | ☐ |
| 0.2 | Boot log (`/api/dev/diag` tail or console) | `[offerWorker] started … build <rc3-sha>`; single-instance WARNING present; **`[providers]` table printed with NO `NOT CONFIGURED` line** for the env vars production uses | ☐ |
| 0.3 | DB: `SELECT version/…` — migrations | `001`,`001b`,`002`,`003` all present; `performance_tier_thresholds` = 4 rows; `SELECT value FROM app_config WHERE key='performance_tier'` → `enabled:false` | ☐ |
| 0.4 | DB: module flags you intend today | Module 1 flag at its rolled-out value; `destination_matching_enabled` per rollout plan; driver allowlists contain today's pilot ids | ☐ |
| 0.5 | `GET /health` against the public URL | `{"status":"ok",…}` over HTTPS | ☐ |
| 0.6 | APK on the test handset | installs, launcher label **Vura Driver**, `adb shell dumpsys package app.vura.driver.figma \| grep versionName` → `1.1` | ☐ |

## 1. Rider journey (one phone, one card-less + one card rider if available)

| # | Steps | Expect | ✓ |
|---|-------|--------|---|
| 1.1 | Sign up / sign in (phone OTP) | lands on home, no console errors | ☐ |
| 1.2 | Book: pickup + destination, see fare | fare card renders, route polyline draws (uses `/api/route` → check 0.2's `ROUTE_PROVIDER_URL` line first) | ☐ |
| 1.3 | Search a place with GPS on, then with GPS off | on: sensible local results (HERE); off: bias line says `last_ride`/`last_search`/`none` — no wrong-city junk | ☐ |
| 1.4 | Matching → driver accepts | status machine: Finding → Driver on the way; driver app gets the offer in ≤ 1 s with screen on | ☐ |
| 1.5 | Trip: arrive → start → complete | driver screen flows; rider sees live car move (share page too — see 5.x) | ☐ |
| 1.6 | Payment (card flow if live, else cash) | receipt matches fare; **no number anywhere mentions tier commission** (Module 3 is display-only) | ☐ |
| 1.7 | Cancel paths: before accept, after accept | both sides return home; offers stop; no zombie `pending` rows (`SELECT count(*) FROM ride_offers WHERE status='pending'` → 0 when idle) | ☐ |
| 1.8 | Kill rider app mid-trip, relaunch | trip state restored from DB (resume effect), no duplicate ride | ☐ |

## 2. Driver journey (driver APK, allowlisted pilot driver)

| # | Steps | Expect | ✓ |
|---|-------|--------|---|
| 2.1 | Install over the old build if present | data survives; versionCode 2 accepted as an upgrade | ☐ |
| 2.2 | Go online, watch server | `driver_ping` every ~4 s, heartbeat ~4 s (`STAGE_ALL` G1) | ☐ |
| 2.3 | Receive offer → accept → pickup → start → complete | full loop; FCM push arrives even with app backgrounded (screen ON after) | ☐ |
| 2.4 | Destination (Module 2, if rolled out): set → matching → arrive | per `STAGE_ALL_MANUAL_TEST.md` B/C/E; flag off → entry button absent (A2) | ☐ |
| 2.5 | **Tier hidden at launch (Module 3, flag OFF)** | no "Your tier" button anywhere, no `driver_tier*` rows growing, no `[tier] recalc` log lines | ☐ |
| 2.6 | Offline/online toggle + app relaunch | online state persists (vura.driver.online), server agrees | ☐ |

## 3. Push & socket delivery matrix

| # | Case | Expect | ✓ |
|---|------|--------|---|
| 3.1 | Offer with driver app backgrounded (screen off) | FCM notification taps through to the offer; `push_sends` row `result=sent` | ☐ |
| 3.2 | Offer with socket connected | `trace push_result delivered≥1` OR socket delivered — never both dead | ☐ |
| 3.3 | Rider "Driver arrived" / "Trip completed" notifications | arrive on the rider phone (Capacitor FCM path, `_OFFER_DELIVERY.md`) | ☐ |
| 3.4 | Airplane mode 60 s on driver, restore | socket reconnects ≤ 5 s; online state re-announced; no duplicate offers | ☐ |

## 4. Resilience / known-boundary checks

| # | Case | Expect | ✓ |
|---|------|--------|---|
| 4.1 | Two rides booked simultaneously (2 riders) | each gets a driver; the 001b unique index refuses double-offer (`pending` per driver ≤ 1) | ☐ |
| 4.2 | Zero drivers online | rider gets "no drivers" at ~90 s, ride parks `no_drivers`, revives when a driver appears | ☐ |
| 4.3 | Provider seams under duress (if safe to test): unset `ROUTE_PROVIDER_URL` in a STAGING env | `/api/route` → **503** naming the var; boot log `NOT CONFIGURED` — production must never show this | ☐ |
| 4.4 | DB backup/snapshot exists for today | RDS snapshot taken or confirmed current per `FINAL_PREFLIGHT.md` | ☐ |

## 5. Trip-share page (public link)

| # | Steps | Expect | ✓ |
|---|-------|--------|---|
| 5.1 | Open the share link in a PRIVATE browser window (no session) | page loads, status card, map with tiles from `SHARE_TILE_URL` (or grey map + markers if that seam is deliberately unset — never tile.openstreetmap.org from production) | ☐ |
| 5.2 | Route line draws | polyline via `/api/route`, same seam as 1.2 | ☐ |
| 5.3 | After trip ends | "Sharing ended" banner, no live updates | ☐ |

## 6. Module 3 pilot (OPTIONAL on launch day — flag OFF is the launch default)

Only if the team explicitly decides to start the RC3 tier rollout
(`MODULE3_TEST.md` §3 order), otherwise tick as "deferred":

| # | Steps | Expect | ✓ |
|---|-------|--------|---|
| 6.1 | Flip `performance_tier_enabled=true` (SQL, DB cache ~10 s) | boot/log shows `[tier]` nightly only; **still no driver-facing change** | ☐ |
| 6.2 | Manual trigger `POST /api/admin/performance-tiers/run` (admin email) | response `{ran:true, processed:N}`; `driver_tiers` rows appear; history only where tiers CHANGED | ☐ |
| 6.3 | Add pilot id to `performance_tier_rollout_driver_ids` | pilot sees "Your tier"; `STAGE_ALL` T4–T5 pass on device | ☐ |
| 6.4 | Kill switches rehearsed | flag=false → everything inert; empty allowlist → screens hidden; documented in DEPLOY_RC3 §7 | ☐ |

## 7. Sign-off

| Gate | Owner | Initials | Time |
|------|-------|----------|------|
| §0 environment | | | |
| §1 rider journey | | | |
| §2 driver journey | | | |
| §3 push/socket | | | |
| §4 resilience | | | |
| §5 share page | | | |
| §6 module 3 (or deferred) | | | |
| **LAUNCH GO/NO-GO** | | | |

**If any red box cannot be fixed within the window: roll back per
`DEPLOY_RC3.md` §7 (flag switches first — seconds, no redeploy) and re-run
§0 on the previous version.**


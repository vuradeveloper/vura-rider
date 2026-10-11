# PLAN_BACKGROUND_GPS.md — keep driver positions alive when the screen is off

**Status: PLAN ONLY. Nothing in RC3 changes background GPS, permissions, the
appId or signing (that is a hard RC3 constraint). This file is the decision
record + the staged path for the FIRST post-RC3 driver-app milestone.**

## Where we are today (facts, RC3)

| Fact | Where |
|---|---|
| Position push every **4 s** + heartbeat every **4 s**, foreground only | `figma-ui/src/lib/telemetry.ts` (`DEFAULT_GPS_PUSH_MS`/`DEFAULT_HEARTBEAT_MS`, runtime-overridable via `vura.gps_push_ms` / `window.__VURA_TELEMETRY`) |
| Timers live in the DriverHome effect and die with the WebView | `figma-ui/src/App.tsx` (DriverHome GPS effect) |
| Manifest: `ACCESS_FINE_LOCATION` + `ACCESS_COARSE_LOCATION` only | figma-ui Android manifest (Capacitor) |
| **No** foreground service, **no** `ACCESS_BACKGROUND_LOCATION`, **no** work manager | nothing in `figma-ui/android/` |
| Screen off → WebView timers throttle/stop; app swiped away → everything stops | Android behaviour |
| Server demotes a silent driver after `DRIVER_STALE_SECONDS` (20 s) and excludes stale candidates from matching | `server/src/services/dispatch.ts`, `app_config.stale_seconds` |
| Offers still REACH a backgrounded app via FCM push (`notify.ts` → `vura_ride_offers` channel), but on a stale position | `_OFFER_DELIVERY.md` |

**The actual gap:** with the screen off, the driver keeps receiving offer
PUSHES but their position freezes; after ~20 s the server sweeps them out of
matching (and destination-mode arrival checks go blind). A locked phone mid-shift
is exactly when an offer must not be lost — which is why this is the first
post-RC3 milestone.

## Options considered

| # | Option | What it buys | Cost / risk | Verdict |
|---|---|---|---|---|
| A | Stay foreground-only (today) | zero risk, zero battery cost | locked-screen drivers age out of matching after 20 s | acceptable short-term; NOT the end state |
| B | **Android foreground service, `foregroundServiceType="location"`** while ONLINE | positions keep flowing with the screen off — the standard rideshare approach; Android 14+ compliant (`FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION`, persistent notification) | visible notification (by design), OEM battery killers to tame, ~1 native plugin + manifest work, higher battery while online | **RECOMMENDED** — the only option that actually fixes it |
| C | `ACCESS_BACKGROUND_LOCATION` + plain background loops | no service/notification | Android 10+ demands the scary "Allow all the time" permission; still killed aggressively | rejected |
| D | One-shot `WorkManager` periodic tasks | survives swipe-kill | 15-min granularity — useless for 4 s dispatch | deferred |

**Decision: Option B, staged, behind a runtime flag, default OFF.**

## Staged path (each stage ships only after the previous passes on a real device)

### Stage B0 — measure first (no code risk)
- Query the live DB for heartbeat gaps to size the problem:
  ```sql
  SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY gap_s) AS p50,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY gap_s) AS p95
    FROM (SELECT EXTRACT(EPOCH FROM (now() - last_heartbeat_at)) AS gap_s
            FROM driver_profiles WHERE is_online) g;
  ```
- Compare that baseline after Stage B2 (below).

### Stage B1 — spike (branch `spike/background-fgs`, never merged blind)
- Add a Capacitor-compatible foreground-service plugin (evaluate
  `@capacitor-community/background-locator` vs a minimal custom plugin whose
  only job is `startForegroundService(type=location)` so the EXISTING WebView
  timers keep running inside it). The service must NOT implement its own
  positioning loop — one source of truth for cadence stays `telemetry.ts`.
- Manifest additions: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, a
  service declaration with `android:foregroundServiceType="location"`.
  **`ACCESS_BACKGROUND_LOCATION` is deliberately NOT added** (Option C rejected).
- Notification copy: "Vura Driver — sharing your location while you're online"
  with a Stop action wired to the existing offline toggle.
- Runtime flag `vura.gps_background` (same override pattern as `telemetry.ts`):
  **default false**, so installing the build changes nothing until it is
  switched on per device/pilot.

### Stage B2 — device matrix (before any pilot)

| Case | Expect |
|---|---|
| Online + screen off 30 min | `driver_ping` rows continue ~4 s; heartbeat-gap p95 < 6 s |
| Screen off + Doze (10 min idle, unplugged) | pings continue — verify on Samsung/Xiaomi, their killers are the real test |
| App swiped away while online | service dies with it (v1 behaviour = today, no regression); driver offline server-side within `DRIVER_STALE_SECONDS` |
| Stop action in the notification | service stops, driver offline, cadence logic unchanged |
| Battery: 1 h screen-off online vs today | record mAh delta; accept if < ~8%/h on the test handset |
| `vura.gps_background=false` + reboot | byte-for-byte today's behaviour |

### Stage B3 — pilot (allowlist, same staged shape as every flag here)
- 2–3 real drivers, one week: heartbeat-gap percentiles (B0 query), offer
  acceptance while locked, battery complaints, OEM kill reports.
- Ship inert → pilot allowlist → widen; kill switch = the runtime flag
  (seconds, no rebuild, no reinstall).

## Explicit non-goals for this plan

- No iOS background modes (driver app is Android/APK only for now).
- No change to the 4 s cadence itself — background mode keeps the SAME loop alive.
- No server changes: `dispatch.ts` staleness already handles "signal lost"; the
  fix is entirely client-side.
- No change to the RC3 APK (`vura-driver-rc3-release-signed.apk`, versionCode 2)
  — a background-GPS build is a later, separately versioned APK.

## Estimate (once approved)

B1 spike 2–3 days · B2 matrix 2 days · B3 pilot 1 week elapsed · manifest +
notification + flag plumbing ships as its own release with its own
`STAGE*MANUAL_TEST.md`.


# PLAN_DRIVER_APP.md — driver app plan (figma-ui → production APK)

**Status: PLAN ONLY. No code, no merges, no deploys, no changes to `vura-driver`
happen at this stage.** All paths below refer to `vura-driver/` unless stated.
Line numbers are from the audit snapshot and will drift — re-locate by symbol
when implementing.

Context this plan builds on (read-only audit, 2026-10):

- Two apps exist: the legacy Expo/RN app (`app/`, `android/`, appId
  `app.vura.driver`) — it **never sends location** (dead `expo-location` /
  `react-native-maps`) — and `figma-ui/` (React + Vite + Capacitor, appId
  `app.vura.driver.figma`), which does **all** GPS/heartbeat and builds its own
  APK. Everything below happens in `figma-ui/` unless a stage says otherwise.
- GPS today: `figma-ui/src/App.tsx:659–740` — location push every **15 s**
  (`setInterval(push, 15000)` at :720), 4 s retry until first fix (:724),
  socket heartbeat every **10 s** (:725), foreground-only. Android FINE+COARSE
  declared; no background location, no foreground service.
- Server contract for Module 2 already shipped (see `vura-rider` docs
  `MODULE2_TEST.md` §3–§7): REST `POST|GET /api/drivers/destination`, socket
  `driver:destination:set|clear|status` (+ `:ack`), server push event
  `driver:destination:ended {reason}`, `DestinationStatus` carries `banner`,
  `uses_today`, `max_uses`, `paused`, `pause_reason`, `sast_day`, `expires_at`.
- AGENTS.md rule: the legacy app is Expo — **before writing any Expo/RN code,
  read the versioned docs at <https://docs.expo.dev/versions/v57.0.0/>**. This
  plan touches no Expo code; Stage 4 only *reads* the RN app for a parity list.

Global constraints for every stage:

- **No server changes.** Module 2 is feature-flagged off by default
  (`destination_matching_enabled=false`) — stages 1–3 are safe to build while
  the flag is off.
- **Same backend** (`https://api.ridevura.com`) throughout; nothing in
  `vura-rider` is modified by this plan.
- Each stage ships as its own APK build and is independently revertible.

---

## Stage 1 — Set Destination screen + 4 s GPS (under CURRENT appId `app.vura.driver.figma`)

### Goal

A driver picks a destination on the map, sees the Module 2 banner, and watches
the session end (arrived / offline / idle / flag-off → `paused`) — with the
phone reporting position every 4 s so the server can later tighten thresholds
(`stale_seconds` 40 → 20) once this APK is live (Q7).

### Files touched (planned)

| File | Change |
|---|---|
| `figma-ui/src/App.tsx` | Extend `type DriverScreen` (:55) with `'destination'`; add the `{dScreen === 'destination' && …}` render next to :2233–2302; entry button on driver-home (`DriverHome`, :2233); banner component while `DestinationStatus.active`; GPS :720 `15000 → 4000` and heartbeat :725 `10000 → 4000` via one named constant |
| `figma-ui/src/components/DestinationScreen.tsx` | **New.** Map picker (reuses `LeafletMap`), place search, confirm CTA, client-side >1 km hint ahead of the server's `already_close` 409, uses-left counter, disabled/paused states |
| `figma-ui/src/lib/backend.ts` | `getDestinationStatus()`, `setDestination({lat,lng,label})`, `clearDestination()` — REST `GET\|POST /api/drivers/destination` with socket twin (`driver:destination:status\|set\|clear` + `:ack`, timeout → REST fallback, same dual-contract pattern as existing helpers); subscribe `driver:destination:ended {reason}`; map error codes (`disabled` 403, `already_close` 409, `daily_limit` 429, `not_online`/`on_trip` 409, `invalid_coordinates` 400) to copy |
| `figma-ui/src/lib/destinationState.ts` | **New (small).** Cache last `DestinationStatus` in `localStorage` (crash-survival mirror; app still re-GETs on launch — DB is authoritative) |

Banner copy comes from the **server** (`DestinationStatus.banner`), not
client-formatted: `Going to [place] - 1 of 2 uses today`. Client renders
`paused`/`pause_reason` (fix 4: flag off → paused, not destroyed) and clears
the banner on `driver:destination:ended` using `reason` (`arrived`, `offline`,
`timeout_3h`, `feature_disabled`, `idle`).

### Risks

1. **4 s GPS battery/thermal cost** — 3.75× more requests. Keep `maximumAge`
   ≥ 3000 ms so a cached fix satisfies the interval; interval only while
   `online` (already gated). Measure before/after.
2. **Server load** — 3.75× pings/driver; `driver_cells` upsert is one indexed
   row per ping (designed for 4 s — `driverIndex.ts` header). Single-instance
   EB: confirm via `/debug/counters`.
3. **Offer rate** — liveness only; compare `MODULE2_TEST.md` §8 counters.
4. **Daily-limit UX** — 429 `daily_limit` must show remaining uses, not a raw
   error.
5. **`already_close` race** — show the server's message verbatim.
6. **WebView timer throttling** when backgrounded — accepted in Stage 1;
   Stage 2 fixes background.

### Test method — real device

1. `figma-ui/_build-apk.cmd` → install on a physical Android phone
   (side-by-side with the RN app, both icons coexist).
2. Enable Module 2 for this driver only (`MODULE2_TEST.md` §2 allowlist SQL).
3. Drive §3–§5 from the **phone UI** instead of curl: activate → banner exact
   match → kill app → relaunch → banner restored → clear → DB row verified.
4. 4 s check: `adb logcat` + SQL `SELECT now()-last_seen_at FROM driver_cells
   WHERE user_id=…` while parked — gap must stay < 6 s (was < 17 s).
5. Battery: `adb shell dumpsys batterystats`, 1 h online idle (screen on, then
   off), record %/h for the 15 s build and the 4 s build.
6. Error paths: L1 `already_close`, L4 `daily_limit` (SQL force), flag-off →
   `paused` copy (§7 L7e).

### Rollback

- **App:** reinstall the previous `.figma` APK (kept as a release artifact).
- **Interval:** single constant revert → 15 s.
- **Server:** `UPDATE app_config … stale_seconds` back to 40 (SQL, 10 s cache).
- No schema, no migration, no server deploy.

---

## Stage 2 — Background location (foreground service)

### Goal

Position keeps flowing while the screen is off / app is minimized (WebView
`navigator.geolocation` dies otherwise), so a driver mid-trip to a destination
is never demoted to `offline` by the 15-minute safety timeout or the
`destination_offline_grace_seconds` (300 s) grace.

### Plugin options (choose in this order)

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. `@capacitor-community/background-geolocation`** (recommended) | Native Android foreground service; options: `locationInterval` 4–10 s, `desiredAccuracy: HIGH`, `distanceFilter: 0`, `stopOnTerminate: false`, `pauseLocationUpdates: false`, notification title/text/channel | Maintained community plugin; wraps exactly the FGS-with-notification pattern Android requires; config in TS | New native dependency; `cap sync` + Gradle; battery tuning |
| B. `@capacitor/geolocation` + hand-rolled foreground service | `watchPosition` in foreground; custom plugin for the service | Fewer third-party deps | We own the service code; highest effort |
| C. Stay foreground-only | Status quo | Zero work | Destination mode is pointless with screen off — rejected |

### Files touched (planned)

| File | Change |
|---|---|
| `figma-ui/package.json` | add plugin A |
| `figma-ui/src/App.tsx` | replace the `navigator.geolocation` block (:679–740) with the plugin watch API behind a `useNativeLocation` flag (kill switch); keep the `gpsState` tri-state (`ok/searching/denied`) mapping |
| `figma-ui/src/lib/location.ts` | **New.** Plugin wrapper: start/stop tied to `online`, notification config, error mapping |
| `figma-ui/android/app/src/main/AndroidManifest.xml` | add `ACCESS_BACKGROUND_LOCATION`*, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS` (API 33+); **no** `RECEIVE_BOOT_COMPLETED` initially (boot restart adds Play scrutiny) — *only for profile 2 below |
| `figma-ui/capacitor.config.ts` | plugin A options block |
| Settings/Account screen | toggle "Keep GPS running when screen is off" + honest battery copy |

### Android permissions & Google Play declaration

- Two viable permission profiles:
  1. **FGS without `ACCESS_BACKGROUND_LOCATION`** (ship first): location while
     the service runs (started from the visible app). Lower Play friction.
  2. **With `ACCESS_BACKGROUND_LOCATION`**: only if the service must survive
     swipe-away and self-restart. Play then requires: data-safety form declares
     background location, a **prominent in-app screencast** explaining the use,
     and pre-review before the production track.
- Play Console: *App content → Foreground service* → type `location` + use-case
  text (mandatory for Android 14+ FGS types); *Background location* (profile 2
  only); *Data safety* → location "while in use" (+ "in background" profile 2).
- API 33+: prompt for `POST_NOTIFICATIONS` at first go-online — the FGS
  notification itself is non-dismissable but permission governs visibility.

### What the driver sees

- Persistent notification: **"Vura Driver — location sharing active"** /
  "Only while you're online"; not swipeable; tap reopens the app.
- Android 12+ approximate-only installs → existing in-app banner at :769
  ("Location is off for Vura Driver…") reused: "Precise location required to
  receive trips".
- Battery settings may attribute drain to the app — the Settings toggle +
  copy above is the answer, plus a link to Android location settings (existing
  deep-link copy).

### Battery impact (publish measured numbers in Settings copy)

- Navigation-class drain while actively driving: measure, expect roughly
  **8–15 %/h screen-on**, lower screen-off — publish the measured value, not
  an estimate.
- Idle mitigation: `locationInterval` 15–30 s while online with **no** active
  trip/destination session, 4 s while a session/trip is active (runtime
  interval change) — halves idle drain with zero dispatch impact.

### Test method — real device

1. Grant permissions → online → screen off → walk/drive 10 min.
2. SQL: `driver_cells.last_seen_at` gap stays < interval+2 s the whole time;
   **no** `drivers_offline_timeout` / `drivers_demoted` rows in `ride_events`.
3. Swipe-away test: profile 1 → clean stop + banner on next open (accepted);
   profile 2 → service restarts and republishes within 60 s.
4. Doze: `adb shell dumpsys deviceidle force-idle` 20 min → heartbeat survives
   (FGS exemption), no session ended as `offline`.
5. Battery: 1 h screen-off online, `dumpsys batterystats` before/after.
6. Notification visible, non-dismissible, tap → app opens; denied-permission
   path still shows the in-app banner.
7. **Play route:** upload to *internal testing* first — FGS/background
   declarations are validated at upload, not locally.

### Rollback

- **Runtime kill switch:** `useNativeLocation` off → Stage 1 WebView loop
  (old path kept for one release).
- **Config:** plugin options disabled via local override.
- **Install-level:** previous APK reinstalls over the same appId; Play
  declarations remain but idle when the plugin is off.
- Profile-2 rejection ⇒ drop to profile 1; ship nothing until accepted.

---

## Stage 3 — Navigation map: MapLibre GL JS (vector tiles) behind a feature flag

### Goal

Replace the raster Leaflet map with a vector-tile MapLibre GL JS map (smooth
zoom, night style, future 3D/route detail), **behind a feature flag**, with
Leaflet kept as a working fallback. Scope: base map + route polyline + markers
inside `figma-ui`; turn-by-turn voice stays delegated to `openWaze()`.

### Files touched (planned)

| File | Change |
|---|---|
| `figma-ui/package.json` | add `maplibre-gl` |
| `figma-ui/src/components/MapLibreMap.tsx` | **New.** Same prop surface as `LeafletMap` (`marker`, `route`, `follow`, `zoom`, `dark`); style URL from flag config |
| `figma-ui/src/components/LeafletMap.tsx` | **unchanged** — remains the fallback renderer |
| `figma-ui/src/App.tsx` | one chooser: `flag.maplibre ? <MapLibreMap/> : <LeafletMap/>`; identical marker/route data path |
| `figma-ui/src/lib/mapFlag.ts` | **New.** Flag source: `localStorage` override → server-driven default (config endpoint if available, else build-time `VITE_MAP_PROVIDER=leaflet\|maplibre`) so it flips without an APK |
| vendored CSS | MapLibre CSS bundled — **no CDN** (APK must work with CDNs blocked/offline) |

Flag rules: default **off**; flag off ⇒ MapLibre payload not loaded (lazy
import when on); render failure (style fetch error, WebGL unsupported in the
WebView) **auto-falls-back to Leaflet** with one log line.

### Tile provider options (vector tiles) — terms & cost

**Hard note:** today's tiles are public OSM raster
(`https://{s}.tile.openstreetmap.org/…`, `LeafletMap.tsx:132`) — against the
OSM tile usage policy for production traffic; must not carry over to MapLibre.
Same for the public OSRM demo (routing table below).

| Provider | Free tier | Paid | Terms / notes |
|---|---|---|---|
| **OpenFreeMap** | No limits, no key, commercial use allowed | Optional support plans (donations) | ODbL attribution auto-added by MapLibre; **no SLA**, single-maintainer — acceptable only with Leaflet fallback + provider-switch flag |
| **MapTiler Cloud** | $0 tier: 5 GB storage, limited sessions — testing/non-commercial only, logo required | **Flex $30/mo** + per-session overage (soft quotas) | MapLibre style URLs out of the box; clear ToS; EU-hosted |
| **Stadia Maps** | Free: 200 000 credits/mo — **commercial use NOT allowed** | Starter $20/mo (1 M credits), Standard $80/mo | Credit-based billing (vector tiles ~1 credit-class per their table); Stamen styles; attribution required |
| **Mapbox** | Free tier with monthly cap; free tier has commercial restrictions | usage-based after cap | Attribution/logo rules; style lock-in risk |
| **Self-hosted** (protomaps/tilemaker → S3/CloudFront, pattern already in `deploy/SELFHOST-MAPS.md`) | infra cost only (EC2/S3 egress) | scales with traffic | Full control, ODbL attribution still required; ops burden on a team of one |

Recommended first pair: **OpenFreeMap default (no key) + MapTiler Flex paid
fallback** — both are a style-URL config flip (flagged), not an APK.

### Routing provider options (`/api/route` upstream — server-side seam)

Routing stays server-side: `server/src/routes/route.ts`
`UPSTREAM = ROUTE_PROVIDER_URL || public OSRM demo`. Swapping it needs **no app
release**; but the default (public demo) is unacceptable for production and
must be replaced before Stage 3 goes live for real traffic.

| Option | Cost | Terms / notes |
|---|---|---|
| **Self-hosted OSRM** (documented: `deploy/SELFHOST-MAPS.md`) | EC2 time only | Free software (BSD); you carry ops |
| **Self-hosted Valhalla** | EC2 time only | MIT; stronger ETA/traffic options; heavier RAM |
| **GraphHopper cloud** | paid per request (trial quota free) | commercial ToS; turn-by-turn included |
| **Stadia Maps routing** | credits per request (~20/req class) | same credit wallet as tiles — one bill |
| **MapTiler** hosted OSRM | on Flex plan | one vendor for tiles + route |
| **HERE** | metered | `HERE_API_KEY` already in the stack for search — reuse, keep billing consolidated |
| Google Directions | highest per-request cost | avoid unless product demands it |
| ~~Public OSRM demo `router.project-osrm.org`~~ | $0 | **NOT ACCEPTABLE for production** — bans heavy use, no SLA, same status as public OSM raster tiles |

### Test method — real device

1. Flag **off** → Leaflet byte-identical (regression baseline: open map,
   marker, route line, Waze hand-off).
2. Flag **on** → vector style renders; pinch-zoom vs raster; route polyline
   from the same `/api/route` payload; markers track GPS at the 4 s cadence
   with no jitter.
3. Kill-switch drill: style URL pointed at a blackhole → auto-fallback to
   Leaflet within one render cycle, logged.
4. Airplane mode → cached render acceptable, **no white screen**.
5. 1 h battery with map open (GPU cost) on the **cheapest** supported phone.
6. Attribution audit: ODbL credit visible on every render.

### Rollback

- Flag off (runtime, seconds) → Leaflet everywhere; MapLibre never loads.
- Full revert: delete `MapLibreMap.tsx` + dependency in a follow-up APK.
- Provider switch (OpenFreeMap → MapTiler) = style-URL config change only.

---

## Stage 4 — appId switch to `app.vura.driver` (replace the RN app)

### Goal

The Capacitor app becomes **the** driver app: same package id, same signing
key, so it installs as an in-place update over the React Native APK. Staged so
drivers can be moved and pulled back.

### Files touched (planned)

| File | Change |
|---|---|
| `figma-ui/capacitor.config.ts` | `appId: 'app.vura.driver.figma' → 'app.vura.driver'` (the comment at :6–13 documents exactly this plan) |
| `figma-ui/android/app/build.gradle` | `applicationId` (:7) → `app.vura.driver`; **`versionCode` must exceed the RN app's** or Android refuses the update |
| `figma-ui/android/app/google-services.json` | must contain package `app.vura.driver` (Firebase console `vura-f667d` → add package → re-download) — push (`src/lib/notify.ts`) breaks otherwise |
| Signing config | sign with **the same keystore as the RN app** (gate below) |
| `vura-driver/android/app/build.gradle` (READ ONLY) | lines 100–115: `signingConfigs.debug { storeFile file('debug.keystore') }` is used for **both** debug and release — verify what actually signed the shipped APK |

### Keystore gate — must pass before ANY packaging

```bash
# 1. Fingerprint the APK drivers currently have (downloaded/ADB copy):
keytool -printcert -jarfile current-driver.apk     # SHA-1 / SHA-256
# 2. Fingerprint the keystore the Capacitor build will use:
keytool -list -keystore <same-keystore> -alias <alias>
# MUST match. Mismatch => INSTALL_FAILED_UPDATE_INCOMPATIBLE.
```

The RN `build.gradle` signs with the repo's `debug.keystore`. If fleet devices
were really signed with that key, the Capacitor release build must use the
same file; if they came via Play App Signing, the **upload key** must match.
Resolve with one `adb install -r` smoke test of the Capacitor APK **over the
real RN APK** before announcing anything.

### Parity list — RN features figma-ui must be checked for

| RN feature | Path | figma-ui status |
|---|---|---|
| In-trip chat | `app/driver/chat.tsx` | ❌ none found — build or explicitly retire |
| Promotions | `app/promotions.tsx` | ❌ only a static "Promo Codes" mock row (`App.tsx:551`) — real promotions screen missing |
| Help | `app/help.tsx` | ✅ ported — `SettingsScreen.tsx` `HelpCenter` ("port of the native app/help.tsx") wired via `DriverAccountV2` support sub-page |
| Safety / SOS | `app/safety.tsx` | ⚠️ `SafetyScreen.tsx` exists — verify wired, not dead code |
| Wallet / payouts | `app/wallet.tsx` | ⚠️ `WalletScreen.tsx` exists — verify wiring |
| Trips history + detail | `app/driver/trips.tsx` | ⚠️ only recent-trips inline (`getRecentTrips`) — verify full list/detail |
| Vehicle + document scan | `vehicle.tsx`, `BarcodeScannerModal.tsx` | ✅ `VehicleLinkScreen`, `DriverDocuments`, `CarScanImport` — verify scanner parity |
| Earnings / Settings / Account | `earnings.tsx`, `settings.tsx`, `account.tsx` | ✅ `Earnings`, `SettingsScreen`, `DriverAccountV2` |
| Auth login/signup/forgot | `login.tsx`, `signup.tsx`, `forgot.tsx` | ⚠️ verify full flow incl. password reset |
| Push notifications | RN Expo push | ⚠️ `src/lib/notify.ts` exists — verify tokens register to the same server columns |
| OTA updates | Expo OTA in `app/_layout.tsx` | ❌ none in figma-ui — ship via APK builds only (document) |
| Location + maps | `expo-location`, `react-native-maps` | ✅ already dead in RN — figma-ui is the real source |

Rule: **no feature loss at switch** — anything ❌ must be built, explicitly
retired in writing, or Stage 4 waits.

### Staged rollout

1. **Pre-flight:** Stages 1–3 passed; parity table closed; keystore gate
   passed; Firebase package added; `versionCode` > RN's; last signed RN APK
   kept as rollback artifact.
2. **Internal:** 3–5 drivers on the switched build; retire the side-by-side
   `.figma` package (uninstall) so one phone doesn't hold two apps
   double-registering push tokens.
3. **Pilot:** ~10 % of the fleet for 1 week — watch push delivery
   (`push_sends.delivered`), offer acceptance rate, `driver_cells` liveness,
   crash-free rate.
4. **100 %:** RN build deprecated; rollback APK (below) kept indefinitely.
5. **Cleanup (weeks later):** remove the RN app from distribution paths —
   deleting it from the repo is a separate decision.

### Test method — real device

1. **Over-the-top:** install the real RN APK → `adb install -r` the Capacitor
   APK with the new appId → must succeed as an *update* (same signature);
   re-login required (document it — RN local state is not migrated).
2. Full `MODULE2_TEST.md` §0–§9 pass from this APK.
3. Push: register → server send → notification arrives with app closed (FCM) →
   tap opens the right screen.
4. Offer loop: 1 h normal online time, compare `offer_sent` / acceptance
   counters against the RN baseline.
5. Flag kill-switch: `destination_matching_enabled=false` mid-session → banner
   shows paused copy, app stable — no app rollback needed.

### Rollback

- **Per-driver:** reinstall the kept RN APK (same key). **Prepare this before
  rollout:** if the Capacitor build's `versionCode` passes RN's, a rollback
  needs a bumped RN `versionCode` built and signed in advance — otherwise
  Android refuses the downgrade.
- **Play track** (if used): halt rollout percentage; pair with the prepared APK.
- Server-side: nothing deployed — flags only; the Stage 2 kill switch and
  Stage 3 flag stay independently revertible after the switch.

---

## Order & dependencies

```
Stage 1 (destination + 4 s GPS)     — no deps; server flag can stay OFF
   └─ Stage 2 (background GPS)      — depends on 1 (interval constants, gpsState)
        └─ Stage 3 (MapLibre)       — sequenced after 2 (both touch the
                                      map/GPS-heavy home screen)
             └─ Stage 4 (appId)     — HARD gate on 1+2 parity + keystore proof
```

Nothing in this plan merges, deploys `vura-rider`, or edits server code; the
only production-touching act is Stage 4's eventual rollout, which is its own
decision gate.





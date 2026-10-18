# Safety Suite — Test Plan (§7)

Covers: normal ride, route deviation, long stop, wrong PIN, SOS press,
driver-preference matching (shadow), privacy/retention. Server unit tests are
in `server/src/services/safety.test.ts` (22) — this file is the manual e2e pass.

**Setup:** deploy server (migration `017_safety.sql` runs on boot with
`RUN_MIGRATIONS_ON_BOOT=true`, or the services self-heal via `ensureSafetyTables`),
redeploy Vercel (console), install BOTH new APKs (rider + driver).

## 1. Normal ride (nothing false-alarms)
1. Book → accept → arrive → enter rider PIN → begin trip → complete.
2. Console → Safety → Live map: the ride appears, driver marker moves every
   ~5 s, selecting it draws the travelled path; Audit log gains a
   `safety.view_location` row per selection.
3. No anomalies appear; no check-in prompt fires; rider sees the 4-digit start
   code card while the driver is en route (disappears once trip starts).

## 2. Route deviation
1. In Settings → Safety settings set **Route deviation = 100 m**.
2. Mid-trip, drive >100 m off the pickup→drop-off corridor (side street).
3. Within one sweep (≤20 s): rider gets the "Is everything okay?" modal;
   console → Anomaly log shows **Route deviation** (`new` → `checkin_sent`).
4. Tap **I'm safe** → anomaly → `safe`, no admin escalation.
5. Repeat; DON'T answer → after the check-in deadline the anomaly →
   `escalated`, Dashboard shows the red banner.

## 3. Long stop
1. Set **Unnecessary stop = 60 s**, exclusion zone = 120 m.
2. Stop 2+ min mid-route → anomaly **Unnecessary stop** with lat/lng.
3. Wait the same time AT the pickup point → no anomaly (exclusion zone).

## 4. Wrong PIN
1. Driver taps "Start trip — enter rider's code" → keypad opens.
2. Enter 1 wrong digit ×3 attempts: each wrong → "Wrong code — N attempts
   left"; rider gets `safety:pin_locked` alert + push on the 3rd;
   `safety_events` rows `pin_failed`/`pin_locked` exist; ride stays
   `driver_arrived` (never starts).
3. Correct PIN → trip starts; PIN then unreadable (`GET /api/safety/pin` 404).
4. Cancel a ride after accept → its PIN is dead (verify refuses non
   driver_arrived status).

## 5. SOS press
1. Rider: hold the shield button 1.5 s → red while holding → green tick +
   "SOS sent" banner with the server's confirmation.
2. Console immediately: Dashboard pulses red ("N SOS ACTIVE"), SOS & alerts
   shows rider name+phone, driver name+phone, car+plate, GPS lat/lng (Open in
   maps), ride id + started time.
3. Acknowledge → Resolve with an outcome → audit rows `sos.handled`.
4. Driver: hold the shield on pickup/dropoff screens → same flow, role=driver.
5. From a check-in prompt, tap **Send SOS** → alert + anomaly marked escalated.

## 6. Driver preference matching (SHADOW MODE)
1. Driver → Account → Settings → Safety: set gender = Female → the
   **Only accept women riders** toggle appears; switch it on (male/other →
   toggle disappears and any stored on-state is cleared).
2. Take several dispatches: server log must show
   `[safety/shadow] ride=… pool=… women_only_drivers=N (NOT filtered …)`
   when an opted-in driver is in the pool — and the driver must STILL receive
   mixed requests (no filtering yet).
3. Confirm no change to wait times/ETA vs. before (matching untouched).

## 7. Privacy & retention
1. Settings → Safety settings: change **Location retention** to 1 day → Save
   → audit `safety.config_updated` with old/new values.
2. Rider Safety Center shows the trip-tracking consent paragraph; driver
   Account → Safety shows the same.
3. Server log after boot+60 s: `[safety] purged N location point(s) past
   retention`; `ride_location_points` grows ONLY during active rides.

## Automated coverage (server, `npm test`)
- Detectors: haversine/cross-track maths, deviation/stop/overrun/silence
  each with positive + negative + floor/exclusion cases.
- PIN: mint idempotency, rider-only 4-digit read, happy verify, 3-strike lock
  + journal, wrong driver/status refused, PIN-less ride never stranded.
- Config: defaults, merge, bounds (out-of-range + unknown keys rejected).

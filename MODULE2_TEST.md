# MODULE2_TEST.md — manual one-driver, one-rider test for destination mode

Server side only (driver-app UI lands with the 4s-heartbeat release, §8.1/11).
Every step below drives the backend through **REST or socket** exactly as the
app will, and verifies in the database / trace / counters.

## 0. Preconditions

- `release-candidate-1` deployed to a **single instance** (same precondition as
  `MODULE1_TEST.md` — min=max=1, no rolling batch) and Module 1 verified there.
- `002_destination_mode.sql` applied (checklist: `migrations/TEST_MIGRATION.md`
  §002). Rollback script: `002_destination_mode.rollback.sql`.
- Both flags seeded OFF: `h3_matching_enabled=false`,
  `destination_matching_enabled=false` (002 seed), allowlist empty.
- One driver account (D) with a GPS fix, one rider account (R).
- Tools: `psql`, REST client, socket client for D,
  `SELECT * FROM request_traces WHERE ride_id=…` (same read as Module 1 §6),
  `GET /debug/counters`.
- 002 config keys (all in `app_config.key='destination'`, tunable, never
  hard-coded): `destination_matching_enabled`,
  `destination_rollout_driver_ids`, `destination_max_activations_per_day=2`,
  `destination_reject_radius_km=1`, `destination_arrival_radius_km=0.5`,
  `destination_timeout_hours=3`, `destination_match_dropoff_radius_km=3`,
  `destination_match_cross_track_km=5`,
  `destination_match_along_tolerance_km=0.5`.

## 1. Flag off → feature invisible

1. `POST /api/drivers/destination` `{lat,lng,label}` as D →
   **403** `{"error":"Destination mode is turned off","code":"disabled"}`.
2. `destination_sessions` empty, counter `destination_activated` absent.
3. Request a ride as R → trace has **no** `destination_filter` stage and
   candidates behave exactly as Module 1.

## 2. Open the rollout (flag + driver allowlist — Q12, no redeploy)

```sql
UPDATE app_config SET value = jsonb_set(
  jsonb_set(value, '{destination_matching_enabled}', 'true'),
  '{destination_rollout_driver_ids}', '["<D-user-id>"]'
) WHERE key = 'destination';
```

(config is cached ~10 s — wait a tick after writing.)

- Repeat step 1's POST **as a driver NOT in the list** → still 403 `disabled`
  *"Destination mode is not enabled for your account yet"* (activation and
  matching are gated together — nobody gets a "looking towards X" banner
  without the filter behind it).

## 3. Set destination (happy path) — REST

`POST /api/drivers/destination` as D with a destination >1 km away:

- **200** `DestinationStatus`: `active:true`, `label`, `lat/lng`,
  `uses_today:1`, `max_uses:2`, `expires_at` ≈ now+3 h,
  `banner:"Going to [place] - 1 of 2 uses today"`, `sast_day`.
- DB: one `destination_sessions` row (`ended_at NULL`), `destination_events`
  row `activated`, `driver_profiles.destination_*` populated,
  `destination_expires_at` = now + 3 h.
- Counters: `destination_activated=1`.
- `GET /api/drivers/destination` returns the same status (DB-persisted →
  kill the app, relaunch, GET again: still active — crash-survival proof).

## 4. Activation rules (fixtures L1–L6)

| # | Action | Expected |
|---|---|---|
| L1 | Activate while D's fix is within 1 km of the destination | **409** `already_close` *"You're already close"*, no session row |
| L2/L3 | Activate 1st then a different 2nd destination | both 200; banner `1 of 2` then `2 of 2`; 2 session rows |
| L4 | 3rd activation same SAST day | **429** `daily_limit`, still 2 rows |
| L5 | (staging clock) run at 00:01 SAST after a 23:59 activation | accepted — `sast_day` rolled (`SELECT sast_day, COUNT(*) … GROUP BY 1`) |
| L6 | Activate a 3rd time on a **new day**, then CHANGE destination mid-mode | 200; old session `end_reason='changed'`, new session counted; next change then 429 |
| — | Activate while offline / while `status<>'available'` | **409** `not_online` / `on_trip` |
| — | Same destination again (idempotent) | 200, **no** extra session row (uses unchanged) |
| — | Missing label / out-of-range coords | **400** `invalid_coordinates` |

## 5. Socket events (same contract as REST)

| Emit | Payload | Ack |
|---|---|---|
| `driver:destination:set` | `{lat, lng, label}` | `driver:destination:set:ack` → `{ok:true,status}` \| `{ok:false,error,message}` |
| `driver:destination:clear` | — | `driver:destination:clear:ack` → `{ok:true,status}` |
| `driver:destination:status` | — | `driver:destination:status:ack` → `{ok:true,status}` \| `{ok:false,…}` |

Error codes map to HTTP only for REST (shared record
`DESTINATION_ERROR_HTTP_STATUS`, unit-tested): `disabled`→403,
`invalid_coordinates`→400, `not_found`→404, `not_online`/`on_trip`/
`already_close`→409, `daily_limit`→429, `internal`→500.


## 6. Matching: filter engages only for the destination-mode driver

Prep: D online with fresh GPS (younger than `max_position_age_seconds`),
destination set; a second plain driver D2 online (not on the allowlist) as
control.

1. **Trip that fits** (drop-off closer to D's destination than the pickup,
   inside the 3 km disk or the 5 km corridor with the along-track check) →
   D gets `ride:offer`. Trace gains stage **`destination_filter`**
   `{considered, kept, removed, errors, allowlist}`; `destination_filtered=0`.
2. **Trip that does not fit** (fixture 2/5/10/11/12/15 geometry) → D gets
   **no** offer; D2 still serves R normally. Counter
   `destination_filtered ≥ 1`; trace stage shows `removed ≥ 1`.
3. **Ride without drop-off coords** (`rides.destination_lat/lng IS NULL`) →
   D skipped, D2 unaffected.
4. **Flag off again** (step 2 SQL reversed) → same request produces **no**
   `destination_filter` stage and candidates identical to Module 1.
5. Fail-closed (Q13): not hand-triggerable — covered by unit tests. In
   production watch for the `destination_predicate_error` counter and the
   `[dispatch] destinationFit threw driver=…` log line.

## 7. Auto-end sweep (L7a/c/d) — one reason per end, push states why

The sweep runs inside the existing 4 s offer-worker tick (every ~30 s) plus a
boot catch-up at +6 s. Each end writes `destination_sessions.end_reason`,
clears `driver_profiles.destination_*`, emits
`driver:destination:ended {reason}`, bumps `destination_ended`, and pushes
`type:"destination_mode_ended"`:

| Trigger | How to force | `end_reason` | Push body |
|---|---|---|---|
| L7a ≤500 m | drive/ping D within 500 m of destination (fresh fix) | `arrived` | "You've arrived at your destination, so destination mode ended." |
| L7c offline | D goes offline (or the 15-min safety timeout fires) | `offline` | "You went offline, so destination mode ended." |
| L7d 3 h | `UPDATE driver_profiles SET destination_expires_at=NOW()-interval '1 min' WHERE user_id='…'` | `timeout_3h` | "Your 3 hour destination mode limit was reached." |
| L7b manual | `driver:destination:clear` / `DELETE /api/drivers/destination` | `cancelled` | "You turned destination mode off." |

After each: GET status → `active:false`, banner `null`; a second sweep never
double-ends (it sees `ended_at IS NOT NULL`).

## 8. Read the trace / counters

```sql
SELECT stage, detail FROM request_traces
 WHERE ride_id = '<id>' AND stage = 'destination_filter';
```
`GET /debug/counters` → `destination_activated`, `destination_ended`,
`destination_filtered`, `destination_predicate_error`.

## 9. Deploy precondition — ONE instance only (hard requirement)

Same rule as Module 1 (`MODULE1_TEST.md`): Elastic Beanstalk **min=max=1**,
avoid rolling with an extra batch. The boot log prints the instance id and
`WARNING: multi-instance delivery is unsupported until a socket.io adapter
exists` — do not run 2+ instances: there is no adapter, and `offerWorker` +
the sweeps have only per-process overlap guards, so a second instance would
double-tick them.

## Rollback for this step (fastest → full)

1. **Kill switch, no redeploy** (seconds):
   ```sql
   UPDATE app_config SET value = jsonb_set(value,
     '{destination_matching_enabled}', 'false') WHERE key = 'destination';
   -- optionally also empty the allowlist:
   UPDATE app_config SET value = jsonb_set(value,
     '{destination_rollout_driver_ids}', '[]') WHERE key = 'destination';
   ```
   Activation → 403, predicate + trace stage disappear, matching = Module 1.
   Clear any live modes:
   ```sql
   UPDATE destination_sessions SET ended_at=NOW(), end_reason='cancelled'
    WHERE ended_at IS NULL;
   UPDATE driver_profiles SET destination_lat=NULL, destination_lng=NULL,
          destination_label=NULL, destination_set_at=NULL,
          destination_expires_at=NULL
    WHERE destination_lat IS NOT NULL;
   ```
2. **Rollback the schema** (destroys session history — `pg_dump
   destination_sessions destination_events` first):
   ```bash
   psql … -f server/migrations/002_destination_mode.rollback.sql
   ```
   Additive only: drops the two tables + indexes, the five
   `driver_profiles.destination_*` columns, and the `destination` config row.
   No Module 1 object is touched; the config reader falls back to
   `DEFAULT_DESTINATION_CONFIG` when the row is missing.
3. **Full unwind**: run (2), then redeploy the pre-Module-2 build (RC-1).

## Known edges (documented, accepted)

- **Allowlist removal mid-session**: removing D from
  `destination_rollout_driver_ids` blocks re-activation but leaves an already
  active session unfiltered. When de-listing a driver, also run the clear SQL
  above.
- **Stationary arrival**: L7a requires a GPS fix younger than
  `max_position_age_seconds` — a parked phone never "arrives" until it moves
  or another end reason fires (by design).


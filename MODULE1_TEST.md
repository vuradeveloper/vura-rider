# MODULE1_TEST.md — manual one-driver, one-rider test for H3 matching

Covers Module 1 end-to-end on a running server: driver online → H3 index →
flag-on matching → one offer → accept → trace. Every step lists the **exact
log line to expect** and the **failure signature** if it is wrong.

**Automated coverage exists first** — run these before going manual:

```bash
cd server
npx tsc --noEmit          # type gate
npx vitest run            # 52 mocked tests (always run, no database needed)
# real-Postgres suite (needs a scratch DB, see the header of
# src/services/dispatch.integration.test.ts):
$env:VURA_TEST_DB_PORT='55432'; npx vitest run src/services/dispatch.integration.test.ts
```

---

## 0. Preconditions

| Check | Command / expectation |
|---|---|
| Migration applied + valid | `SELECT key FROM app_config WHERE key='matching';` → 1 row (see `server/migrations/TEST_MIGRATION.md`) |
| Flag turned ON for this test | the seed leaves flag **and** rollout mode OFF; before starting run `UPDATE app_config SET value = jsonb_set(jsonb_set(value, '{h3_matching_enabled}', 'true'), '{h3_rollout_mode}', '"all"') WHERE key = 'matching';` (restore `'false'`/`'off'` afterwards if you are not rolling out — section 5) |
| Server up | boot log shows `[offerWorker] started (2s tick · offer TTL 15s · driver stale 45s)` |
| Admin trace endpoint | `ADMIN_EMAILS` env contains the email you will sign in with |
| Apps | driver app + rider app (or the `figma-ui` harness) pointed at this server |

---

## 1. Driver goes online

Driver app: tap Online (or harness: `driver.emit('driver:online', { online: true })`).

**Expect (server log):**
```
[driver] online_intent=true status=available driver=<driver-uuid>
```
(Socket path logs `🔌 Socket: <id> (user: <uid>)` on connect.)

**Failure signatures:**
| Log | Means |
|---|---|
| `Driver online error:` | the online handler threw — driver never became offerable |
| (nothing at all) | request never reached the server: URL/token problem |

---

## 2. Driver sends a GPS ping (`driver:location`)

Wait for the app's normal ping (every ~15s while driving, or the harness loop).

**Expect (server log):** silent success. Verify in SQL:
```sql
SELECT user_id, cell_res8, last_seen_at, status FROM driver_cells;
```
→ exactly one row for the driver, `last_seen_at` within seconds, `status = 'available'`.

**Failure signatures:**
| Log / state | Means |
|---|---|
| `[driverIndex] upsert failed driver=<id>: <err>` | ping reached the server but the index write failed — **flag-on matching falls back to haversine for everyone** until fixed |
| `driver_cells` empty while the driver pings | migration 001 missing (table absent → upsert error above), or this build is not deployed |
| `Driver location error:` | the driver_profiles UPDATE itself failed (bigger problem than the index) |

---

## 3. Rider requests a ride

Rider app: set pickup near the driver, book.

**Expect, in order (server log):**
```
[dispatch] ride_requested ride=<ride-id>
[dispatch] candidates_found ride=<ride-id> {"round":1,"count":1}
[dispatch] offer_sent ride=<ride-id> driver=<driver-uuid> {"round":1,"distanceKm":<n>,"expiresIn":15,"socket":true}
```
The driver app shows the Accept/Decline card within ~2s of the rider's tap.
The trace records: `request_received`, `trip_saved`, `dispatch_started`,
`drivers_found(count)`, `offer_sent`.

**Failure signatures:**
| Log | Means |
|---|---|
| `candidates_found ... {"count":0}` then `no_drivers` | nobody eligible: check `driver_cells` freshness (step 2), `driver_profiles.status='available'`, `is_online`, `last_location_at` age. Under flag-on, a repeating `[dispatch] H3 index has 0 fresh drivers ... falling back to haversine` means the index is not being written — back to step 2 |
| `[dispatch] H3 path FAILED ride=<id> (falling back to haversine): <err>` | the H3 path threw; haversine is carrying this request (rider unaffected, but trace stage `h3_path_failed` names the cause) |
| `[dispatch] candidate query FAILED ride=<id>: <err>` | even the old query failed: database problem — rider would be told "no drivers" for a server fault |
| `offer INSERT failed ride=<id> driver=<id>: <err>` without `duplicate key` | ride_offers write failed — no driver was asked |
| `driver already holds a pending offer, trying next candidate` | normal under load: this driver was mid-offer on another ride; the next ranked candidate was tried — the one-offer-per-driver guard working |
| `count:1` but no card on the phone | offer row exists, delivery failed → step 6: `offer_sent` **without** `offer_delivered_ack`, plus `push delivered 0 devices` |

---

## 4. Driver accepts

Driver taps Accept.

**Expect (server log):**
```
[dispatch] ride_accepted ride=<ride-id> driver=<driver-uuid> {"version":<n>}
```
Rider app flips to "driver on the way"; any losing drivers get
`ride:offer:cancelled`.

**Failure signatures:**
| Log | Means |
|---|---|
| `Ride no longer available` on the tap | somebody else won (trace `driver_response` shows who) — with a single test driver this means a stale card from an earlier attempt |
| accept OK but rider sees nothing | `ride:accepted` emit/push path, not Module 1 — check `passenger_fb` on the ride |

---

## 5. Kill switch + rollout control — no redeploy

**Master kill switch — flag OFF serves everyone the old path (seconds):**

```sql
UPDATE app_config SET value = jsonb_set(value, '{h3_matching_enabled}', 'false')
  WHERE key = 'matching';
```
Wait >10s (config cache), book again.

**Expect:** identical dispatch flow, and the new ride's `matching_path` stage is
`{"path":"legacy","reason":"kill_switch_off"}` with **no** `h3_*` stages —
the original haversine query is serving it. Restore with `'true'`.

**Rollout modes** — consulted only while `h3_matching_enabled = true`:

| `h3_rollout_mode` | Effect |
|---|---|
| `off` | legacy for everyone (seed default) |
| `allowlist` | H3 only for riders in `h3_rollout_rider_ids` |
| `percent` | H3 for riders with `hash(rider id) % 100 < h3_rollout_percent` — stable per rider |
| `all` | H3 for everyone |

```sql
-- Switch to allowlist mode:
UPDATE app_config SET value = jsonb_set(value, '{h3_rollout_mode}', '"allowlist"')
  WHERE key = 'matching';

-- ADD a rider to the allowlist (idempotent — appends only if absent):
UPDATE app_config
   SET value = jsonb_set(value, '{h3_rollout_rider_ids}',
         CASE WHEN value->'h3_rollout_rider_ids' ? '<RIDER_USER_UUID>'
              THEN value->'h3_rollout_rider_ids'
              ELSE value->'h3_rollout_rider_ids' || '<RIDER_USER_UUID>'::jsonb
         END),
       updated_at = NOW()
 WHERE key = 'matching';

-- REMOVE a rider from the allowlist:
UPDATE app_config
   SET value = jsonb_set(value, '{h3_rollout_rider_ids}',
         (SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
            FROM jsonb_array_elements_text(value->'h3_rollout_rider_ids') e
           WHERE e <> '<RIDER_USER_UUID>')),
       updated_at = NOW()
 WHERE key = 'matching';

-- PERCENT rollout (0-100). The bucket is a stable hash of the rider id, so
-- widening never flips an individual rider's path mid-session:
UPDATE app_config
   SET value = jsonb_set(jsonb_set(value, '{h3_rollout_mode}', '"percent"'),
                         '{h3_rollout_percent}', '25')
 WHERE key = 'matching';
```

**Expect on EVERY ride** (either path): a `matching_path` trace stage —
`{"path":"h3","reason":"rollout_allowlist"}` for the allowlisted rider versus
`{"path":"legacy","reason":"rollout_not_allowlisted"}` for another rider in the
same minute. Other reasons: `kill_switch_off`, `rollout_off`, `rollout_all`,
`rollout_percent_<bucket>`, `rollout_percent_no_rider`, `config_error`.

**Failure signature:** flag/mode flipped but behaviour unchanged after ~10s →
the server reads a different `app_config` (wrong database / config falling back
to defaults); a `[dispatch] config read failed, using legacy path` warning
would also appear.

---

## 6. Read the trace

```bash
curl -H "Authorization: Bearer <admin-firebase-id-token>" \
  "https://<host>/debug/trips/<ride-id>/trace"
```
Admin only: the token's email must be in `ADMIN_EMAILS`. (Legacy alternative:
`GET /api/dev/dispatch/trips/<ride-id>/trace?key=<DEV_LOG_READ_KEY>`.)

**Healthy response (abbreviated):**
```json
{
  "trace_id": "...",
  "stage_count": 10,
  "stages": [
    { "stage": "request_received",   "ms_from_start": 0 },
    { "stage": "trip_saved",         "ms_from_start": 45 },
    { "stage": "dispatch_started",   "ms_from_start": 60 },
    { "stage": "matching_path",      "ms_from_start": 62,  "detail": { "path": "h3", "reason": "rollout_all" } },
    { "stage": "drivers_found",      "ms_from_start": 95,  "detail": { "count": 1 } },
    { "stage": "h3_candidates",      "ms_from_start": 120, "detail": { "radius_km": 3 } },
    { "stage": "offer_sent",         "ms_from_start": 140 },
    { "stage": "offer_delivered_ack","ms_from_start": 210 },
    { "stage": "driver_response",    "ms_from_start": 900, "detail": { "response": "accept" } }
  ],
  "missing_stages": [],
  "offer_acked": true,
  "complete": true
}
```
`offer_acked` is the brief's `offer_acked` (implemented as
`offer_delivered_ack` — the mapping is in `stage_aliases`).

`matching_path` appears on **every** ride — `{path, reason}` says which
matching path served it (section 5). The embedded `counters` object is **per
instance** (one process's memory): it carries `instance` (hostname) and
`started_at` (process start), both reset on redeploy. Same object is served
alone at `GET /debug/counters` — in a scaled deployment, check every instance
before drawing conclusions.

**Failure signatures in the trace:**
| Symptom | Diagnosis |
|---|---|
| `missing_stages` contains `drivers_found` | dispatch never ran for this ride |
| `drivers_found` count 0 | see step 3's count:0 row |
| `h3_path_failed` present | H3 threw; check `error` — haversine fallback covered the request |
| `matching_path` shows `path: legacy` | the rollout excluded this ride — `reason` says why: `kill_switch_off`, `rollout_off`, `rollout_not_allowlisted`, `rollout_percent_no_rider` or `config_error` |
| `h3_index_empty` present | index had no fresh drivers in those cells — writer (step 2) or eviction too aggressive (`stale_seconds`) |
| `h3_search_timeout` then `no_drivers` | the 90s budget expired with nobody eligible — correct rider-facing stop |
| `offer_sent` but no `offer_delivered_ack` | event left the server, phone never rendered it: dead socket and `push_result` shows `delivered: 0` |
| `offer_driver_busy` | candidate held a pending offer elsewhere; the loop moved on |
| no `driver_response` after a tap | accept never reached the server |

---

## 7. Stale eviction (driver silent >40s)

Stop the pings (kill the app or wait >40s without going offline).

**Expect, on a worker tick (~every 30s, only when something expired):**
```
[offerWorker] evicted 1 stale driver cell(s) (last_seen older than 40s)
```
`driver_cells` loses the driver; matching falls back to haversine for that
area (one `H3 index has 0 fresh drivers` warn is expected) until the next ping.

**Failure signatures:**
| Log/state | Means |
|---|---|
| row survives >60s past last ping | sweep not running (worker dead — no `[offerWorker] started` at boot) or `stale_seconds` misconfigured |
| `evictStale failed: <err>` | index DELETE error (missing table = migration not applied) |

---

## 8. Two riders, one driver (double-assignment guard)

With driver D pending on ride A, fire a second booking from a second rider
nearby.

**Expect:** the second ride goes to another driver or parks with `no_drivers` —
**never** a second pending offer for D:
```sql
SELECT COUNT(*) FROM ride_offers WHERE driver_id = '<D>' AND status = 'pending';
```
→ always `1`. Log may show
`driver already holds a pending offer, trying next candidate ride=<ride-B>...`.

**Failure signature:** count = `2` → the 001b index is missing or INVALID
(`server/migrations/TEST_MIGRATION.md` step 5) — re-create it; matching is not
safe until it holds.

---

## Deploy checklist (rollout ladder)

The master switch (`h3_matching_enabled`) stays on as the kill switch at every
stage; `h3_rollout_mode` controls who actually rides H3. Counters are **per
instance** — check each instance (or accept the one you sampled) before widening.

| # | Stage | Do | Gate before the next stage |
|---|---|---|---|
| 1 | Migrations | `001_h3_driver_index.sql` twice, then `001b_offer_unique_index.sql` outside any transaction — `server/migrations/TEST_MIGRATION.md` | all its boxes signed off |
| 2 | Deploy | ship `module1-h3-matching` with the seed untouched (`enabled=false`, `mode='off'`) | every ride: `matching_path` = `legacy / kill_switch_off`; zero `h3_*` stages |
| 3 | Index writers | drivers ping normally | `driver_cells` rows appear; no `[driverIndex] upsert failed` in logs |
| 4 | Switch ON, mode still `off` | `h3_matching_enabled = true` | still all legacy — `matching_path` = `legacy / rollout_off` |
| 5 | Allowlist mode, empty | `h3_rollout_mode = 'allowlist'` | still all legacy — `legacy / rollout_not_allowlisted` |
| 6 | **Allowlist your own test rider id** | add the id (SQL in section 5), leave the mode on `allowlist` | your rider: `matching_path` = `h3 / rollout_allowlist` **in the same minute** as a second, non-allowlisted rider getting `legacy / rollout_not_allowlisted`; full one-driver/one-rider flow (sections 1-8) green |
| 7 | Baseline counters | `GET /debug/counters` per instance | record `h3_path_failures`, `fallback_used`, `offer_driver_busy`, `no_drivers` + `instance`/`started_at` |
| 8 | Percent widen | `mode='percent'` at **10 → 25 → 50 → 100**, **pausing at each step** | at every pause: counters vs the step-7 baseline — `h3_path_failures`/`fallback_used` not climbing, `no_drivers` not spiking, spot-checked traces still carry `matching_path`; finish with `mode='all'` |

Any stage going wrong → section 5's kill switch (flag OFF) serves everyone the
legacy path within seconds.

---

## Rollback for this whole step (fastest → full)

1. **Behaviour only (seconds):** flip `h3_matching_enabled` to `false`
   (step 5). The old path serves everything.
2. **Code:** `git revert` the Module 1 commits on `module1-h3-matching`, or
   deploy the previous build — nothing outside this branch changed on `main`.
3. **Schema (if ever needed):** `server/migrations/001_h3_driver_index.rollback.sql`
   — removes only objects 001/001b created; `driver_cells` rebuilds itself
   from the next GPS ping.

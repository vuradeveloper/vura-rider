# MODULE 2 (Set Destination) — restatement against the real codebase

**Status: DOCUMENT ONLY.** Written on `module1-h3-matching` after Module 1 rollout
control (`c2049f4`). No code in this document has been written; nothing here is
scheduled to merge. Prepared while the production steps for Module 1 run.

**The one piece of the original brief quoted verbatim in the code:**
`server/src/services/driverIndex.ts:72-73` —
*"When a new availability status is added (Module 2's destination mode will add
one), it is added HERE and nowhere else."*
So Module 2 = **driver destination mode**: a driver declares where they are
heading, gets a NEW availability status, and dispatch matches them only with
rides that fit that direction. The rider-side destination already exists
(`rides.destination_*`) and is already in every offer payload — Module 2 is
about the **driver's** destination, not the rider's.

---

## 1. What already exists (no rebuild needed)

| Building block | Where | State |
|---|---|---|
| Rider destination columns + load | `server/src/services/dispatch.ts:507-509, 520-528` (`loadRide` selects `destination_address/lat/lng`) | ✅ exists since booking |
| Destination already sent to drivers | `dispatch.ts:686-688` (offer payload `destinationAddress/Lat/Lng`) | ✅ exists |
| Driver heading column | `server/migrations/001_h3_driver_index.sql:41` (`driver_cells.heading`), `driver_profiles.current_heading` (`index.ts:322`) | ✅ exists, **written but never read by matching** |
| Heading writer | `server/src/socket/handlers.ts:838-874` (`driver:location` → `current_heading = COALESCE($3, current_heading)` at :847, index upsert at :865-873) | ✅ every GPS ping |
| Index carries heading | `driverIndex.ts:41,108-119,137,159` (upsert + reads) | ✅ stored, unused |
| Status field for the new mode | `driver_profiles.status VARCHAR(20)` (`index.ts:560`); written by `handlers.ts:850-853, 913-930`, `routes/drivers.ts:287-295` | ✅ `available`/`offline`/`on_trip` today |
| Single "who is matchable" gate | `driverIndex.ts:64-80` (`MATCHABLE_STATUSES = ["available"]`, `isMatchableStatus`) — the contract the new status must enter through | ✅ designed for Module 2 |
| Eligibility SQL (the filter host) | `dispatch.ts:421-469` — status check (:431 via `$2` = `MATCHABLE_STATUSES` :458), online, freshness (:434-436), not-self, not-already-offered, not-on-trip, `driver_blocks` (:443-446), vehicle category (:447), min rating (:448), exact haversine (:449-453) | ✅ the place a destination predicate lives |
| Road-ETA ranking stage | `dispatch.ts:472-497` (`etaMinutesList` → sort → `h3_candidates` trace) | ✅ a second rank key could join here |
| Kill-switch + rollout pattern | `config.ts` (`h3_matching_enabled` + `h3_rollout_*`), `dispatch.ts:269-310` (`decideH3Path` + `matching_path` trace) | ✅ the template Module 2 should copy |
| Config runtime table | `app_config` (`001:59-63`, 10s cache `config.ts:105-106`) | ✅ new keys = one seed line + coerce |
| Heartbeat event | `handlers.ts:1091-1099` (`driver:heartbeat` → `last_heartbeat_at`) | ⚠️ exists, but see §4 |
| Diagnostics surfaces | `routes/devDispatch.ts` (inspector), `routes/devDiag.ts:156-164` (`is_candidate`), `/debug/trips/:id/trace` | ⚠️ hardcode `= 'available'`, see §5 |

## 2. Tables it touches

**Read-only (no changes):**
- `rides.destination_*` — rider destination for corridor tests (via `loadRide`).
- `driver_cells` — position/heading/status as matched today.
- `ride_offers`, `driver_blocks` — offer bookkeeping and blocks apply unchanged.
- `driver_metrics`, `driver_profiles.performance_tier` — **Module 3 scaffolding
  only** (`001:84-100`); Module 2 must not write them.

**Modified (additive migration, e.g. `002_destination_mode.sql`):**
- `driver_profiles` — ADD `destination_lat DOUBLE PRECISION`,
  `destination_lng DOUBLE PRECISION`, `destination_set_at TIMESTAMPTZ`
  (all nullable = no behaviour change when null). The `status` column needs no
  DDL — it is already `VARCHAR(20)` and holds the new value at runtime.
- `app_config` seed — ADD `destination_matching_enabled: false`,
  `destination_match_km` (corridor width), optionally
  `destination_max_heading_age_s`. Same `ON CONFLICT DO NOTHING` seed style.

**Explicitly NOT touched:** `rides` (tier cleanup waits for Module 3,
`001:23-24`), `driver_cells` schema (heading column already there), no new
tables unless Q4 chooses otherwise.

**Trace stages added (written into `ride_events` like Module 1's):**
`destination_set`, `destination_cleared`, `destination_filter`
(`{considered, matched, skipped, reason}`) — one per H3 round that ran the
filter, so a wrong "no drivers" can always be explained.

## 3. How it plugs into `findCandidatesH3`

Current pipeline (`dispatch.ts:323-498`), with insertion points marked:

```
0  decideH3Path / matching_path trace          (:269-310)   <- unchanged
1  radius ladder 3→5→7km per round             (:333-346)   <- unchanged
2  rollout guard: countFresh == 0 -> fallback  (:348-361)   <- unchanged
3  cellsAround -> getDriversInCells            (:363-375)   [A] cheap pre-filter
4  freshness filter (stale_seconds)            (:370-375)   <- unchanged
5  busy lock FOR UPDATE SKIP LOCKED            (:395-413)   <- unchanged
6  eligibility SQL over driver_profiles        (:421-469)   [B] THE filter point
7  rank by road ETA                            (:472-497)   [C] optional rank key
8  return pool -> one-at-a-time offer loop     (:547-752)   <- unchanged
```

- **[B] primary hook — eligibility SQL (`:431-448`).** For a candidate whose
  `dp.status` is the destination status, add one guarded predicate: destination
  mode drivers only qualify when the ride HAS a destination and the haversine
  distance `(ride.destination, driver.destination) <= destination_match_km`.
  Destination-mode drivers are thereby *hard-filtered* to corridor-fitting
  rides; plain `available` drivers are byte-for-byte unaffected (the predicate
  is an `OR`-branch that collapses for them). The ride's destination comes in
  as a new `$12` param — `offerToNextDriver` already has it (`loadRide`
  `:520-528`); `findCandidates`/`findCandidatesH3` just need it threaded
  (`dispatch.ts:260-267, 323-330` gain a `dest` argument, same way Module 1
  threaded `riderId`).
- **[A] optional pre-filter** — `getDriversInCells` results already carry
  `heading` and (soon) status; a JS-side drop of destination-mode drivers whose
  `destination` is absurdly far (>> corridor) can shrink `$1` before the SQL.
  Nice-to-have, not required.
- **[C] rank** — if Q5 picks ranking over hard-filtering, the corridor score
  joins the ETA sort at `:479-482`. Recommended only as a *tie-breaker*;
  a pure rank lets off-corridor offers through, which is what destination mode
  promises not to do.
- **What must NOT be touched:** `findCandidatesHaversine` (flag-legacy path)
  stays byte-identical — the proven Module 1 property. Destination matching is
  H3-path-only, behind its own kill switch; when either switch is off, behaviour
  is exactly today's.
- **Trace:** `matching_path` (`dispatch.ts:281-284`) keeps answering
  `h3|legacy`; the destination filter reports separately as `destination_filter`
  so the two concerns never blur. Rollout guidance = copy the Module 1 ladder
  (`kill switch` → `allowlist` → `percent` → `all`), see Q12.

## 4. What depends on the 4s-heartbeat APK

The heartbeat APK is **driver-app work in the separate `vura-driver` repo**
(nothing to cite yet — it does not exist). Server-side consequences:

1. **Heading freshness.** Corridor math needs a heading that reflects "now".
   Today `heading` only arrives inside `driver:location` GPS pings
   (`handlers.ts:840,857`) — the shipped app sends GPS every **15s**
   (`config.ts:38-40`, `driverIndex.ts:183-185`). At the configured
   `avg_speed_kmh: 40` a car covers ~167 m and can turn two corners between
   pings; a ±45° cone test on 15s-old heading produces false negatives and
   false positives. **Corridor matching should stay on allowlist until the 4s
   cadence ships**, then `stale_seconds`/heading-age can tighten (the code is
   already written for that: `driverIndex.ts:183-185` — *"it becomes 20s after
   the 4s heartbeat APK with no code change"*, and `rollback.sql:51-54` records
   the Q7 decision: 40s **until** the 4s APK).
2. **Heartbeat does not refresh the index (real gap).** `driver:heartbeat`
   (`handlers.ts:1091-1099`) touches `driver_profiles.last_heartbeat_at` only.
   `driver_cells.last_seen_at` is written solely by `driverIndex.upsert`
   (`driverIndex.ts:106-119`), i.e. by GPS pings. A **stationary**
   destination-mode driver whose app downgrades to heartbeat-only goes *cold in
   the H3 index* after `stale_seconds` (40s) and disappears from path-0 matching
   (`dispatch.ts:370-375`) even though the eligibility SQL
   (`:434-436`, `GREATEST(last_location_at, last_heartbeat_at)`) would accept
   them. The heartbeat handler must also upsert/touch the index row (Q8).
3. **Freshness thresholds ship as config, not code** — one seed UPDATE flips
   them when the APK lands; no Module 2 code change needed for cadence itself.
4. **What does NOT depend on the APK:** schema, status value, eligibility
   predicate, kill switch, traces, tests — all server-side, all testable now
   with GPS-paced pings (the figma-ui harness can emit `driver:location`).

## 5. Conflicts and hazards found in the real code

### 5a. The tier naming conflict (the same class of problem as before)
Six different "tier"s already coexist — **Module 2 must not add a seventh, and
must not read any of them:**

| "tier" | Where | Meaning | Status |
|---|---|---|---|
| `driver_cells.tier` | `001:43`; written by `driverIndex.ts:108-119` | intended Module-3 performance tier in the index | **always NULL today** — no caller passes `tier` (`handlers.ts:865-873`, `drivers.ts:306-310`, `handlers.ts:944-948` all omit it) |
| `driver_profiles.performance_tier` | `001:99-100`, default `'bronze'` | Module 3 points/bronze-silver-gold | scaffolding, nothing reads it |
| `rides.tier`, `driver_profiles.tier` | `001:23-24` | legacy booking tier | **dead columns, explicitly frozen until after Module 3** |
| `driver_profiles.vehicle_tiers` (JSONB) | `drivers.ts:146`, `lib/tier-classifier.ts` | face/vehicle classification list | live, unrelated |
| booking tier `go`/`x` (VuraGo/VuraX) | `app/ride/schedule.tsx:20-22`, `figma-ui/src/App.tsx:592-596` | rider's chosen service class | frontend payload only |

**Recommendation (Q10):** destination data is named `destination_*`, never
`tier`; `driver_cells.tier` stays unwritten and unread until Module 3 defines it.

### 5b. Stale-driver sweeps would never demote destination-mode drivers
Both sweeps filter on `available` only:
- `dispatch.ts:1146-1149` — `WHERE COALESCE(status,'offline') = 'available' AND heartbeat older than threshold`;
- `dispatch.ts:1121-1125` — the 15-minute offline sweep (same status assumption).

A driver parked in the new destination status who dies/goes silent would keep
absorbing corridor offers forever. The sweeps must include the new status (Q9).

### 5c. Diagnostics hardcode `available`
`devDiag.ts:156-164` computes `is_candidate` with `= 'available'`;
`devDispatch.ts:82-86` reports status without knowing the new one. Destination
drivers would look like "invisible drivers" in the inspector until these two
queries learn the status (cheap, but must be in scope).

### 5d. `MATCHABLE_STATUSES` is a single global list
Adding the status there (as `driverIndex.ts:72-73` instructs) makes destination
drivers pass the `= ANY($2::text[])` check (`dispatch.ts:431,458`) for **every**
ride — so the corridor predicate [B] must exist in the *same* query, or an
off-corridor ride gets offered to a destination driver. The two changes ship
together or not at all (Q3).

### 5e. Flag-OFF equivalence
Same constraint as Module 1: with `destination_matching_enabled=false` the SQL
must stay byte-identical to today's — achieved by gating the extra predicate on
the flag exactly like `decideH3Path` gates the whole path.

## 6. Numbered questions with recommended answers

> Reply with e.g. "1A, 2A, 3A …" — each **A** below is my recommendation.

**Q1 — Scope reading.** Module 2 = *driver* declares a destination → new
availability status → dispatch pairs them with corridor-fitting rides; the
rider-destination plumbing already exists and needs no rider-app change.
**A (recommended): Confirm this reading.** B: it is something else — correct me.

**Q2 — Match direction.** A (recommended): **driver-destination mode only** for
Module 2 (status + corridor filter). B: also use rider destination to rerank
plain `available` drivers (heading-toward-pickup score) — real value, more risk,
better as 2b. C: both at once.

**Q3 — Where the status enters matching.** A (recommended): add the status to
`MATCHABLE_STATUSES` **and** add the corridor predicate in the same eligibility
SQL **in the same commit** (keeps the `driverIndex.ts:72-73` contract and can
never leak off-corridor offers). B: keep `MATCHABLE_STATUSES` untouched and run
destination drivers as a second, separately-queried pool — protects the shared
list but duplicates the eligibility SQL (two places to drift, the exact bug Q8
of Module 1 fixed).

**Q4 — Destination storage.** A (recommended): `driver_profiles` ADD
`destination_lat/lng/destination_set_at` (additive, nullable, `002` migration
with rollback file). B: new `driver_destinations` table — needed only if drivers
may hold multiple/priority destinations (not in the brief).

**Q5 — Filter vs rank.** A (recommended): **hard filter** — a destination-mode
driver is never offered a ride outside `destination_match_km` (default 2 km,
`app_config` key); corridor fit may then still tie-break beside ETA. B: rank-only
(soft) — smoother supply, but lets off-corridor offers through, contradicting
the feature's promise.

**Q6 — Empty-corridor behaviour.** A (recommended): a skipped destination
driver is simply not a candidate this round (counted in the `destination_filter`
trace); dispatch continues to normal `available` drivers untouched; the driver
keeps the status until they clear it, go offline, or Q9's sweep demotes them.
B: auto-clear the status after N minutes without a match — adds a state machine,
do it later.

**Q7 — Ship before the 4s APK?** A (recommended): build + test now, roll out
via **driver allowlist first** (mirror Module 1's `h3_rollout_mode` pattern,
Q12), widen only after the 4s heartbeat APK is out; a heading-age guard
(`destination_max_heading_age_s`, defaulting to `stale_seconds`) makes
stale-heading drivers simply not match. B: block Module 2 entirely on the APK —
safe, but wastes the allowlist machinery we just built.

**Q8 — Heartbeat must refresh the index.** A (recommended): yes — extend
`driver:heartbeat` (`handlers.ts:1091`) to also `driverIndex.upsert` with the
last known position (or add a `touch` method to the `DriverIndex` interface,
`driverIndex.ts:55-62`) so stationary destination-mode drivers stay fresh in
`driver_cells`. B: accept the 40s cold-flicker — rejected: it produces
`h3_index_cold`-style false "no drivers".

**Q9 — Sweeps.** A (recommended): extend both stale sweeps
(`dispatch.ts:1121-1125` and `:1146-1150`) to demote the new status exactly
like `available`. B: leave sweeps alone — rejected: destination drivers never
demote and absorb offers forever.

**Q10 — Tier naming.** A (recommended): Module 2 introduces **no** new `tier`
identifier anywhere (server, API, UI); destination fields are `destination_*`;
`driver_cells.tier` / `performance_tier` remain Module 3's business and the
dead `rides.tier`/`driver_profiles.tier` columns stay frozen per `001:23-24`.
B: rename/consolidate tiers now — rejected: out of scope, breaks the freeze.

**Q11 — APK scope for this module.** A (recommended): driver-app work =
"Set/Clear Destination" UI + `driver:destination:set`/`driver:destination:clear`
socket events + REST twin `POST /api/drivers/destination`, shipped in the SAME
APK release as the 4s heartbeat; server + harness work happens first. Rider app:
**no change** (its destination already flows). Which repo builds that APK —
`vura-driver` (sibling repo, per `_LIVE_STATE.md:3-4`) or this repo's
`figma-ui`? **My recommendation: `vura-driver`; confirm.**

**Q12 — Flag + rollout shape.** A (recommended): one master switch
`destination_matching_enabled` (seed `false`) + reuse the
`off|allowlist|percent|all` machinery keyed on **driver** ids for the first
phase (destination mode is driver-initiated, which is an organic allowlist);
no rider-side rollout until 2b. B: copy the full `*_rollout_*` triple per
concern — more config surface than needed.

**Q13 — Failure policy.** A (recommended): any throw/math error inside the
destination predicate → treat as "no filter" (log + `destination_filter` trace
with `reason:"error"`), never fail closed, never block the offer — same policy
as Module 1's H3 path (`dispatch.ts:297-311`). Confirm.

**Q14 — Migration + docs naming.** A (recommended):
`002_destination_mode.sql` + `002_destination_mode.rollback.sql` +
TEST_MIGRATION steps + `MODULE2_TEST.md` manual flow, all mirroring Module 1's
structure; nothing implements or merges before Q1–Q14 are answered. Confirm.

## 7. Validation plan (for when the plan is approved)

- **Unit (mocked):** corridor predicate on/off; flag-off byte-identity of the
  eligibility SQL; status entered `MATCHABLE_STATUSES` exactly once; sweeps
  demote the new status; heartbeat keeps the index fresh; traces written on
  every ride (`destination_filter` + existing `matching_path`).
- **Integration (scratch Postgres, `VURA_TEST_DB_PORT`):** migration applies
  twice (idempotent) + seeds `destination_matching_enabled=false`; offer flow
  with one destination driver + one plain driver.
- **Manual:** extend the `MODULE1_TEST.md` one-driver/one-rider flow with a
  destination-mode driver, same log-line/failure-signature format.
- **STOP:** no implementation before Q1–Q14 are answered; no merge; no Module 3.

## 8. DECISIONS — answered (build approval, code NOT yet written)

Your replies, recorded as the spec of record. Where you changed a
recommendation, your version wins.

| Q | Decided |
|---|---|
| 1 | **Confirmed** + your original rules (full text below): daily limit, auto-end, 1 km reject, banners, DB-persisted state |
| 2 | A — driver-destination only; rider-destination reranking later |
| 3 | **CHANGED — NO new status.** Driver stays `'available'`; `MATCHABLE_STATUSES` unchanged. Destination mode = attributes + a predicate in the eligibility SQL. (If a status is ever argued, it must come with file+line proof first. Note: the comment at `driverIndex.ts:72-73` still promises a new status — it must be corrected as part of the Module 2 build.) |
| 4 | **CHANGED — two homes:** `driver_profiles` holds the CURRENT destination (`destination_lat`, `destination_lng`, `destination_label`, `destination_set_at`, `destination_expires_at`); new `destination_sessions (id, driver_id, lat, lng, label, started_at, ended_at, end_reason, trips_completed, sast_day)` for the daily limit + audit |
| 5 | **CHANGED — rule replaced** (exact formula + fixtures below) |
| 6 | A clarified: a driver with no fitting trip gets **no offer from this feature**; other drivers serve the rider normally. Never offer a non-matching trip to a destination-mode driver. Trace + count every skip |
| 7 | A — build now behind a **driver allowlist**, widen after the 4s APK. Module 1 must be stable in production first |
| 8 | A — and executed already as a **Module 1 bug fix**: `driver:heartbeat` refreshes `driver_cells` via `DriverIndex.touch()` (`0010bb0`, on `module1-h3-matching`, with mocked + real-Postgres tests) — **before your deploy** |
| 9 | Mostly moot without a status. **Add a non-overlapping auto-end sweep** (500 m / 3 hours / offline) modelled on the stale-index sweep |
| 10 | A — no new `tier` anywhere; `destination_*` naming only |
| 11 | A — Set/Clear UI + socket/REST events in the **same release as the 4s heartbeat APK**. Driver app repo: **[YOU WILL CONFIRM THE REPO NAME]** |
| 12 | A — `destination_matching_enabled` (seed `false`) + driver-keyed allowlist, same machinery as Module 1 |
| 13 | **CHANGED — fail closed PER DRIVER:** if the predicate throws for one driver, skip **that driver only** for that request, log it, count it, keep serving the rider with everyone else |
| 14 | A — `002_destination_mode.sql` + rollback + TEST_MIGRATION + `MODULE2_TEST.md`, Module-1 style, **additive only** |

### 8.1 Your activation/lifecycle rules (item 1, verbatim intent)

All thresholds in `app_config`, never hard-coded:
- **Max 2 activations per driver per day**, resetting **00:00 SAST** (counter
  from `destination_sessions.sast_day`).
- Activation only while **online and not on a trip**.
- **Auto-ends** when: within **500 m** of destination · driver cancels · driver
  goes offline · **3 hours** pass without a trip. **Push on end, stating why**
  (`end_reason` on the session row).
- Reject activation if already within **1 km**: *"You're already close"*.
- **Changing destination mid-mode = a new use** (session end + new session).
- State lives in the **database** → survives crash/reconnect.
- Driver banner: `Going to [place] - 1 of 2 uses today`; when nothing matches:
  `Looking for trips towards [place]`.

### 8.2 Q5 rule — exact formula (replaces the 2 km rule)

**Inputs** (all WGS84 degrees, mean Earth radius **R = 6371 km** — same
constant as the matching SQL's `6371 * acos(...)`):
`D` = driver position · `T` = driver destination (`driver_profiles`) ·
`P` = ride pickup · `X` = ride drop-off (`rides.destination_*`).

```
hav(A,B) = 2R · asin( √( sin²((φB−φA)/2) + cosφA·cosφB·sin²((λB−λA)/2) ) )

bearing(A→B) = atan2( sinΔλ·cosφB , cosφA·sinφB − sinφA·cosφB·cosΔλ )

cross-track (perpendicular offset of X from the D→T line):
  dAP = hav(D,X)   dAB = hav(D,T)
  θ   = bearing(D→T)      θAP = bearing(D→X)
  xt  = R · asin( clamp( sin(dAP/R) · sin(θAP − θ), −1, 1 ) )
  guard: dAB < 1e-9 km  →  xt := dAP        (driver already at destination)

along-track (signed position of X's PROJECTION onto the D→T line;
 positive toward T, negative behind the driver, in km):
  Δ    = θAP − θ
  at   = R · acos( clamp( cos(dAP/R) / cos(xt/R), −1, 1 ) )   // magnitude
  along = sign(cos Δ) · at
  guard: dAB < 1e-9 km  →  along-check SKIPPED (only the xt := dAP disk applies)
```

**A trip is offered to a destination-mode driver iff ALL hold:**

| # | Condition |
|---|---|
| (a) | pickup within the **normal matching radius** — enforced by the existing eligibility SQL, unchanged |
| (b) | `hav(X, T) < hav(P, T)` — drop-off **strictly closer** to the destination than the pickup is |
| (c) | `hav(X, T) ≤ 3 km` **OR** (`|xt| ≤ 5 km` **AND** `−0.5 km ≤ along ≤ dAB + 0.5 km`) |

- **The along-track check makes the corridor FINITE**: the projection of the
  drop-off onto the line must lie between the driver and the destination,
  ±500 m tolerance. A drop-off *behind* the driver fails even at `xt ≈ 0`
  (which (b) alone can pass), and one *past* T fails even when it sits on the
  line — (b) only blocks gross overshoot, not a 1–5 km overshoot.
- **(c1) is a pure 3 km disk** (no along limit — that is what the rule says):
  a drop-off ≤ 3 km from T is accepted from anywhere, including just beyond T.
- **Ride has no drop-off coordinates → destination-mode driver is skipped**
  for that ride (plain drivers unaffected).
- (b) stays in the **same AND-chain** as (a). Predicate runs **in JavaScript
  per candidate** (not in SQL): Q13's per-driver fail-closed is a per-row
  try/catch → skip that driver, log, count. Flag-off ⇒ predicate never
  executes ⇒ legacy SQL byte-identical.

### 8.3 Planned unit tests — fixtures (text now, code at build time)

Pure-function fixtures for `destinationMatches(D, T, P, X)` (equator degrees:
0.01° lat = 1.112 km; 0.01° lng = 1.112 km; `tol = 0.5 km` along-track).

**A. Geometry (predicate) fixtures** — base line D(0,0) → T(0,0.10) unless
stated (`dAB = 11.12 km`, θ = north; for X on the north–south line
`along ≈ y · 111.2 km`):

| # | Fixture (D, T, P, X) | Expect | Exercises |
|---|---|---|---|
| 1 | D(0,0) T(0,0.10) P(0,0.02) X(0,0.06) | **ACCEPT** | on-corridor: (b) 4.45<8.90 km, xt≈0, along≈6.67 |
| 2 | D(0,0) T(0,0.10) P(0,0.03) X(0,0.01) | **REJECT** | (b): drop-off *away* from T (9.90 > 7.78 km) |
| 3 | D(0,0) T(0,0.10) P(0,0.05) X(0.01,0.099) | **ACCEPT** | (c1): 1.12 km ≤ 3, off-line |
| 4 | D(0,0) T(0,0.10) P(0,0.04) X(0.04,0.07) | **ACCEPT** | (c2) only: xt≈4.45 ≤5, dist≈5.56 >3, along≈7.78 on-line |
| 5 | D(0,0) T(0,0.10) P(0,0.03) X(0.05,0.07) | **REJECT** | drop-off closer than pickup **but outside both allowances**: (b) 6.50<7.78 ✓, c1 6.50>3 ✗, xt 5.56>5 ✗ |
| 6 | boundary sets | xt **exactly** 5 → ACCEPT; X **exactly** 3 km → ACCEPT; `hav(X,T)==hav(P,T)` → **REJECT** (strict <); `along == −0.5` → ACCEPT, `along == −0.501` → REJECT; `along == dAB+0.5` → ACCEPT | inclusive ≤, exclusive < |
| 7 | X = null | **SKIP** | no drop-off coords → destination-mode driver skipped, plain drivers unaffected |
| 8 | D==T=(0,0), P(0,0.10); X(0,0.018) [2 km] and twin X(0,0.06) [6.7 km] | 2 km **ACCEPT** (c1); 6.7 km **REJECT** | `dAB≈0` guard → `xt := dAP`, along-check skipped, (c2) is a 5 km disk around T; (b) still enforced |
| 9 | fixture 1 repeated ×10 | identical results | pure, no time/queue dependence |
| 10 | **X beyond T on the line**, P before T: D(0,0) T(0,0.10) P(0,0.02) X(0,0.14) | **REJECT** | overshoot blocked by (b) *and* (c2): along≈15.6 > 11.62 |
| 11 | **behind the driver**: D(0,0) T(0,0.09) P(0.063,0) X(0,−0.018) | **REJECT** | the along-track rule alone: (b) 12.01<12.20 ✓, c1 ✗, xt=0 ✓, **along = −2.0 < −0.5** ✗ — (b) and xt both pass, only `along` catches it |
| 12 | **beyond the destination**: D(0,0) T(0,0.09) P(0.063,0) X(0,0.13) | **REJECT** | on-line overshoot 4.45 km past T: (b) passes (4.45<12.20), c1 4.45>3 ✗, xt=0 ✓, **along 14.46 > 10.01+0.5** ✗ |
| 13 | **exactly on the line** mid-segment: D(0,0) T(0,0.10) P(0,0.02) X(0,0.05) | **ACCEPT** | xt = 0 exactly, along ≈5.56 ∈ [−0.5, 11.62] |
| 14 | **3 km boundary just inside**: X beyond T by 2.99 km → X(0,0.1169) | **ACCEPT** | c1 2.99 ≤ 3 — note **(c1) is a pure disk**: accepted even past T |
| 15 | **3 km boundary just outside**: X beyond T by 3.001 km → X(0,0.1170) | **REJECT** | c1 fails; c2: xt=0 ✓ but along ≈13.0 > 10.62 ✗ |
| 16 | **pickup farther than the match radius**: hav(D,P) = 7.2 km > 7 km rung | **not offered** (SQL-level (a)) | eligibility SQL rejects before the predicate runs |
| 17 | driver **already inside the 1 km** activation radius | see L1 | cross-listed for completeness — belongs to activation, not the predicate |

**B. Activation/lifecycle fixtures** (state machine against `destination_sessions` +
`app_config`; driver online, not on a trip unless stated):

| # | Scenario | Expect | Exercises |
|---|---|---|---|
| L1 | activate while within **1 km** of the destination | **REJECT**, *"You're already close"* — no session row | §8.1 activation guard |
| L2 | activate normally, 1st use of the day | session `sast_day = today`, banner `Going to [place] - 1 of 2 uses today` | happy path |
| L3 | end + activate again, 2nd use | allowed, banner `- 2 of 2` | quota consumption |
| L4 | **3rd activation** same `sast_day` | **REJECT** `daily_limit` — no session row | 2/day limit, counted in `destination_sessions` |
| L5 | activate at **23:59:30 SAST** (day D), clear, activate at **00:01 SAST** (day D+1) | both **ACCEPT** — bucket rolls at 00:00 SAST (`sast_day`); 23:59:59 belongs to D, 00:00:00 to D+1 | midnight reset boundary (SA timezone, not UTC) |
| L6 | **destination change** mid-mode (clear/set to a new place) | old session `end_reason = 'changed'`, **new session row** = new use (counts toward today's 2) | "change = a new use" |
| L7a | driver comes within **500 m** of the destination | auto-end `end_reason = 'arrived'` + **push stating the reason** | end trigger 1 |
| L7b | driver **cancels** the mode | auto-end `end_reason = 'cancelled'` + push | end trigger 2 |
| L7c | driver goes **offline** | auto-end `end_reason = 'offline'` + push | end trigger 3 |
| L7d | **3 hours** pass with no trip | auto-end `end_reason = 'timeout_3h'` + push | end trigger 4 (sweep, like Module 1's stale-index sweep) |

**STOP** — no Module 2 code until you confirm these fixtures (and the §8
decisions) — then `002` is built on this branch plan, Module-1 style.


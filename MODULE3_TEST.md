# MODULE3_TEST.md — Performance Tier: what is proven, where, and how to run it

**Scope:** server Module 3 on `release-candidate-3` (vura-rider) — migration
`003_performance_tier.sql`, `server/src/services/performanceTier.ts`, the
`GET /api/drivers/performance-tier` REST + `driver:tier:status` socket twins,
the manual admin trigger, the nightly 02:00 SAST recalc, and the H3-path
equal-ETA tie-break. The driver-app Tier screen is `vura-driver`
(`figma-ui`, Stage 2 — `STAGE_ALL_MANUAL_TEST.md` there).

**Flag matrix (the whole module is inert at the seed):**

| `performance_tier_enabled` | allowlist | Behaviour |
|---|---|---|
| `false` (seed) | — | Recalc refuses before ANY query; tie-break returns candidates untouched; status returns `enabled:false`. Zero DB reads, zero pushes, zero ordering change. |
| `true` | empty | Nightly recalc runs + matching tie-break active; NO driver sees a Tier screen (data-collection mode). |
| `true` | contains driverId | That driver's app shows the Tier screen (REST + socket return `enabled:true` + full payload). |

---

## 1. Where each guarantee is tested

### Mocked unit suite — `server/src/services/performanceTier.test.ts` (28 tests)

```powershell
cd server; npx vitest run src/services/performanceTier.test.ts
# full suite (must stay green — was 161 passed / 9 skipped before Module 3):
npx vitest run
```

| Guarantee | Test |
|---|---|
| **Boundary values hold** — exact 150/4.6/60/10 keeps Silver; 400/4.75/70/6 Gold; 800/4.85/80/4 Platinum | `evaluateTier boundaries` |
| **ALL-criteria rule** — one step below on ANY metric drops the tier; 1000 pts + 3.9 rating floors at Bronze; 900 pts + accept 70% stays Gold | same describe |
| **Cancel threshold is inclusive** — 10% holds, 10.01% fails | same describe |
| **SQL-tuned thresholds beat the code seed** | same describe |
| **90-day window** — metrics SQL issued with `window_start = SAST today − 90d`, counting events `>=` (inclusive edge) | `metrics window starts exactly window_days…` |
| **Flag off = zero behaviour** — recalc/status/tie-break make NO query and NO write | 3 tests (one per entry point) |
| **Run-ledger guard** — nightly second-run same SAST day → `already_ran_today`, no per-driver work | `nightly run-ledger guard…` |
| **First eval is quiet** — tier recorded, no history, no push | `first evaluation records the tier quietly…` |
| **Promotion immediate** — history row + `tier_promotion` push + `driver:tier:changed` to `user:<fb>` room | `promotion is immediate…` |
| **Grace entry** — tier KEPT, `at_risk=true`, `demote_after = today+grace`, pending target stored, ONE `tier_at_risk` push, NO history | `losing the criteria enters grace…` |
| **In-grace re-run** — deadline unchanged, no second push, no history | `still failing INSIDE grace…` |
| **Grace expiry demotes** — to the CURRENT computed tier, history `demotion_grace_expired`, `tier_demotion` push | `grace EXPIRED demotes…` |
| **No new driver status** — recalc never issues `UPDATE driver_profiles SET` | `NEVER writes a driver status…` |
| **Allowlist (case-insensitive) + commission display + gap list** | `computeTierStatus` describes (incl. `cancel 6%/≤4%` formatting, grace countdown) |
| **Tie-break**: flag off untouched & no query; strict tie → higher tier first (stable for equals); NO tie → no query; `driver_tiers` unreadable → fails OPEN; missing row = bronze floor | `breakTierTies` describe |
| **Nightly gate** — flag off / hour < configured → no run; hour ≥ 2 with day-guard hit → `already_ran_today` (boot catch-up) | `runNightlyIfDue` describe |

### Real Postgres — integration suite (scratch Docker, gated)

```powershell
$env:VURA_TEST_DB_PORT='55432'
npx vitest run src/services/dispatch.integration.test.ts
```

- `beforeAll` applies **003 twice** (additive + idempotent, same contract as
  001/002) before any test.
- `migration 003 against real Postgres`: thresholds seeded in rank order;
  config row seeded flag-off with window 90 / grace 7; the partial unique
  index refuses a second **nightly** run row for the same SAST day while a
  **manual** row still inserts; `driver_tiers` accepts a full snapshot and an
  upsert (grace columns included).
- Safety guard unchanged: the suite refuses any DB that is not the local
  `127.0.0.1:55432/vura_test` container.

### Manual SQL — `server/migrations/TEST_MIGRATION.md` § 003

Checklist for the production copy: apply twice, verify seeds, nightly-guard
behaviour, rollback + re-apply. Run BEFORE the `DEPLOY_RC3.md` migration step.

---

## 2. What the mocked suite deliberately does NOT prove

- SQL acceptance on real Postgres (mitigated by the integration suite above
  and the TEST_MIGRATION checklist).
- Push DELIVERY (`sendPushToUsers` is mocked; `notify.test.ts` pins the
  return contract) and live socket fan-out (asserted as recorded emissions
  via `makeIo`, not over a network).
- The nightly tick itself (`setInterval` wiring); `runNightlyIfDue()` — the
  body of every tick — is tested directly. Boot catch-up = hour ≥ 2 + ledger.
- End-to-end tier CHANGE over days (grace takes 7 days); the grace state
  machine is tested by feeding prev-rows at each stage, which is the same
  code path the calendar walks.

## 3. Rollout order (no behaviour change until step 4)

1. Deploy server (flag stays `false` — verify: no `[tier] recalc` log lines,
   no `driver_tiers` rows appearing).
2. Apply `003_performance_tier.sql` to production (TEST_MIGRATION § 003).
3. Optional dry-run: `UPDATE app_config SET value = jsonb_set(value,
   '{performance_tier_enabled}', 'true') WHERE key = 'performance_tier';` —
   nightly recalc + tie-break active, still no driver-facing UI.
4. Add pilot driver ids to `performance_tier_rollout_driver_ids`; pilots see
   the Tier screen on their next status fetch.
5. Kill switch (either): flip the flag false (everything inert) or empty the
   allowlist (screens hidden, data keeps collecting).

## 4. Hard constraints re-verified in this change

- `findCandidatesHaversine` byte-identical to `main` —
  `node _legacycheck.mjs` from the repo root:
  `[main(f1d5859) vs HEAD] IDENTICAL=true` (SHA-256 prefix `b393b273ece2e004`).
- Commission % is stored/displayed only — no payment, fare or `platform_fee`
  code was touched (`commission` appears only in the thresholds table, the
  status payload and their tests).
- No new driver status — `driver_profiles.status` is never written by
  Module 3 (unit test + no migration column).
- Tiering uses the `performance_tier` config; `vehicle_tier` and
  `driver_cells.tier` appear nowhere in the Module 3 code paths.


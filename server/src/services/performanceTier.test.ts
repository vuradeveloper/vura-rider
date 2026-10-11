// ─────────────────────────────────────────────────────────────────────────────
// MODULE 3 — PERFORMANCE TIER tests (mocked suite, testHarness db/config/notify):
//   • evaluateTier boundaries — exact threshold values hold, one-below fails,
//     ALL-criteria rule, highest-met, bronze floor
//   • computeTierStatus gates — flag off = enabled:false with zero reads;
//     allowlist; next-tier gap list; commission display data
//   • recalculatePerformanceTiers — flag inert, run-ledger guard, quiet first
//     eval, promotion (history+push+emit), grace entry/expiry (history only on
//     the real demotion), window anchoring, and "never writes driver status"
//   • breakTierTies — flag off untouched, strict-tie swap by tier, fail-open
//   • runNightlyIfDue — flag/hour gates
// SQL validity itself is proven by the integration suite (003 applied twice
// against scratch Postgres) — see MODULE3_TEST.md.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../config/database", async () => (await import("./testHarness")).db);
vi.mock("./config", async () => (await import("./testHarness")).appConfig);
vi.mock("./notify", async () => (await import("./testHarness")).notify);

import {
  evaluateTier,
  computeTierStatus,
  recalculatePerformanceTiers,
  breakTierTies,
  runNightlyIfDue,
  sastTodayIso,
  addDaysIso,
  daysUntilIso,
  DEFAULT_THRESHOLDS,
  type TierMetrics,
} from "./performanceTier";
import { db, resetHarness, patchTierConfig, notify, makeIo } from "./testHarness";

/** Route db.query calls by SQL fragment (first match wins). Single-row
 *  fixtures are wrapped so `rows[0]` sees them — query() always yields a list. */
function route(map: Record<string, any[] | any | (() => any[]) | (() => any)>): void {
  db.query.mockImplementation(async (sql: string) => {
    for (const [frag, rows] of Object.entries(map)) {
      if (sql.includes(frag)) {
        const out = typeof rows === "function" ? rows() : rows;
        return Array.isArray(out) ? out : [out];
      }
    }
    return [];
  });
}

/** Route db.queryOne (status reads + hour check). */
function routeOne(map: Record<string, any | (() => any)>): void {
  db.queryOne.mockImplementation(async (sql: string) => {
    for (const [frag, row] of Object.entries(map)) {
      if (sql.includes(frag)) return typeof row === "function" ? row() : row;
    }
    return null;
  });
}

const execCalls = (frag: string) =>
  db.execute.mock.calls.filter((c: any[]) => String(c[0]).includes(frag));
const queryCalls = (frag: string) =>
  db.query.mock.calls.filter((c: any[]) => String(c[0]).includes(frag));
const pushes = () => notify.sendPushToUsers.mock.calls;

/** Metrics row → the tier the pure rule assigns with DEFAULT_THRESHOLDS. */
function metrics(over: Partial<TierMetrics> = {}): TierMetrics {
  return {
    points: 0, rating_avg: 4.9, accept_percent: 90, cancel_percent: 0,
    rides_completed: 0, offers_received: 0, offers_accepted: 0,
    offers_timedout: 0, driver_cancels: 0,
    ...over,
  };
}

beforeEach(() => {
  resetHarness();
});

// ── evaluateTier: the ALL-criteria rule at every boundary ────────────────────
describe("evaluateTier boundaries", () => {
  it("accepts EXACT threshold values (150/4.6/60/10 holds Silver)", () => {
    expect(evaluateTier(metrics({ points: 150, rating_avg: 4.6, accept_percent: 60, cancel_percent: 10 }))).toBe("silver");
  });

  it("fails Silver when ANY single criterion is one step below", () => {
    expect(evaluateTier(metrics({ points: 149, rating_avg: 4.6, accept_percent: 60, cancel_percent: 10 }))).toBe("bronze");
    expect(evaluateTier(metrics({ points: 150, rating_avg: 4.59, accept_percent: 60, cancel_percent: 10 }))).toBe("bronze");
    expect(evaluateTier(metrics({ points: 150, rating_avg: 4.6, accept_percent: 59.99, cancel_percent: 10 }))).toBe("bronze");
    // cancel threshold is INCLUSIVE at the max: 10 holds, a hair over fails.
    expect(evaluateTier(metrics({ points: 150, rating_avg: 4.6, accept_percent: 60, cancel_percent: 10.01 }))).toBe("bronze");
  });

  it("accepts exact Gold and exact Platinum, and the HIGHEST tier met wins", () => {
    expect(evaluateTier(metrics({ points: 400, rating_avg: 4.75, accept_percent: 70, cancel_percent: 6 }))).toBe("gold");
    expect(evaluateTier(metrics({ points: 800, rating_avg: 4.85, accept_percent: 80, cancel_percent: 4 }))).toBe("platinum");
    // Platinum-level everything: highest met is platinum, not gold.
    expect(evaluateTier(metrics({ points: 1200, rating_avg: 5.0, accept_percent: 95, cancel_percent: 1 }))).toBe("platinum");
  });

  it("a high-points driver missing ONE higher-tier criterion stays lower", () => {
    // 900 points but accept 70 < Platinum's 80: Gold is the highest MET.
    expect(evaluateTier(metrics({ points: 900, rating_avg: 4.8, accept_percent: 70, cancel_percent: 5 }))).toBe("gold");
    // Points are not a solo key: 1000 points with a 3.9 rating floors at bronze.
    expect(evaluateTier(metrics({ points: 1000, rating_avg: 3.9, accept_percent: 90, cancel_percent: 0 }))).toBe("bronze");
  });

  it("honours a SQL-tuned thresholds table over the code seed", () => {
    const custom = DEFAULT_THRESHOLDS.map((t) => (t.tier === "silver" ? { ...t, min_points: 10 } : { ...t }));
    expect(evaluateTier(metrics({ points: 10, rating_avg: 4.6, accept_percent: 60, cancel_percent: 0 }), custom)).toBe("silver");
  });
});

// ── date helpers (SAST window/grace arithmetic) ─────────────────────────────
describe("SAST date helpers", () => {
  it("adds days and counts days until without timezone drift", () => {
    expect(addDaysIso("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysIso("2026-03-14", -90)).toBe("2025-12-14");
    expect(daysUntilIso("2026-01-10", "2026-01-03")).toBe(7);
    expect(daysUntilIso("2026-01-01", "2026-01-03")).toBe(-2);
    expect(sastTodayIso(Date.UTC(2026, 0, 1, 12))).toBe("2026-01-01");
  });
});

// ── computeTierStatus: the two gates + the Tier-screen payload ──────────────
describe("computeTierStatus", () => {
  it("flag off (seed default) → enabled:false and NOT A SINGLE tier read", async () => {
    patchTierConfig({ performance_tier_enabled: false });
    const s = await computeTierStatus("d1");
    expect(s.enabled).toBe(false);
    expect(s.tier).toBeNull();
    expect(queryCalls("driver_tiers")).toHaveLength(0);
    expect(db.queryOne).not.toHaveBeenCalled();
  });

  it("flag on but empty allowlist → enabled:false (data-collection mode)", async () => {
    patchTierConfig({ performance_tier_enabled: true, performance_tier_rollout_driver_ids: [] });
    expect((await computeTierStatus("d1")).enabled).toBe(false);
  });

  it("flag on + allowlisted → full payload with display-only commission + next-tier gaps", async () => {
    patchTierConfig({ performance_tier_enabled: true, performance_tier_rollout_driver_ids: ["d1"] });
    route({ "performance_tier_thresholds": [] }); // → code-seed thresholds
    routeOne({
      "FROM driver_tiers WHERE driver_id = $1": {
        tier: "gold", points: 400, rating_avg: 4.75, accept_percent: 70, cancel_percent: 6,
        rides_completed: 400, offers_received: 500, offers_accepted: 350, offers_timedout: 100,
        driver_cancels: 20, window_start: "2026-01-01", window_end: "2026-03-31",
        at_risk: false, demote_after: null, last_eval_at: new Date("2026-03-31T02:00:00Z"),
      },
    });
    const s = await computeTierStatus("d1");
    expect(s.enabled).toBe(true);
    expect(s.tier).toBe("gold");
    expect(s.commission_percent).toBe(20);          // display data, never applied
    expect(s.next_tier?.tier).toBe("platinum");
    // EVERY unmet Platinum criterion is listed, in threshold order:
    expect(s.missing).toEqual([
      "points 400/800",
      "rating 4.75/4.85",
      "accept 70%/80%",
      "cancel 6%/≤4%",
    ]);
    expect(s.at_risk).toBe(false);
    expect(s.days_left).toBeNull();
  });

  it("an at_risk row reports the grace countdown (allowlist match is case-insensitive)", async () => {
    patchTierConfig({ performance_tier_enabled: true, performance_tier_rollout_driver_ids: ["D1"] });
    route({ "performance_tier_thresholds": [] });
    routeOne({
      "FROM driver_tiers WHERE driver_id = $1": {
        tier: "silver", points: 100, rating_avg: 4.5, accept_percent: 50, cancel_percent: 15,
        rides_completed: 100, offers_received: 0, offers_accepted: 0, offers_timedout: 0,
        driver_cancels: 5, window_start: null, window_end: null,
        at_risk: true, demote_after: addDaysIso(sastTodayIso(), 3),
        last_eval_at: new Date().toISOString(),
      },
    });
    const s = await computeTierStatus("d1");
    expect(s.enabled).toBe(true);
    expect(s.at_risk).toBe(true);
    expect(s.days_left).toBe(3);
    expect(s.next_tier?.tier).toBe("gold");
    expect(s.missing).toContain("accept 50%/70%");
  });
});

// ── recalculatePerformanceTiers: guard, grace, promotion, safety ────────────
describe("recalculatePerformanceTiers", () => {
  const TODAY = () => sastTodayIso();

  /** Standard flag-on wiring: thresholds seed, one candidate, empty prev rows. */
  function wire(over: { guard?: any[]; candidates?: any[]; prev?: any[]; metricsRow?: any } = {}) {
    route({
      "INSERT INTO performance_tier_runs": over.guard ?? [{ id: "run-1" }],
      "u.id AS driver_id": over.candidates ?? [{ driver_id: "d1", firebase_uid: "fb-d1" }],
      "AS rides_completed": over.metricsRow ?? {
        rides_completed: 0, driver_cancels: 0, offers_received: 0,
        offers_accepted: 0, offers_timedout: 0, rating_avg: 4.9,
      },
      "FROM driver_tiers WHERE driver_id = ANY": over.prev ?? [],
      "performance_tier_thresholds": [],
    });
  }

  it("flag off (the seed default) → skipped with ZERO database work", async () => {
    const r = await recalculatePerformanceTiers({ source: "nightly" });
    expect(r).toMatchObject({ ran: false, reason: "flag_off" });
    expect(db.query).not.toHaveBeenCalled();
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("nightly run-ledger guard: a second run the same SAST day is refused", async () => {
    patchTierConfig({ performance_tier_enabled: true });
    wire({ guard: [] }); // INSERT .. ON CONFLICT DO NOTHING → no row
    const r = await recalculatePerformanceTiers({ source: "nightly" });
    expect(r).toMatchObject({ ran: false, reason: "already_ran_today" });
    expect(queryCalls("AS rides_completed")).toHaveLength(0); // per-driver work never started
  });

  it("first evaluation records the tier quietly: no history, no push", async () => {
    patchTierConfig({ performance_tier_enabled: true });
    wire({
      metricsRow: { rides_completed: 500, driver_cancels: 5, offers_received: 600, offers_accepted: 500, offers_timedout: 80, rating_avg: 4.8 },
    });
    const r = await recalculatePerformanceTiers({ source: "manual" });
    expect(r).toMatchObject({ ran: true, processed: 1 });
    const upserts = execCalls("INSERT INTO driver_tiers");
    expect(upserts).toHaveLength(1);
    expect(upserts[0][1][2]).toBe(500);           // points = completed rides
    expect(upserts[0][1][1]).toBe("gold");        // 500 pts / 4.8 / 83.3% / low cancels
    expect(execCalls("driver_tier_history")).toHaveLength(0);
    expect(pushes()).toHaveLength(0);
  });

  it("promotion is immediate: history + push + live socket event", async () => {
    patchTierConfig({ performance_tier_enabled: true });
    const { io, emitted } = makeIo();
    wire({
      metricsRow: { rides_completed: 850, driver_cancels: 5, offers_received: 900, offers_accepted: 860, offers_timedout: 20, rating_avg: 4.9 },
      prev: [{ driver_id: "d1", tier: "bronze", demote_after: null }],
    });
    const r = await recalculatePerformanceTiers({ source: "manual" }, io);
    expect(r).toMatchObject({ ran: true, promoted: 1, demoted: 0, at_risk: 0 });
    expect(execCalls("driver_tier_history")[0][1]).toEqual(["d1", "bronze", "platinum", "promotion", 850]);
    expect(pushes()[0][1]).toMatchObject({ type: "tier_promotion" });
    expect(emitted).toContainEqual({
      room: "user:fb-d1",
      event: "driver:tier:changed",
      payload: { tier: "platinum", previous_tier: "bronze", at_risk: false, demote_after: null },
    });
  });

  it("losing the criteria enters grace: tier KEPT, at_risk set, ONE push, NO history", async () => {
    patchTierConfig({ performance_tier_enabled: true, performance_tier_grace_days: 7 });
    wire({
      metricsRow: { rides_completed: 20, driver_cancels: 10, offers_received: 100, offers_accepted: 40, offers_timedout: 50, rating_avg: 4.2 },
      prev: [{ driver_id: "d1", tier: "gold", demote_after: null }],
    });
    const r = await recalculatePerformanceTiers({ source: "manual" });
    expect(r).toMatchObject({ ran: true, at_risk: 1, demoted: 0 });
    const upsert = execCalls("INSERT INTO driver_tiers")[0][1];
    expect(upsert[1]).toBe("gold");                              // tier KEPT through grace
    expect(upsert[13]).toBe(true);                               // at_risk
    expect(upsert[14]).toBe(addDaysIso(TODAY(), 7));             // demote_after = today + grace
    expect(upsert[15]).toBe("bronze");                           // pending target
    expect(execCalls("driver_tier_history")).toHaveLength(0);    // no demotion yet
    expect(pushes()[0][1]).toMatchObject({ type: "tier_at_risk" });
  });

  it("still failing INSIDE grace: deadline stands, no second push, no history", async () => {
    patchTierConfig({ performance_tier_enabled: true });
    const tomorrow = addDaysIso(TODAY(), 1);
    wire({
      metricsRow: { rides_completed: 20, driver_cancels: 10, offers_received: 100, offers_accepted: 40, offers_timedout: 50, rating_avg: 4.2 },
      prev: [{ driver_id: "d1", tier: "gold", demote_after: tomorrow, demote_pending_tier: "silver" }],
    });
    const r = await recalculatePerformanceTiers({ source: "manual" });
    expect(r).toMatchObject({ ran: true, at_risk: 0, demoted: 0 });
    const upsert = execCalls("INSERT INTO driver_tiers")[0][1];
    expect(upsert[1]).toBe("gold");
    expect(upsert[14]).toBe(tomorrow);                            // ORIGINAL deadline kept
    expect(execCalls("driver_tier_history")).toHaveLength(0);
    expect(pushes()).toHaveLength(0);                             // at-risk pushes ONCE
  });

  it("grace EXPIRED demotes: history + push, honest current tier", async () => {
    patchTierConfig({ performance_tier_enabled: true });
    wire({
      metricsRow: { rides_completed: 20, driver_cancels: 10, offers_received: 100, offers_accepted: 40, offers_timedout: 50, rating_avg: 4.2 },
      prev: [{ driver_id: "d1", tier: "gold", demote_after: addDaysIso(TODAY(), -1), demote_pending_tier: "silver" }],
    });
    const r = await recalculatePerformanceTiers({ source: "manual" });
    expect(r).toMatchObject({ ran: true, demoted: 1 });
    const upsert = execCalls("INSERT INTO driver_tiers")[0][1];
    expect(upsert[1]).toBe("bronze");                             // current honest tier
    expect(upsert[13]).toBe(false);
    expect(execCalls("driver_tier_history")[0][1]).toEqual(["d1", "gold", "bronze", "demotion_grace_expired", 20]);
    expect(pushes()[0][1]).toMatchObject({ type: "tier_demotion" });
  });

  it("metrics window starts exactly window_days before the SAST day (inclusive >=)", async () => {
    patchTierConfig({ performance_tier_enabled: true, performance_tier_window_days: 90 });
    wire();
    await recalculatePerformanceTiers({ source: "manual" });
    const call = queryCalls("AS rides_completed")[0];
    expect(call[1][0]).toBe("d1");
    expect(call[1][1]).toBe(`${addDaysIso(TODAY(), -90)}T00:00:00.000Z`);
    // The SQL counts events AT the boundary, not past it.
    expect(String(call[0])).toContain(">=");
  });

  it("NEVER writes a driver status (no new availability state, hard constraint)", async () => {
    patchTierConfig({ performance_tier_enabled: true });
    wire();
    await recalculatePerformanceTiers({ source: "manual" });
    const statusWrites = db.execute.mock.calls.filter((c: any[]) =>
      /UPDATE\s+driver_profiles\s+SET/i.test(String(c[0]))
    );
    expect(statusWrites).toHaveLength(0);
  });
});

// ── breakTierTies: the H3 equal-ETA tie-break ──────────────────────────────
describe("breakTierTies", () => {
  const pairs = (etas: number[]) =>
    etas.map((eta, i) => ({ row: { id: `d${i + 1}` }, eta }));

  it("flag off (seed) → untouched, and driver_tiers is NEVER queried", async () => {
    const input = pairs([5, 5, 3]);
    const out = await breakTierTies(input, "ride-1");
    expect(out).toBe(input);
    expect(queryCalls("driver_tiers")).toHaveLength(0);
  });

  it("flag on + strict tie → higher tier wins; pool order breaks equal tiers", async () => {
    patchTierConfig({ performance_tier_enabled: true });
    route({
      "SELECT user_id, tier FROM driver_tiers": [
        { user_id: "d1", tier: "bronze" },
        { user_id: "d2", tier: "gold" },
        { user_id: "d3", tier: "gold" },
      ],
    });
    const out = await breakTierTies(pairs([5, 5, 5]), "ride-1");
    expect(out.map((p) => p.row.id)).toEqual(["d2", "d3", "d1"]); // gold, gold (stable), bronze
  });

  it("no tie anywhere → untouched, and driver_tiers is NEVER queried", async () => {
    patchTierConfig({ performance_tier_enabled: true });
    const input = pairs([3, 5, 7]);
    const out = await breakTierTies(input, "ride-1");
    expect(out).toBe(input);
    expect(queryCalls("driver_tiers")).toHaveLength(0);
  });

  it("different ETAs dominate: tier only reorders STRICT ties", async () => {
    patchTierConfig({ performance_tier_enabled: true });
    route({
      "SELECT user_id, tier FROM driver_tiers": [
        { user_id: "d2", tier: "platinum" },
        { user_id: "d3", tier: "gold" },
      ],
    });
    // Input PRE-SORTED by eta (as the H3 path passes it): d1 fastest but
    // bronze-unknown; the d2/d3 TIE is broken platinum-first.
    const out = await breakTierTies(pairs([3, 5, 5]), "ride-1");
    expect(out.map((p) => p.row.id)).toEqual(["d1", "d2", "d3"]);
    expect(queryCalls("driver_tiers")).toHaveLength(1); // the tie cost one query
  });

  it("fails OPEN to the input order when driver_tiers is unreadable (003 missing)", async () => {
    patchTierConfig({ performance_tier_enabled: true });
    db.query.mockRejectedValue(new Error("relation does not exist"));
    const input = pairs([5, 5]);
    const out = await breakTierTies(input, "ride-1");
    expect(out).toBe(input);
  });

  it("a driver with NO tier row ranks as the bronze floor", async () => {
    patchTierConfig({ performance_tier_enabled: true });
    route({ "SELECT user_id, tier FROM driver_tiers": [{ user_id: "d2", tier: "silver" }] });
    const out = await breakTierTies(pairs([4, 4]), "ride-1"); // d1 unknown, d2 silver
    expect(out.map((p) => p.row.id)).toEqual(["d2", "d1"]);
  });
});

// ── runNightlyIfDue: the 02:00 SAST gate ───────────────────────────────────
describe("runNightlyIfDue", () => {
  it("flag off → flag_off without touching the clock", async () => {
    expect(await runNightlyIfDue()).toEqual({ ran: false, reason: "flag_off" });
    expect(db.queryOne).not.toHaveBeenCalled();
  });

  it("before the configured hour → not_due", async () => {
    patchTierConfig({ performance_tier_enabled: true, performance_tier_recalc_hour_sast: 2 });
    routeOne({ "EXTRACT(HOUR": { sast_hour: 1 } });
    expect(await runNightlyIfDue()).toEqual({ ran: false, reason: "not_due" });
    expect(queryCalls("performance_tier_runs")).toHaveLength(0);
  });

  it("at/after the hour it delegates to the recalc (which owns the day guard)", async () => {
    patchTierConfig({ performance_tier_enabled: true, performance_tier_recalc_hour_sast: 2 });
    routeOne({ "EXTRACT(HOUR": { sast_hour: 5 } }); // 05:00 — the boot catch-up case
    route({ "INSERT INTO performance_tier_runs": [] }); // already ran today
    expect(await runNightlyIfDue()).toEqual({ ran: false, reason: "already_ran_today" });
  });
});
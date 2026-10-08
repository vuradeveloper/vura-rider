// ─────────────────────────────────────────────────────────────────────────────
// DESTINATION SESSION — activation rules (§8.1 / fixtures L1-L6):
// flag gate, coordinate validation, online/not-on-trip, the 1 km reject,
// the SAST daily limit, idempotent re-activate, change = new use.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../config/database", async () => (await import("./testHarness")).db);
vi.mock("./config", async () => (await import("./testHarness")).appConfig);
vi.mock("./notify", async () => (await import("./testHarness")).notify);

import {
  activateDestination,
  clearDestination,
  getDestinationStatus,
  noteDestinationTripCompleted,
  onDriverPingPosition,
  sweepDestinationSessionsOnce,
  DESTINATION_ERROR_HTTP_STATUS,
  type ActivateErrorCode,
} from "./destinationSession";
import { db, resetHarness, patchDestinationConfig, patchConfig, notify, makeIo } from "./testHarness";
import { getCounters } from "./metrics";

/** Route db.query calls by SQL fragment (first match wins). */
function route(map: Record<string, any[] | (() => any[])>): void {
  db.query.mockImplementation(async (sql: string) => {
    for (const [frag, rows] of Object.entries(map)) {
      if (sql.includes(frag)) return (typeof rows === "function" ? rows() : rows) as any[];
    }
    return [];
  });
}

const PROFILE_OK = {
  is_online: true,
  status: "available",
  current_lat: -26.1076,
  current_lng: 28.0567,
};
const usageRow = (n: number) => [{ n, sast_day: "2026-10-08" }];
const calls = (frag: string) =>
  db.execute.mock.calls.filter((c: any[]) => String(c[0]).includes(frag));

beforeEach(() => {
  resetHarness();
  // Q12: activation is gated by flag AND driver allowlist — the default test
  // driver is inside the rollout.
  patchDestinationConfig({
    destination_matching_enabled: true,
    destination_rollout_driver_ids: ["d1"],
  });
});

describe("activateDestination", () => {
  it("refuses while the feature flag is off (seed default)", async () => {
    patchDestinationConfig({ destination_matching_enabled: false });
    const r = await activateDestination("d1", { lat: -26.1, lng: 28.1, label: "Sandton" });
    expect(r).toMatchObject({ ok: false, error: "disabled" });
    expect(calls("INSERT INTO destination_sessions")).toHaveLength(0);
  });

  it("refuses drivers outside the rollout allowlist (Q12 gate)", async () => {
    patchDestinationConfig({ destination_rollout_driver_ids: ["someone-else"] });
    const r = await activateDestination("d1", { lat: -26.1, lng: 28.1, label: "Sandton" });
    expect(r).toMatchObject({ ok: false, error: "disabled" });
    expect(calls("INSERT INTO destination_sessions")).toHaveLength(0);
  });

  it("rejects invalid coordinates and empty labels", async () => {
    route({ "COUNT(*)": usageRow(0) });
    expect(await activateDestination("d1", { lat: 999, lng: 28.1, label: "X" })).toMatchObject({
      ok: false,
      error: "invalid_coordinates",
    });
    expect(await activateDestination("d1", { lat: -26.1, lng: 28.1, label: "  " })).toMatchObject({
      ok: false,
      error: "invalid_coordinates",
    });
  });

  it("fails closed for a missing profile / offline / on-trip driver", async () => {
    route({ "COUNT(*)": usageRow(0), "FROM driver_profiles": [] });
    expect(await activateDestination("d1", { lat: -26.1, lng: 28.1, label: "S" })).toMatchObject({
      ok: false,
      error: "not_found",
    });
    route({
      "COUNT(*)": usageRow(0),
      "FROM driver_profiles": [{ ...PROFILE_OK, is_online: false }],
    });
    expect(await activateDestination("d1", { lat: -26.1, lng: 28.1, label: "S" })).toMatchObject({
      ok: false,
      error: "not_online",
    });
    route({
      "COUNT(*)": usageRow(0),
      "FROM driver_profiles": [{ ...PROFILE_OK, status: "in_progress" }],
    });
    expect(await activateDestination("d1", { lat: -26.1, lng: 28.1, label: "S" })).toMatchObject({
      ok: false,
      error: "on_trip",
    });
  });

  it("L1: rejects when the driver is already inside the 1 km radius", async () => {
    route({ "COUNT(*)": usageRow(0), "FROM driver_profiles": [PROFILE_OK] });
    // 0.004° east ≈ 0.445 km — inside the default 1 km reject radius.
    const r = await activateDestination("d1", { lat: -26.1076, lng: 28.0607, label: "Corner" });
    expect(r).toMatchObject({ ok: false, error: "already_close" });
    expect(calls("INSERT INTO destination_sessions")).toHaveLength(0);
  });

  it("L4: rejects the 3rd activation of the SAST day (daily_limit)", async () => {
    route({ "COUNT(*)": usageRow(2), "FROM driver_profiles": [PROFILE_OK] });
    const r = await activateDestination("d1", { lat: -26.1, lng: 28.4, label: "Far" });
    expect(r).toMatchObject({ ok: false, error: "daily_limit" });
    expect(calls("INSERT INTO destination_sessions")).toHaveLength(0);
  });

  it("happy path: opens a session, writes the profile, logs + counts + banners", async () => {
    let usageCalls = 0;
    route({
      "COUNT(*)": () => usageRow(usageCalls++), // 1st: limit check (0), 2nd: status (1)
      "FROM driver_profiles": [PROFILE_OK],
      "FROM destination_sessions": [],
    });
    const r = await activateDestination("d1", { lat: -26.1, lng: 28.4, label: "Sandton" });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toMatchObject({
      active: true,
      label: "Sandton",
      uses_today: 1,
      max_uses: 2,
      banner: "Going to Sandton - 1 of 2 uses today",
      sast_day: "2026-10-08",
    });
    const ins = calls("INSERT INTO destination_sessions");
    expect(ins).toHaveLength(1);
    expect(ins[0][1]).toEqual(["d1", -26.1, 28.4, "Sandton", 180]); // idle minutes from config
    const prof = calls("UPDATE driver_profiles");
    expect(prof).toHaveLength(1);
    expect(prof[0][1]).toEqual([-26.1, 28.4, "Sandton", 180, "d1"]); // 180 min idle timer from config
    expect(calls("destination_events")).toHaveLength(1); // activated
    expect(getCounters().destination_activated).toBe(1);
  });

  it("re-activating the SAME destination is idempotent (no extra use)", async () => {
    route({
      "COUNT(*)": usageRow(1),
      "FROM driver_profiles": [PROFILE_OK],
      "FROM destination_sessions": [
        { id: "s1", label: "Sandton", lat: -26.1, lng: 28.4, expires_at: null },
      ],
    });
    const r = await activateDestination("d1", { lat: -26.1, lng: 28.4, label: "Sandton" });
    expect(r.ok).toBe(true);
    expect(calls("INSERT INTO destination_sessions")).toHaveLength(0);
    expect(calls("end_reason = 'changed'")).toHaveLength(0);
  });

  it("L6: changing the destination closes the old session as 'changed' (a NEW use)", async () => {
    route({
      "COUNT(*)": usageRow(1),
      "FROM driver_profiles": [PROFILE_OK],
      "FROM destination_sessions": [
        { id: "s1", label: "Sandton", lat: -26.1, lng: 28.4, expires_at: null },
      ],
    });
    const r = await activateDestination("d1", { lat: -26.2, lng: 28.0, label: "Airport" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status.label).toBe("Airport");
    const changed = calls("end_reason = 'changed'");
    expect(changed).toHaveLength(1);
    expect(changed[0][1]).toEqual(["s1"]);
    expect(calls("INSERT INTO destination_sessions")).toHaveLength(1); // the NEW session
    expect(getCounters().destination_activated).toBe(1);
  });
});

describe("clearDestination / getDestinationStatus", () => {
  it("L7b: cancel ends the session as 'cancelled', clears the profile, pushes the reason", async () => {
    route({
      "COUNT(*)": usageRow(1),
      "FROM destination_sessions": [
        { id: "s1", label: "Sandton", lat: -26.1, lng: 28.4, expires_at: null },
      ],
    });
    const r = await clearDestination("d1");
    expect(r.ok).toBe(true);
    expect(r.status.active).toBe(false);
    const ended = calls("end_reason = 'cancelled'");
    expect(ended).toHaveLength(1);
    expect(ended[0][1]).toEqual(["s1"]);
    expect(calls("destination_lat = NULL")).toHaveLength(1);
    expect(notify.sendPushToUsers).toHaveBeenCalledTimes(1);
    expect(notify.sendPushToUsers).toHaveBeenCalledWith(
      ["d1"],
      expect.objectContaining({ type: "destination_mode_ended", data: { reason: "cancelled" } })
    );
  });

  it("clear with no active session is a coherent no-op", async () => {
    route({ "COUNT(*)": usageRow(0), "FROM destination_sessions": [] });
    const r = await clearDestination("d1");
    expect(r.ok).toBe(true);
    expect(r.status).toMatchObject({ active: false, banner: null, label: null });
    expect(calls("end_reason = 'cancelled'")).toHaveLength(0);
    expect(notify.sendPushToUsers).not.toHaveBeenCalled();
  });

  it("status reports the banner while active and null when not", async () => {
    route({
      "COUNT(*)": usageRow(2),
      "FROM destination_sessions": [
        { id: "s1", label: "Rosebank", lat: -26.14, lng: 28.04, expires_at: "2026-10-08T12:00:00Z" },
      ],
    });
    const active = await getDestinationStatus("d1");
    expect(active).toMatchObject({
      active: true,
      label: "Rosebank",
      uses_today: 2,
      max_uses: 2,
      banner: "Going to Rosebank - 2 of 2 uses today",
      expires_at: "2026-10-08T12:00:00Z",
    });

    route({ "COUNT(*)": usageRow(2), "FROM destination_sessions": [] });
    const idle = await getDestinationStatus("d1");
    expect(idle).toMatchObject({ active: false, banner: null, uses_today: 2 });
  });
});

describe("sweepDestinationSessionsOnce (auto-end: L7a / L7c / L7d)", () => {
  /** Live position ~7 km from the destination — online, not expired: keep. */
  const row = (over: Partial<Record<string, unknown>> = {}) => ({
    id: "sess-1",
    driver_id: "d1",
    lat: -26.145,
    lng: 28.04, // Rosebank
    label: "Rosebank",
    expires_at: new Date(Date.now() + 3 * 3600_000),
    current_lat: -26.2,
    current_lng: 28.1,
    last_location_at: new Date(),
    last_heartbeat_at: new Date(),
    is_online: true,
    status: "available",
    firebase_uid: "fb-d1",
    ...over,
  });
  const sweepRoute = (rows: any[]) => route({ "ds.ended_at IS NULL": rows });
  const closedReasons = () => calls("UPDATE destination_sessions").map((c: any[]) => c[1]);

  it("L7a: within 500 m with a fresh fix -> 'arrived' + push + socket + counter", async () => {
    // 0.003° north of the destination ≈ 0.33 km — inside the 500 m radius.
    sweepRoute([row({ current_lat: -26.142, current_lng: 28.04 })]);
    const { io, emitted } = makeIo();

    expect(await sweepDestinationSessionsOnce(io)).toBe(1);
    expect(closedReasons()).toEqual([["sess-1", "arrived"]]);
    expect(calls("destination_lat = NULL")).toHaveLength(1); // profile wiped
    expect(calls("destination_events")).toHaveLength(1); // audit row
    expect(getCounters().destination_ended).toBe(1);
    expect(notify.sendPushToUsers).toHaveBeenCalledWith(
      ["d1"],
      expect.objectContaining({
        type: "destination_mode_ended",
        data: { reason: "arrived" },
      })
    );
    expect(emitted).toContainEqual({
      room: "user:fb-d1",
      event: "driver:destination:ended",
      payload: { reason: "arrived" },
    });
  });

  it("L7c: explicit offline (is_online=false) ends; a short drop (status demoted, heartbeat fresh) does NOT", async () => {
    sweepRoute([row({ is_online: false })]);
    expect(await sweepDestinationSessionsOnce(makeIo().io)).toBe(1);
    expect(closedReasons()).toEqual([["sess-1", "offline"]]);

    // Short socket drop: the stale sweep demoted status to 'offline' but the
    // driver is still online-intent and the last ping is inside the grace
    // window — the session must stay open and no daily use is burned.
    resetHarness();
    patchDestinationConfig({ destination_matching_enabled: true, destination_rollout_driver_ids: ["d1"] });
    sweepRoute([row({ is_online: true, status: "offline" })]);
    expect(await sweepDestinationSessionsOnce(makeIo().io)).toBe(0);
    expect(calls("UPDATE destination_sessions")).toHaveLength(0);
    expect(getCounters().destination_ended ?? 0).toBe(0);

    // Silence past destination_offline_grace_seconds (default 300 s) = offline.
    resetHarness();
    patchDestinationConfig({ destination_matching_enabled: true, destination_rollout_driver_ids: ["d1"] });
    sweepRoute([
      row({
        is_online: true,
        status: "offline",
        last_location_at: new Date(Date.now() - 400_000),
        last_heartbeat_at: new Date(Date.now() - 400_000),
      }),
    ]);
    expect(await sweepDestinationSessionsOnce(makeIo().io)).toBe(1);
    expect(closedReasons()).toEqual([["sess-1", "offline"]]);
  });

  it("L7c: a custom grace window is honoured (60 s)", async () => {
    patchDestinationConfig({ destination_offline_grace_seconds: 60 });
    sweepRoute([
      row({
        last_location_at: new Date(Date.now() - 90_000),
        last_heartbeat_at: new Date(Date.now() - 90_000),
      }),
    ]);
    expect(await sweepDestinationSessionsOnce(makeIo().io)).toBe(1);
    expect(closedReasons()).toEqual([["sess-1", "offline"]]);
  });

  it("L7c: missing timestamps (null heartbeat AND location) never mean offline", async () => {
    sweepRoute([
      row({ last_location_at: null, last_heartbeat_at: null }),
    ]);
    expect(await sweepDestinationSessionsOnce(makeIo().io)).toBe(0);
    expect(calls("UPDATE destination_sessions")).toHaveLength(0);
  });

  it("L7d: the 3h clock expired -> 'timeout_3h'", async () => {
    sweepRoute([row({ expires_at: new Date(Date.now() - 1000) })]);
    expect(await sweepDestinationSessionsOnce(makeIo().io)).toBe(1);
    expect(closedReasons()).toEqual([["sess-1", "timeout_3h"]]);
    expect(getCounters().destination_ended).toBe(1);
  });

  it("stale position never counts as arrived: the session stays open", async () => {
    patchConfig({ max_position_age_seconds: 300 });
    sweepRoute([
      row({
        current_lat: -26.145, // parked AT the destination...
        current_lng: 28.04,
        last_location_at: new Date(Date.now() - 600_000), // ...but fix is 10 min old
      }),
    ]);
    expect(await sweepDestinationSessionsOnce(makeIo().io)).toBe(0);
    expect(calls("UPDATE destination_sessions")).toHaveLength(0);
    expect(getCounters().destination_ended).toBe(0);
  });

  it("one row ends for ONE reason: arrived > offline > timeout_3h", async () => {
    sweepRoute([
      row({
        current_lat: -26.142,
        current_lng: 28.04,
        is_online: false,
        expires_at: new Date(Date.now() - 1000),
      }),
    ]);
    expect(await sweepDestinationSessionsOnce(makeIo().io)).toBe(1);
    expect(closedReasons()).toEqual([["sess-1", "arrived"]]);

    resetHarness();
    patchDestinationConfig({ destination_matching_enabled: true, destination_rollout_driver_ids: ["d1"] });
    sweepRoute([row({ is_online: false, expires_at: new Date(Date.now() - 1000) })]);
    expect(await sweepDestinationSessionsOnce(makeIo().io)).toBe(1);
    expect(closedReasons()).toEqual([["sess-1", "offline"]]);
  });

  it("a session closed by someone else mid-sweep (rowCount=0) is skipped entirely", async () => {
    sweepRoute([row({ is_online: false })]);
    db.execute.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // the close UPDATE
    expect(await sweepDestinationSessionsOnce(makeIo().io)).toBe(0);
    expect(calls("destination_lat = NULL")).toHaveLength(0);
    expect(notify.sendPushToUsers).not.toHaveBeenCalled();
    expect(getCounters().destination_ended).toBe(0);
  });

  it("never overlaps itself: a second sweep while one is in flight returns 0", async () => {
    let release!: () => void;
    let queried = false;
    db.query.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          queried = true;
          release = () => resolve([]);
        })
    );
    const { io } = makeIo();

    const first = sweepDestinationSessionsOnce(io);
    // The guard trips synchronously — before the first run even reaches its SELECT.
    expect(await sweepDestinationSessionsOnce(io)).toBe(0);
    for (let i = 0; i < 50 && !queried; i++) await new Promise((r) => setTimeout(r, 0));
    expect(queried).toBe(true);
    release();
    expect(await first).toBe(0);
    expect(db.query).toHaveBeenCalledTimes(1); // only the first run ever queried
  });
});

// ── 4h-fix4: flag off / driver removed from rollout MID-SESSION ──────────────
describe("feature_disabled mid-session (paused status + sweep end)", () => {
  const activeSession = () => ({
    id: "sess-1",
    label: "Rosebank",
    lat: -26.145,
    lng: 28.04,
    expires_at: new Date(Date.now() + 3 * 3600_000),
  });
  const statusRoute = (session: object | null) =>
    route({
      "FROM destination_sessions": session ? [session] : [],
      "COUNT(*)": [{ n: 1, sast_day: "2026-10-08" }],
    });
  const sweepRow = (over: Record<string, unknown> = {}) => ({
    id: "sess-1",
    driver_id: "d1",
    lat: -26.145,
    lng: 28.04,
    label: "Rosebank",
    expires_at: new Date(Date.now() + 3 * 3600_000),
    current_lat: -26.2, // ~7 km away — would normally keep running
    current_lng: 28.1,
    last_location_at: new Date(),
    last_heartbeat_at: new Date(),
    is_online: true,
    status: "available",
    firebase_uid: "fb-d1",
    ...over,
  });

  it("status reports paused:true + reason while the flag is off and a session is open", async () => {
    patchDestinationConfig({ destination_matching_enabled: false });
    statusRoute(activeSession());
    const s = await getDestinationStatus("d1");
    expect(s.active).toBe(true); // not yet ended — the sweep does that
    expect(s.paused).toBe(true);
    expect(s.pause_reason).toBeTruthy();
  });

  it("status reports paused:true when the driver was dropped from the rollout", async () => {
    patchDestinationConfig({ destination_rollout_driver_ids: ["someone-else"] });
    statusRoute(activeSession());
    const s = await getDestinationStatus("d1");
    expect(s.paused).toBe(true);
    expect(s.pause_reason).toBeTruthy();
  });

  it("status is normal (paused:false) while allowed, and with no session even when flag off", async () => {
    statusRoute(activeSession());
    expect((await getDestinationStatus("d1")).paused).toBe(false);
    patchDestinationConfig({ destination_matching_enabled: false });
    statusRoute(null);
    const s = await getDestinationStatus("d1");
    expect(s.active).toBe(false);
    expect(s.paused).toBe(false); // nothing to pause
    expect(s.pause_reason).toBeNull();
  });

  it("sweep ends the session as 'feature_disabled' when the flag is flipped off", async () => {
    patchDestinationConfig({ destination_matching_enabled: false });
    route({ "ds.ended_at IS NULL": [sweepRow()] });
    const { io, emitted } = makeIo();
    expect(await sweepDestinationSessionsOnce(io)).toBe(1);
    expect(calls("UPDATE destination_sessions")[0][1]).toEqual([
      "sess-1",
      "feature_disabled",
    ]);
    expect(calls("destination_lat = NULL")).toHaveLength(1); // profile wiped
    expect(notify.sendPushToUsers).toHaveBeenCalledWith(
      ["d1"],
      expect.objectContaining({
        type: "destination_mode_ended",
        data: { reason: "feature_disabled" },
      })
    );
    expect(emitted).toContainEqual({
      room: "user:fb-d1",
      event: "driver:destination:ended",
      payload: { reason: "feature_disabled" },
    });
  });

  it("sweep ends it when the driver leaves the rollout (flag still on)", async () => {
    patchDestinationConfig({ destination_rollout_driver_ids: ["someone-else"] });
    route({ "ds.ended_at IS NULL": [sweepRow()] });
    expect(await sweepDestinationSessionsOnce(makeIo().io)).toBe(1);
    expect(calls("UPDATE destination_sessions")[0][1]).toEqual([
      "sess-1",
      "feature_disabled",
    ]);
  });

  it("feature_disabled beats every other reason (ops action wins, needs no data)", async () => {
    patchDestinationConfig({ destination_matching_enabled: false });
    route({
      "ds.ended_at IS NULL": [
        sweepRow({
          current_lat: -26.145, // parked AT the destination...
          current_lng: 28.04,
          is_online: false, // ...and offline...
          expires_at: new Date(Date.now() - 1000), // ...and expired
          last_location_at: null,
          last_heartbeat_at: null,
        }),
      ],
    });
    expect(await sweepDestinationSessionsOnce(makeIo().io)).toBe(1);
    expect(calls("UPDATE destination_sessions")[0][1]).toEqual([
      "sess-1",
      "feature_disabled",
    ]);
  });

  it("flag on + driver allowlisted → the sweep never emits feature_disabled", async () => {
    route({ "ds.ended_at IS NULL": [sweepRow()] }); // beforeEach allows d1
    expect(await sweepDestinationSessionsOnce(makeIo().io)).toBe(0);
    expect(calls("UPDATE destination_sessions")).toHaveLength(0);
  });
});

// ── 4h-fix3: completed trip = trips_completed++ and the idle timer resets ────
describe("noteDestinationTripCompleted (reset on each completed trip)", () => {
  it("increments trips_completed AND resets the timer on the session + profile", async () => {
    expect(await noteDestinationTripCompleted("d1", "ride-1")).toBe(true);
    const bump = calls("trips_completed = trips_completed + 1");
    expect(bump).toHaveLength(1);
    expect(bump[0][1]).toEqual(["d1", "ride-1", 180]); // idle minutes from config
    const mirror = calls("UPDATE driver_profiles");
    expect(mirror).toHaveLength(1);
    expect(mirror[0][1]).toEqual(["d1", 180]); // banner/status clock moves too
    expect(calls("INSERT INTO destination_events")).toHaveLength(1); // audit row
    expect(calls("INSERT INTO destination_events")[0][1][1]).toBe("trip_completed");
  });

  it("honours a custom destination_max_minutes_without_trip", async () => {
    patchDestinationConfig({ destination_max_minutes_without_trip: 45 });
    expect(await noteDestinationTripCompleted("d1", "ride-1")).toBe(true);
    expect(calls("trips_completed = trips_completed + 1")[0][1]).toEqual(["d1", "ride-1", 45]);
  });

  it("no active session -> nothing happens (a trip does NOT start a session)", async () => {
    db.execute.mockResolvedValueOnce({ rowCount: 0, rows: [] }); // the guarded UPDATE
    expect(await noteDestinationTripCompleted("d1", "ride-1")).toBe(false);
    expect(calls("UPDATE driver_profiles")).toHaveLength(0);
    expect(calls("destination_events")).toHaveLength(0);
  });

  it("a DB failure returns false and never throws into the ride flow", async () => {
    db.execute.mockRejectedValueOnce(new Error("db down"));
    await expect(noteDestinationTripCompleted("d1", "ride-1")).resolves.toBe(false);
  });
});

// ── 4h-fix2: arrival check on every GPS ping (sweep stays as backup) ──────────
describe("onDriverPingPosition (arrival on each driver location update)", () => {
  const sessionRoute = (rows: any[]) => route({ "ds.ended_at IS NULL": rows });
  const session = (over: Record<string, unknown> = {}) => ({
    id: "sess-9",
    driver_id: "d1",
    lat: -26.145, // Rosebank
    lng: 28.04,
    label: "Rosebank",
    firebase_uid: "fb-d1",
    ...over,
  });

  it("no active session -> a cheap no-op (no config read, no UPDATE)", async () => {
    sessionRoute([]);
    const { io } = makeIo();
    expect(await onDriverPingPosition(io, "d1", -26.142, 28.04)).toBe(false);
    expect(calls("UPDATE destination_sessions")).toHaveLength(0);
    expect(notify.sendPushToUsers).not.toHaveBeenCalled();
  });

  it("a ping beyond the 500 m radius never ends the session", async () => {
    sessionRoute([session()]); // destination Rosebank; ping ~7 km away
    const { io } = makeIo();
    expect(await onDriverPingPosition(io, "d1", -26.2, 28.1)).toBe(false);
    expect(calls("UPDATE destination_sessions")).toHaveLength(0);
    expect(notify.sendPushToUsers).not.toHaveBeenCalled();
  });

  it("a ping inside the radius ends it once: 'arrived' + push + socket + counter", async () => {
    sessionRoute([session()]);
    const { io, emitted } = makeIo();
    // ~0.003° north ≈ 0.33 km — inside the 500 m radius.
    expect(await onDriverPingPosition(io, "d1", -26.142, 28.04)).toBe(true);
    const closed = calls("UPDATE destination_sessions");
    expect(closed).toHaveLength(1);
    expect(closed[0][1]).toEqual(["sess-9", "arrived"]);
    expect(calls("destination_lat = NULL")).toHaveLength(1); // profile wiped
    expect(getCounters().destination_ended).toBe(1);
    expect(notify.sendPushToUsers).toHaveBeenCalledTimes(1);
    expect(notify.sendPushToUsers).toHaveBeenCalledWith(
      ["d1"],
      expect.objectContaining({ data: { reason: "arrived" } })
    );
    expect(emitted).toContainEqual({
      room: "user:fb-d1",
      event: "driver:destination:ended",
      payload: { reason: "arrived" },
    });
  });

  it("cannot end a session twice: the second close loses the row-guard (rowCount=0)", async () => {
    sessionRoute([session()]);
    const { io } = makeIo();
    expect(await onDriverPingPosition(io, "d1", -26.142, 28.04)).toBe(true);
    // The sweep (or a concurrent ping) closed it first on the next attempt.
    db.execute.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    expect(await onDriverPingPosition(io, "d1", -26.142, 28.04)).toBe(false);
    expect(calls("destination_lat = NULL")).toHaveLength(1); // wipe ran ONCE
    expect(notify.sendPushToUsers).toHaveBeenCalledTimes(1); // push ran ONCE
    expect(getCounters().destination_ended).toBe(1); // counter ran ONCE
    expect(calls("destination_events")).toHaveLength(1); // audit ran ONCE
  });
});

// ── 4f: REST/socket transport contract ───────────────────────────────────────
// The HTTP status map lives beside the ActivateErrorCode union so both
// transports share ONE mapping. This test fails the moment a new service error
// code is added without deciding its HTTP status — routes/drivers.ts imports
// this record verbatim, so there is no second copy to drift.
describe("DESTINATION_ERROR_HTTP_STATUS (transport contract)", () => {
  const ALL_CODES: ActivateErrorCode[] = [
    "disabled",
    "invalid_coordinates",
    "not_found",
    "not_online",
    "on_trip",
    "already_close",
    "daily_limit",
    "internal",
  ];

  it("maps every ActivateErrorCode exactly once (no extras, none missing)", () => {
    expect(Object.keys(DESTINATION_ERROR_HTTP_STATUS).sort()).toEqual(
      [...ALL_CODES].sort()
    );
  });

  it("uses the approved statuses: state conflicts 409, quota 429, flag 403", () => {
    expect(DESTINATION_ERROR_HTTP_STATUS).toMatchObject({
      disabled: 403,
      invalid_coordinates: 400,
      not_found: 404,
      not_online: 409,
      on_trip: 409,
      already_close: 409,
      daily_limit: 429,
      internal: 500,
    });
  });
});

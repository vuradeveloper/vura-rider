// ─────────────────────────────────────────────────────────────────────────────
// DESTINATION SESSION — activation rules (§8.1 / fixtures L1-L6):
// flag gate, coordinate validation, online/not-on-trip, the 1 km reject,
// the SAST daily limit, idempotent re-activate, change = new use.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../config/database", async () => (await import("./testHarness")).db);
vi.mock("./config", async () => (await import("./testHarness")).appConfig);
vi.mock("./notify", async () => (await import("./testHarness")).notify);

import { activateDestination, clearDestination, getDestinationStatus } from "./destinationSession";
import { db, resetHarness, patchDestinationConfig, notify } from "./testHarness";
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
  patchDestinationConfig({ destination_matching_enabled: true });
});

describe("activateDestination", () => {
  it("refuses while the feature flag is off (seed default)", async () => {
    patchDestinationConfig({ destination_matching_enabled: false });
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
    expect(ins[0][1]).toEqual(["d1", -26.1, 28.4, "Sandton"]);
    const prof = calls("UPDATE driver_profiles");
    expect(prof).toHaveLength(1);
    expect(prof[0][1]).toEqual([-26.1, 28.4, "Sandton", 3 * 3600, "d1"]); // 3h expiry from config
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

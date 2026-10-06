// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DISPATCH: timeout hand-off + exhaustion.
// Scenarios 4-5 of the dispatch spec: an expired offer moves to the NEXT driver
// (never the same one twice), and when nobody is left the RIDER is told.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  db, notify, makeIo, mockRide, traceStage, rideEvents, resetHarness, DRIVER_NEAR, RIDE,
} from "./testHarness";

// Async factories: evaluated after hoisting, so the module instance (and
// therefore the SAME vi.fn() objects the test file holds) is returned.
vi.mock("../config/database", async () => (await import("./testHarness")).db);
vi.mock("./notify", async () => (await import("./testHarness")).notify);
vi.mock("./vehicleImages", async () => (await import("./testHarness")).vehicleImages);
// Flag-OFF config so getConfig() neither consumes the queryOne Once-queue nor
// flips these legacy scenarios onto the Module 1 H3 path.
vi.mock("./config", async () => (await import("./testHarness")).appConfig);

import { offerToNextDriver, expireOffers, markNoDrivers, declineOffer } from "./dispatch";

beforeEach(() => {
  resetHarness();
  mockRide();
});

describe("4. offer timeout moves to the next driver", () => {
  it("expires the stale offer and re-offers to somebody else", async () => {
    const { io, emitted } = makeIo();

    // 1) the due-offer sweep
    db.query.mockResolvedValueOnce([
      { id: "offer-1", ride_id: "ride-1", driver_id: "driver-1", round: 1 },
    ]);
    // 2) the re-offer's candidate search: a DIFFERENT driver is now closest
    db.query.mockResolvedValueOnce([
      { ...DRIVER_NEAR, id: "driver-2", firebase_uid: "fb-d2", distance_km: 0.9 },
    ]);

    // queryOne is hit three times, in this order: the ride's current status (the
    // re-offer only happens if it is still searching), then loadRide, then the
    // new offer INSERT.
    db.queryOne
      .mockImplementationOnce(async () => ({ status: "searching" }))
      .mockImplementationOnce(async () => ({ ...RIDE, offer_round: 1 }))
      .mockImplementationOnce(async () => ({ id: "offer-2", expires_at: "2026-01-01T00:00:30Z" }));

    const n = await expireOffers(io);
    expect(n).toBe(1);

    // The stale offer must be closed. expireOffers keys this UPDATE by OFFER id
    // (WHERE id = $1 AND status = 'pending'), not by driver id.
    const expired = db.execute.mock.calls.find((c: any[]) =>
      String(c[0]).includes("UPDATE ride_offers") &&
      String(c[0]).includes("expired") &&
      String(c[0]).includes("WHERE id = $1")
    );
    expect(expired).toBeDefined();
    expect(expired![1]).toEqual(["offer-1"]);

    // The next offer must go to driver-2, in round 2 -- never back to driver-1.
    const insertCall = db.queryOne.mock.calls.find((c: any[]) =>
      String(c[0]).includes("INSERT INTO ride_offers")
    );
    expect(insertCall![1]).toEqual(["ride-1", "driver-2", 15, 2]);

    const offerEvents = emitted.filter((e) => e.event === "ride:offer");
    expect(offerEvents.length).toBeGreaterThan(0);
    expect(offerEvents[offerEvents.length - 1].room).toBe("user:fb-d2");
  });

  it("does NOT re-offer when the ride stopped searching in the meantime", async () => {
    const { io, emitted } = makeIo();
    db.query.mockResolvedValueOnce([
      { id: "offer-1", ride_id: "ride-1", driver_id: "driver-1", round: 1 },
    ]);
    // The ride was accepted by somebody else while this offer sat pending.
    db.queryOne.mockImplementationOnce(async () => ({ status: "accepted" }));

    const n = await expireOffers(io);

    // It is still expired (so the driver's countdown is taken away) but no new
    // offer goes out to anybody.
    expect(n).toBe(1);
    expect(emitted.filter((e) => e.event === "ride:offer")).toHaveLength(0);
  });

  it("never offers the same ride to the same driver twice", async () => {
    // Round 2 must exclude driver-1. The candidate SQL guards this with
    // `NOT EXISTS (SELECT 1 FROM ride_offers ...)`, so assert that guard is really
    // present in the query dispatch issues -- if dropped, every decline would
    // bounce straight back to the driver who just declined.
    const { io } = makeIo();
    db.query.mockResolvedValue([]);
    await offerToNextDriver(io, "ride-1");

    const candidateSql = String(db.query.mock.calls[0][0]);
    expect(candidateSql).toContain("NOT EXISTS");
    expect(candidateSql).toContain("ride_offers");
  });

  it("treats a decline as a reason to move on, and records the reason", async () => {
    db.query.mockResolvedValueOnce([]); // no further candidates
    const { io } = makeIo();

    const res = await declineOffer(io, { rideId: "ride-1", driverId: "driver-1", reason: "too_far" });

    expect(res.ok).toBe(true);
    const declined = db.execute.mock.calls.find((c: any[]) =>
      String(c[0]).includes("UPDATE ride_offers") && String(c[0]).includes("declined")
    );
    expect(declined).toBeDefined();
    expect(declined![1]).toEqual(["ride-1", "driver-1", "too_far"]);
  });
});

describe("5. no drivers -> the rider is told", () => {
  it("parks the ride and emits ride:no:drivers to the rider", async () => {
    const { io, emitted } = makeIo();
    db.query.mockResolvedValueOnce([]); // zero candidates

    const res = await offerToNextDriver(io, "ride-1");

    expect(res.offered).toBe(false);
    expect(res.reason).toBe("no_candidates");

    // The ride must be parked, not left 'searching' forever.
    const parked = db.execute.mock.calls.find((c: any[]) =>
      String(c[0]).includes("SET status = 'no_drivers'")
    );
    expect(parked).toBeDefined();

    // And the rider must actually be told -- never a silent failure. emitRide
    // fans out to BOTH the ride room and the rider's personal room, so assert the
    // personal room is among them rather than assuming it is first.
    const noDrivers = emitted.filter((e) => e.event === "ride:no:drivers");
    expect(noDrivers.length).toBeGreaterThan(0);
    expect(noDrivers.map((e) => e.room)).toContain("user:fb-rider");

    expect(rideEvents("no_drivers").length).toBeGreaterThan(0);
  });

  it("pushes 'no drivers available' to the rider", async () => {
    const { io } = makeIo();
    db.query.mockResolvedValueOnce([]);
    await offerToNextDriver(io, "ride-1");

    await vi.waitFor(() => expect(notify.sendPushToUsers).toHaveBeenCalled());
    const [ids, msg] = notify.sendPushToUsers.mock.calls[0] as any[];
    expect(ids).toEqual(["rider-1"]);
    expect(msg.type).toBe("no_drivers");
  });

  it("stops after MAX_OFFER_ROUNDS instead of churning forever", async () => {
    const { io, emitted } = makeIo();
    mockRide({ offer_round: 12 }); // already exhausted

    const res = await offerToNextDriver(io, "ride-1");

    expect(res.offered).toBe(false);
    expect(res.reason).toBe("too_many_rounds");
    expect(rideEvents("dispatch_exhausted").length).toBeGreaterThan(0);
    expect(emitted.some((e) => e.event === "ride:no:drivers")).toBe(true);
  });

  it("markNoDrivers expires any offers still pending", async () => {
    const { io } = makeIo();
    await markNoDrivers(io, "ride-1");

    // Pending offers must be closed, or those drivers keep a live countdown for a
    // ride the rider has been told nobody can take.
    const closed = db.execute.mock.calls.find((c: any[]) =>
      String(c[0]).includes("UPDATE ride_offers") &&
      String(c[0]).includes("expired") &&
      String(c[0]).includes("no_drivers")
    );
    expect(closed).toBeDefined();
  });

  it("a parked ride can be revived when a driver comes back online", async () => {
    const { io } = makeIo();
    mockRide({ status: "no_drivers" });
    db.query.mockResolvedValueOnce([{ ...DRIVER_NEAR, id: "driver-9", firebase_uid: "fb-d9" }]);
    db.queryOne
      .mockImplementationOnce(async () => ({ ...RIDE, status: "no_drivers" }))
      .mockImplementationOnce(async () => ({ id: "offer-9", expires_at: "2026-01-01T00:00:15Z" }));

    // A rider must not wait forever merely because nobody was free at the moment
    // they booked.
    const res = await offerToNextDriver(io, "ride-1", 1, { revive: true });
    expect(res.offered).toBe(true);
    expect(res.driverId).toBe("driver-9");
  });

  it("does NOT re-offer a parked ride without an explicit revive", async () => {
    const { io } = makeIo();
    mockRide({ status: "no_drivers" });

    const res = await offerToNextDriver(io, "ride-1");
    expect(res.offered).toBe(false);
    expect(res.reason).toBe("ride_parked_no_drivers");
  });
});
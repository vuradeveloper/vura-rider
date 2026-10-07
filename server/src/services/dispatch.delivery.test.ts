// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DISPATCH: matching + delivery.
// Scenarios 1-3 of the dispatch spec: booking triggers dispatch, the offer goes
// out over WebSocket, and push still fires as the fallback when the socket is
// down. See testHarness.ts for why the database is mocked.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  db, notify, makeIo, mockRide, queueOffer, traceStage, resetHarness, DRIVER_NEAR, RIDE,
} from "./testHarness";

// Async factories: evaluated after hoisting, so the module instance (and
// therefore the SAME vi.fn() objects the test file holds) is returned.
vi.mock("../config/database", async () => (await import("./testHarness")).db);
vi.mock("./notify", async () => (await import("./testHarness")).notify);
vi.mock("./vehicleImages", async () => (await import("./testHarness")).vehicleImages);
// Flag-OFF config so getConfig() neither consumes the queryOne Once-queue nor
// flips these legacy scenarios onto the Module 1 H3 path.
vi.mock("./config", async () => (await import("./testHarness")).appConfig);

import { offerToNextDriver } from "./dispatch";
import { getCounters } from "./metrics";

beforeEach(() => {
  resetHarness();
  mockRide();
});

describe("1. booking a ride triggers dispatch", () => {
  it("creates a 15s pending offer for the closest candidate", async () => {
    const { io } = makeIo();
    queueOffer();

    const res = await offerToNextDriver(io, "ride-1");

    expect(res.offered).toBe(true);
    expect(res.driverId).toBe("driver-1");

    // Must actually be persisted with a 15s window, or it is not really offered.
    const insertCall = db.queryOne.mock.calls.find((c: any[]) =>
      String(c[0]).includes("INSERT INTO ride_offers")
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual(["ride-1", "driver-1", 15, 1]);
  });

  it("traces the booking stages so latency is measurable", async () => {
    const { io } = makeIo();
    queueOffer();
    await offerToNextDriver(io, "ride-1");

    expect(traceStage("drivers_found").length).toBeGreaterThan(0);
    expect(traceStage("offer_sent").length).toBeGreaterThan(0);

    // drivers_found carries the COUNT: 0 is the key diagnostic that separates
    // "driver was invisible to dispatch" from "the offer never arrived".
    expect(traceStage("drivers_found")[0].count).toBe(1);
  });

  it("does NOT offer, and does NOT blame the rider, when pickup has no coords", async () => {
    const { io, emitted } = makeIo();
    mockRide({ pickup_lat: null, pickup_lng: null });

    const res = await offerToNextDriver(io, "ride-1");

    expect(res.offered).toBe(false);
    expect(res.reason).toBe("ride_has_no_pickup_coords");
    // Must NOT say "no drivers" -- a different failure, and it would send the
    // rider off to retry a ride that was never dispatchable.
    expect(emitted.some((e) => e.event === "ride:no:drivers")).toBe(false);
  });

  it("refuses to offer a ride that is already accepted", async () => {
    const { io } = makeIo();
    mockRide({ status: "accepted" });
    const res = await offerToNextDriver(io, "ride-1");
    expect(res.offered).toBe(false);
    expect(res.reason).toBe("ride_is_accepted");
  });
});

describe("2. the offer is delivered over WebSocket", () => {
  it("emits ride:offer and ride:request to that driver's room only", async () => {
    const { io, emitted } = makeIo();
    queueOffer();

    await offerToNextDriver(io, "ride-1");

    expect(emitted.map((e) => e.event)).toEqual(
      expect.arrayContaining(["ride:offer", "ride:request"]),
    );

    // Targeted delivery: one emission to the driver's own room, never a broadcast
    // room -- broadcasting is what caused nationwide offer races.
    const offerEvents = emitted.filter((e) => e.event === "ride:offer");
    expect(offerEvents).toHaveLength(1);
    expect(offerEvents[0].room).toBe("user:fb-d1");

    // The payload must carry everything the countdown screen renders.
    const p = offerEvents[0].payload;
describe("3. push is the fallback when the socket is down", () => {
  it("sends a high-priority push when the driver has no live socket", async () => {
    const { io } = makeIo();
    // firebase_uid null => the socket emit is skipped entirely, so push is the
    // ONLY way this offer can reach the driver.
    queueOffer([{ ...DRIVER_NEAR, firebase_uid: null }]);

    const res = await offerToNextDriver(io, "ride-1");
    expect(res.offered).toBe(true);

    await vi.waitFor(() => expect(notify.sendPushToUsers).toHaveBeenCalled());
    const [driverIds, msg] = notify.sendPushToUsers.mock.calls[0] as any[];
    expect(driverIds).toEqual(["driver-1"]);
    expect(msg.highPriority).toBe(true);
    expect(msg.type).toBe("ride_offer");
    expect(msg.rideId).toBe("ride-1");
  });

  it("marks the channel push_only in the trace when there is no socket", async () => {
    const { io } = makeIo();
    queueOffer([{ ...DRIVER_NEAR, firebase_uid: null }]);
    await offerToNextDriver(io, "ride-1");

    const detail = traceStage("offer_sent")[0];
    expect(detail.channel).toBe("push_only");
  });

  it("still pushes when the socket IS available (belt and braces)", async () => {
    const { io } = makeIo();
    queueOffer();
    await offerToNextDriver(io, "ride-1");

    await vi.waitFor(() => expect(notify.sendPushToUsers).toHaveBeenCalled());
    expect((notify.sendPushToUsers.mock.calls[0] as any)[1].highPriority).toBe(true);
  });

  it("records push delivery instead of swallowing delivered=0", async () => {
    // The exact failure that made rides "never arrive": push.ts only accepts
    // ExponentPushToken[], a Capacitor APK cannot mint one, it returned 0, and
    // `.catch(() => 0)` threw that away.
    notify.sendPushToUsers.mockResolvedValue(0);
    const { io } = makeIo();
    queueOffer([{ ...DRIVER_NEAR, firebase_uid: null }]);

    await offerToNextDriver(io, "ride-1");

    await vi.waitFor(() => expect(traceStage("push_result").length).toBeGreaterThan(0));
    const detail = traceStage("push_result")[0];
    expect(detail.delivered).toBe(0);
    expect(detail.ok).toBe(false);
  });

  it("records a push failure instead of letting it vanish", async () => {
    notify.sendPushToUsers.mockRejectedValue(new Error("network down"));
    const { io } = makeIo();
    queueOffer([{ ...DRIVER_NEAR, firebase_uid: null }]);

    // The rejection must NOT escape as an unhandled rejection: the ride WAS
    // offered, only the fallback push failed.
    await expect(offerToNextDriver(io, "ride-1")).resolves.toMatchObject({ offered: true });

    await vi.waitFor(() => expect(traceStage("push_result").length).toBeGreaterThan(0));
    const detail = traceStage("push_result")[0];
    expect(detail.ok).toBe(false);
    expect(String(detail.error)).toContain("network down");
  });
});
    expect(p.secondsRemaining).toBe(15);
    expect(p.fare).toBe(120);
    expect(p.pickupAddress).toBe("Sandton");
    expect(p.destinationAddress).toBe("Rosebank");
    expect(p.id).toBe("ride-1");
  });

  it("records the delivery channel in the trace", async () => {
    const { io } = makeIo();
    queueOffer();
    await offerToNextDriver(io, "ride-1");

    const detail = traceStage("offer_sent")[0];
    expect(detail.channel).toBe("socket");
    expect(detail.driver_id).toBe("driver-1");
  });
});

describe("4. delivery hardening: truthful channel + instant skip", () => {
  it("records socket_connected=true only when the room really has a socket", async () => {
    const { io } = makeIo(); // default: all rooms connected
    queueOffer();

    await offerToNextDriver(io, "ride-1");

    const d = traceStage("offer_sent")[0];
    expect(d.socket_connected).toBe(true);
    expect(d.channel).toBe("socket");
    expect(getCounters().offer_socket_down).toBe(0);
  });

  it("a uid with a dead socket is push_only + offer_socket_down, not 'socket'", async () => {
    const { io } = makeIo(false); // nobody connected; driver HAS a firebase_uid
    notify.sendPushToUsers.mockResolvedValue(1); // push reaches a device
    queueOffer();

    const res = await offerToNextDriver(io, "ride-1");

    expect(res.offered).toBe(true);
    const d = traceStage("offer_sent")[0];
    expect(d.socket_connected).toBe(false);
    expect(d.channel).toBe("push_only");
    expect(getCounters().offer_socket_down).toBe(1);
    // The push ANSWERED before the offer was declared (awaited, not fire-and-forget).
    expect(traceStage("push_result")[0]).toMatchObject({ delivered: 1, ok: true });
  });

  it("skips instantly when socket down AND push delivers 0, then offers the next candidate", async () => {
    notify.sendPushToUsers.mockResolvedValueOnce(0).mockResolvedValue(1);
    const { io } = makeIo(false);
    db.query.mockResolvedValueOnce([
      { ...DRIVER_NEAR, firebase_uid: "fb-d1", distance_km: 0.4 },
      { ...DRIVER_NEAR, id: "driver-2", firebase_uid: "fb-d2", distance_km: 0.9 },
    ]);
    db.queryOne
      .mockImplementationOnce(async () => ({ ...RIDE })) // loadRide
      .mockImplementationOnce(async () => ({ id: "offer-1", expires_at: "2026-01-01T00:00:15Z" }))
      .mockImplementationOnce(async () => ({ id: "offer-2", expires_at: "2026-01-01T00:00:15Z" }));

    const res = await offerToNextDriver(io, "ride-1");

    expect(res).toMatchObject({ offered: true, driverId: "driver-2" });
    // driver-1's offer was closed NOW, not left pending for 15 seconds.
    const closed = db.execute.mock.calls.filter(
      (c: any[]) =>
        String(c[0]).includes("UPDATE ride_offers") && String(c[0]).includes("undeliverable")
    );
    expect(closed).toHaveLength(1);
    expect(closed[0][1]).toEqual(["offer-1"]);
    const skipped = traceStage("offer_undeliverable");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]).toMatchObject({
      driver_id: "driver-1",
      socket_connected: false,
      push_delivered: 0,
    });
    const c = getCounters();
    expect(c.offer_undeliverable).toBe(1);
    expect(c.offer_socket_down).toBe(2); // both attempts had an empty room
    expect(c.push_delivered_zero).toBe(1);
    // driver-2's offer DID go out.
    const sent = traceStage("offer_sent");
    expect(sent[sent.length - 1]).toMatchObject({ driver_id: "driver-2", socket_connected: false });
  });

  it("does NOT skip on an UNKNOWN push outcome (send rejected)", async () => {
    notify.sendPushToUsers.mockRejectedValue(new Error("network down"));
    const { io } = makeIo(false);
    queueOffer();

    // Unknown != delivered:0 — the offer keeps its 15s window.
    const res = await offerToNextDriver(io, "ride-1");
    expect(res).toMatchObject({ offered: true, driverId: "driver-1" });
    expect(traceStage("offer_undeliverable")).toHaveLength(0);
  });

  it("does NOT skip when notify itself answers UNKNOWN (resolved null)", async () => {
    // notify returns null when a lookup/transport failed — an unproven result
    // must never be coerced into the skip-eligible 0.
    notify.sendPushToUsers.mockResolvedValueOnce(null);
    const { io } = makeIo(false);
    queueOffer();

    const res = await offerToNextDriver(io, "ride-1");
    expect(res).toMatchObject({ offered: true, driverId: "driver-1" });
    expect(traceStage("offer_undeliverable")).toHaveLength(0);
    expect(traceStage("push_result_unknown")).toHaveLength(1);
    expect(traceStage("push_result_unknown")[0]).toMatchObject({
      driver_id: "driver-1",
      socket_connected: false,
    });
    // The offer was NOT closed early.
    const closed = db.execute.mock.calls.filter(
      (c: any[]) =>
        String(c[0]).includes("UPDATE ride_offers") && String(c[0]).includes("undeliverable")
    );
    expect(closed).toHaveLength(0);
  });

  it("when nobody is reachable the ride reports offer_undeliverable instead of hanging", async () => {
    notify.sendPushToUsers.mockResolvedValue(0);
    const { io } = makeIo(false);
    db.query.mockResolvedValueOnce([{ ...DRIVER_NEAR, firebase_uid: "fb-d1" }]);
    db.queryOne
      .mockImplementationOnce(async () => ({ ...RIDE }))
      .mockImplementationOnce(async () => ({ id: "offer-1", expires_at: "2026-01-01T00:00:15Z" }));

    const res = await offerToNextDriver(io, "ride-1");

    expect(res).toMatchObject({ offered: false, reason: "offer_undeliverable" });
    expect(traceStage("offer_undeliverable")).toHaveLength(1);
    expect(getCounters().offer_undeliverable).toBe(1);
    // The advance decision ran (status read). mockRide answers null for this
    // query shape, so no recursion happens inside the test.
    const adv = db.queryOne.mock.calls.find((c: any[]) =>
      String(c[0]).includes("SELECT status FROM rides")
    );
    expect(adv).toBeDefined();
  });
});
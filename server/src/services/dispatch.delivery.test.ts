// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// DISPATCH: matching + delivery.
// Scenarios 1-3 of the dispatch spec: booking triggers dispatch, the offer goes
// out over WebSocket, and push still fires as the fallback when the socket is
// down. See testHarness.ts for why the database is mocked.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  db, notify, makeIo, mockRide, queueOffer, traceStage, resetHarness, DRIVER_NEAR,
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
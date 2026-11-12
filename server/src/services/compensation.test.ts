import { describe, expect, it } from "vitest";
import {
  cancellationDecision,
  stopFeeRands,
  tripExtras,
  waitingFeeRands,
  type CompensationConfig,
} from "./compensation";

const cfg: CompensationConfig = {
  waitFreeSeconds: 120,
  waitPerMinuteRands: 1.5,
  waitCapRands: 30,
  stopFeeRands: 2.5,
  cancelFeeRands: 15,
  cancelGraceMinutes: 2,
  driverCancelCompRands: 10,
};

describe("waiting compensation", () => {
  it("is free inside the grace window", () => {
    expect(waitingFeeRands(0, cfg)).toBe(0);
    expect(waitingFeeRands(119, cfg)).toBe(0);
    expect(waitingFeeRands(120, cfg)).toBe(0);
  });

  it("bills the first started 30 seconds after the free window", () => {
    // 121 s → 1 chargeable second → one 30 s block → half a minute → R0.75
    expect(waitingFeeRands(121, cfg)).toBe(0.75);
    expect(waitingFeeRands(150, cfg)).toBe(0.75);
    expect(waitingFeeRands(151, cfg)).toBe(1.5);
  });

  it("rounds up so the driver is never under-paid", () => {
    // 210 s → 90 chargeable → three 30 s blocks → 1.5 min → R2.25
    expect(waitingFeeRands(210, cfg)).toBe(2.25);
  });

  it("caps at the configured maximum", () => {
    expect(waitingFeeRands(60 * 60, cfg)).toBe(30);
  });

  it("treats bad input as zero", () => {
    expect(waitingFeeRands(Number.NaN, cfg)).toBe(0);
    expect(waitingFeeRands(-50, cfg)).toBe(0);
  });
});

describe("stop compensation", () => {
  it("includes the first stop", () => {
    expect(stopFeeRands(0, cfg)).toBe(0);
    expect(stopFeeRands(1, cfg)).toBe(0);
  });

  it("charges each extra stop", () => {
    expect(stopFeeRands(2, cfg)).toBe(2.5);
    expect(stopFeeRands(4, cfg)).toBe(7.5);
  });
});

describe("cancellation compensation", () => {
  const now = Date.UTC(2026, 10, 12, 22, 0, 0);

  it("charges nothing before a driver is matched", () => {
    expect(cancellationDecision("searching", now - 10 * 60000, now, cfg).feeRands).toBe(0);
    expect(cancellationDecision("scheduled", now - 10 * 60000, now, cfg).feeRands).toBe(0);
  });

  it("charges nothing inside the grace window", () => {
    expect(cancellationDecision("accepted", now - 60000, now, cfg).feeRands).toBe(0);
    expect(cancellationDecision("driver_arrived", now - 2 * 60000, now, cfg).feeRands).toBe(0);
  });

  it("charges the late fee and pays the driver their share", () => {
    const d = cancellationDecision("accepted", now - 5 * 60000, now, cfg);
    expect(d.feeRands).toBe(15);
    expect(d.driverCompRands).toBe(10);
    expect(d.reason).toMatch(/cancelled/i);
  });

  it("never pays more than the fee", () => {
    const lean = { ...cfg, cancelFeeRands: 5, driverCancelCompRands: 10 };
    expect(cancellationDecision("accepted", now - 5 * 60000, now, lean).driverCompRands).toBe(5);
  });
});

describe("trip extras", () => {
  const arrived = Date.UTC(2026, 10, 12, 21, 0, 0);

  it("is zero when the driver never waited", () => {
    expect(tripExtras(null, null, 0, cfg).totalRands).toBe(0);
  });

  it("adds waiting and extra stops", () => {
    const started = arrived + 5 * 60000; // 5 min wait → 3 min chargeable → R4.50
    const e = tripExtras(arrived, started, 3, cfg);
    expect(e.waitFeeRands).toBe(4.5);
    expect(e.stopFeeRands).toBe(5);
    expect(e.totalRands).toBe(9.5);
  });

  it("ignores a start time before the arrival", () => {
    expect(tripExtras(arrived, arrived - 60000, 1, cfg).totalRands).toBe(0);
  });
});

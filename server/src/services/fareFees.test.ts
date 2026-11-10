// ─────────────────────────────────────────────────────────────────────────────
// OPTION A MONEY RULES — 10% capped at R5 + 4% rider-paid booking fee.
//
// These tests are the contract the Paystack split relies on. If any number
// here changes, the dynamic flat split and the driver's wallet must change
// together, or the driver is paid the wrong amount.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import {
  DEFAULT_BOOKING_FEE_PCT,
  bookingFeeCentsFor,
  bookingFeePct,
  platformShareCents,
  rideFareBreakdown,
} from "./fareFees";
import { DEFAULT_WALLET_CONFIG } from "./walletService";

describe("booking fee — 4% paid by the rider on top of the fare", () => {
  it("defaults to 4%", () => {
    expect(DEFAULT_BOOKING_FEE_PCT).toBe(4);
    expect(bookingFeePct()).toBe(4);
  });

  it("rounds to the nearest cent", () => {
    expect(bookingFeeCentsFor(500)).toBe(20); // R5 -> R0.20
    expect(bookingFeeCentsFor(10000)).toBe(400); // R100 -> R4.00
    expect(bookingFeeCentsFor(1234)).toBe(49); // R12.34 -> R0.49
    expect(bookingFeeCentsFor(0)).toBe(0);
  });

  it("can be configured, but only inside a sane range", () => {
    const before = process.env.BOOKING_FEE_PCT;
    try {
      process.env.BOOKING_FEE_PCT = "5";
      expect(bookingFeePct()).toBe(5);
      expect(bookingFeeCentsFor(10000, bookingFeePct())).toBe(500);
      process.env.BOOKING_FEE_PCT = "400";
      expect(bookingFeePct()).toBe(4); // rejected, falls back to 4%
    } finally {
      if (before == null) delete process.env.BOOKING_FEE_PCT;
      else process.env.BOOKING_FEE_PCT = before;
    }
  });
});

describe("rideFareBreakdown — Option A, commission capped at R5", () => {
  const cfg = DEFAULT_WALLET_CONFIG;

  it("R20: R2 commission + R0.80 fee, driver R18, rider R20.80", () => {
    const b = rideFareBreakdown(20, cfg);
    expect(b.fare_cents).toBe(2000);
    expect(b.commission_cents).toBe(200);
    expect(b.booking_fee_cents).toBe(80);
    expect(b.platform_cents).toBe(280);
    expect(b.driver_net_cents).toBe(1800);
    expect(b.rider_total_cents).toBe(2080);
  });

  it("R50: R5 commission (the cap) + R2 fee, driver R45, rider R52", () => {
    const b = rideFareBreakdown(50, cfg);
    expect(b.commission_cents).toBe(500);
    expect(b.booking_fee_cents).toBe(200);
    expect(b.platform_cents).toBe(700);
    expect(b.driver_net_cents).toBe(4500);
    expect(b.rider_total_cents).toBe(5200);
  });

  it("R100: R5 commission (not R10) + R4 fee, driver R95, rider R104", () => {
    const b = rideFareBreakdown(100, cfg);
    expect(b.commission_cents).toBe(500);
    expect(b.booking_fee_cents).toBe(400);
    expect(b.platform_cents).toBe(900);
    expect(b.driver_net_cents).toBe(9500);
    expect(b.rider_total_cents).toBe(10400);
  });

  it("R1000: still only R5 commission + R40 fee, driver R995, rider R1040", () => {
    const b = rideFareBreakdown(1000, cfg);
    expect(b.commission_cents).toBe(500);
    expect(b.booking_fee_cents).toBe(4000);
    expect(b.platform_cents).toBe(4500);
    expect(b.driver_net_cents).toBe(99500);
    expect(b.rider_total_cents).toBe(104000);
  });

  it("never takes more than R5 commission at any fare", () => {
    for (const fare of [1, 5, 10, 20, 50, 51, 100, 250, 1000, 10000]) {
      const b = rideFareBreakdown(fare, cfg);
      expect(b.commission_cents).toBeLessThanOrEqual(500);
      // The driver always keeps the fare minus the capped commission.
      expect(b.driver_net_cents).toBe(b.fare_cents - b.commission_cents);
      // Vura always gets exactly commission + booking fee.
      expect(b.platform_cents).toBe(b.commission_cents + b.booking_fee_cents);
      // The rider always pays exactly fare + fee.
      expect(b.rider_total_cents).toBe(b.fare_cents + b.booking_fee_cents);
    }
  });

  it("exposes the platform share the Paystack flat split must send", () => {
    expect(platformShareCents(5, cfg)).toBe(70); // 50c commission + 20c fee
    expect(platformShareCents(100, cfg)).toBe(900); // 500c + 400c
  });
});

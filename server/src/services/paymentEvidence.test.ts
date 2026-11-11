import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  queryOne: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(async () => ({ rowCount: 1, rows: [] })),
}));
vi.mock("../config/database", () => db);

import { buildPaymentEvidence } from "./paymentEvidence";

beforeEach(() => {
  db.queryOne.mockReset();
  db.query.mockReset();
  db.queryOne.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM payments p")) {
      return {
        reference: "VURA100",
        amount: "104.00",
        currency: "ZAR",
        status: "completed",
        provider: "paystack",
        ride_id: "ride-1",
        created_at: "2026-11-11T09:00:00Z",
        updated_at: "2026-11-11T09:20:00Z",
        raw_response: {
          gateway_response: "Successful",
          channel: "card",
          fees: 250,
          ip_address: "41.13.1.9",
          authorization: {
            brand: "visa",
            bin: "408408",
            last4: "4081",
            exp_month: 12,
            exp_year: 2030,
            reusable: true,
          },
        },
        rider_id: "rider-1",
        rider_name: "Thabo Rider",
        rider_email: "thabo@example.com",
        rider_phone: "+27821234567",
        rider_created_at: "2026-01-01T00:00:00Z",
      };
    }
    if (sql.includes("FROM rides r")) {
      return {
        id: "ride-1",
        status: "completed",
        pickup_address: "Sandton City",
        destination_address: "OR Tambo",
        distance_km: "26.4",
        duration_mins: "38",
        estimated_fare: "100.00",
        actual_fare: "100.00",
        payment_status: "PAID",
        payment_method: "card",
        created_at: "2026-11-11T09:00:00Z",
        accepted_at: "2026-11-11T09:03:00Z",
        completed_at: "2026-11-11T09:41:00Z",
        cancelled_at: null,
        preauth_reference: "HOLD_123",
        captured_amount: "100.00",
        card_auth_code: "AUTH_abc",
        promo_code: "WELCOME10",
        promo_discount: "10.00",
        driver_id: "driver-1",
        driver_name: "Sipho Driver",
        driver_phone: "+27835551234",
        license_plate: "GP 123 GP",
      };
    }
    if (sql.includes("FROM saved_cards")) {
      return {
        card_type: "visa",
        last4: "4081",
        bank: "FNB",
        exp_month: 12,
        exp_year: 2030,
        signature: "SIG_abc",
      };
    }
    return null;
  });
  db.query.mockResolvedValue([
    {
      event: "preauthorization.capture.success",
      received_at: "2026-11-11T09:41:05Z",
      reference: "HOLD_123",
      amount: "10000",
      status: "success",
    },
  ]);
});

describe("buildPaymentEvidence", () => {
  it("builds a factual chargeback pack with the fare split and card fingerprint", async () => {
    const evidence = await buildPaymentEvidence("VURA100");
    expect(evidence).not.toBeNull();
    expect(evidence!.payment).toMatchObject({
      reference: "VURA100",
      amount: 104,
      status: "completed",
    });
    expect(evidence!.rider).toMatchObject({
      id: "rider-1",
      name: "Thabo Rider",
      email: "th***@example.com",
    });
    expect(evidence!.rider!.phone).toContain("***");
    expect(evidence!.fare).toMatchObject({
      fare_cents: 10000,
      booking_fee_cents: 400,
      rider_total_cents: 10400,
      commission_cents: 500,
      driver_net_cents: 9500,
    });
    expect(evidence!.card).toMatchObject({ last4: "4081", fingerprint: "SIG_abc" });
    expect(evidence!.timeline[0].event).toBe("preauthorization.capture.success");
    expect(evidence!.summary.join(" ")).toContain("rider total R104.00");
    expect(evidence!.summary.join(" ")).toContain("Driver Sipho Driver");
    expect(evidence!.summary.join(" ")).toContain("Card visa ending 4081");
  });

  it("returns null when the reference is unknown", async () => {
    db.queryOne.mockResolvedValue(null);
    expect(await buildPaymentEvidence("NOPE")).toBeNull();
    expect(await buildPaymentEvidence("")).toBeNull();
  });
});

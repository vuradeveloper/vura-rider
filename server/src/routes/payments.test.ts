import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

const db = vi.hoisted(() => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(),
  execute: vi.fn(async () => ({ rowCount: 1, rows: [] })),
}));
const paystack = vi.hoisted(() => ({
  paymentsMode: vi.fn(() => "mock"),
  initializeTransaction: vi.fn(async () => ({ reference: "VURA1", authorizationUrl: "https://pay.test/1", live: false })),
  verifyTransaction: vi.fn(async () => null),
  chargeAuthorization: vi.fn(async () => ({ success: true, status: "success" })),
  refundTransaction: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../config/database", () => db);
vi.mock("../services/paystackPayment", () => paystack);
vi.mock("../routes/payouts", () => ({ ensurePayoutsTable: vi.fn(async () => undefined) }));
vi.mock("../middleware/auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "firebase-1";
    next();
  },
}));

import paymentsRouter from "./payments";

const RIDE = "11111111-1111-4111-8111-111111111111";
let server: any;
let base = "";

function mockRide(overrides: Record<string, unknown> = {}) {
  return {
    passenger_id: "user-1",
    estimated_fare: "100.00",
    actual_fare: null,
    status: "searching",
    payment_status: "NONE",
    ...overrides,
  };
}

beforeEach(async () => {
  paystack.paymentsMode.mockReturnValue("mock");
  db.query.mockReset();
  db.query.mockResolvedValue([]);
  db.queryOne.mockReset();
  db.execute.mockClear();

  const app = express();
  app.use(express.json());
  app.use("/api/payments", paymentsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterEach(() => server?.close());

const auth = { Authorization: "Bearer t", "Content-Type": "application/json" };

describe("ride payment authority", () => {
  it("refuses to charge a ride that belongs to another rider", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users WHERE firebase_uid")) {
        return { id: "user-1", full_name: "Rider", email: "r@example.com", phone: "082" };
      }
      if (sql.includes("COUNT(*)::int")) return { n: 0 };
      if (sql.includes("FROM rides WHERE id")) return mockRide({ passenger_id: "user-2" });
      return null;
    });

    const res = await fetch(`${base}/api/payments/initiate`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ rideId: RIDE, amountRands: 100 }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "not_ride_owner" });
    expect(paystack.chargeAuthorization).not.toHaveBeenCalled();
  });

  it("uses the server-side fare when the client sends a different amount", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users WHERE firebase_uid")) {
        return { id: "user-1", full_name: "Rider", email: "r@example.com", phone: "082" };
      }
      if (sql.includes("COUNT(*)::int")) return { n: 0 };
      if (sql.includes("FROM rides WHERE id")) return mockRide({ estimated_fare: "87.50" });
      if (sql.includes("payment_status FROM rides")) return { payment_status: "NONE" };
      if (sql.includes("FROM saved_cards")) return null;
      return null;
    });

    const res = await fetch(`${base}/api/payments/initiate`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ rideId: RIDE, amountRands: 0.2 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.amount).toBe(87.5);
    expect(body.amount_corrected).toBe(true);
  });

  it("pauses charges after five failed ride payments in an hour", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users WHERE firebase_uid")) {
        return { id: "user-1", full_name: "Rider", email: "r@example.com", phone: "082" };
      }
      if (sql.includes("COUNT(*)::int")) return { n: 5 };
      return null;
    });

    const res = await fetch(`${base}/api/payments/initiate`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ rideId: RIDE, amountRands: 100 }),
    });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: "charge_attempts_limited" });
  });

  it("refuses a cancelled trip", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users WHERE firebase_uid")) {
        return { id: "user-1", full_name: "Rider", email: "r@example.com", phone: "082" };
      }
      if (sql.includes("COUNT(*)::int")) return { n: 0 };
      if (sql.includes("FROM rides WHERE id")) return mockRide({ status: "cancelled" });
      return null;
    });
    const res = await fetch(`${base}/api/payments/initiate`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ rideId: RIDE, amountRands: 100 }),
    });
    expect(res.status).toBe(409);
  });
});

describe("payment protection", () => {
  it("no longer lets a rider self-refund a completed payment", async () => {
    const res = await fetch(`${base}/api/payments/refund`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ rideId: RIDE }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "refund_requires_support" });
    expect(paystack.refundTransaction).not.toHaveBeenCalled();
  });

  it("verify only reveals the caller's own payment", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users WHERE firebase_uid")) {
        return { id: "user-1", full_name: "Rider", email: "r@example.com", phone: "082" };
      }
      if (sql.includes("SELECT user_id, status")) {
        return { user_id: "user-2", status: "completed", authorization_url: null, ride_id: null };
      }
      return null;
    });
    const res = await fetch(`${base}/api/payments/verify?reference=VURA1`, { headers: auth });
    expect(res.status).toBe(404);
  });
});

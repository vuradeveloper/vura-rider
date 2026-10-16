// ─────────────────────────────────────────────────────────────────────────────
// /api/paystack/webhook — signature gate + idempotency contract.
//
// Mounted exactly like index.ts (express.raw BEFORE the router) so the HMAC is
// computed over the true bytes. The database module is stubbed: these tests
// pin the SECURITY and the state-machine guards, not SQL execution.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac } from "crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";

vi.mock("../config/database", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  execute: vi.fn(async () => ({ rowCount: 1 })),
}));

import { queryOne, execute } from "../config/database";
import paystackWebhookRouter from "./paystackWebhook";

const SECRET = "whsec_webhook_test";
let server: Server;
let base: string;
let savedEnv: NodeJS.ProcessEnv;

// Mutable "DB" state the stubs answer from.
let ride: {
  id: string;
  passenger_id: string | null;
  payment_status: string | null;
} = { id: "ride-1", passenger_id: "user-1", payment_status: "CAPTURE_PENDING" };
const seenKeys = new Set<string>();
const counters: Record<string, number> = {};

function bump(k: string) {
  counters[k] = (counters[k] || 0) + 1;
}

function sign(raw: string): string {
  return createHmac("sha512", SECRET).update(Buffer.from(raw, "utf8")).digest("hex");
}

async function post(raw: string, signature?: string): Promise<Response> {
  return fetch(`${base}/api/paystack/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature !== undefined ? { "x-paystack-signature": signature } : {}),
    },
    body: raw,
  });
}

beforeEach(async () => {
  savedEnv = { ...process.env };
  process.env.PAYSTACK_SECRET_KEY = SECRET;
  process.env.PAYMENTS_MODE = "mock";
  ride = { id: "ride-1", passenger_id: "user-1", payment_status: "CAPTURE_PENDING" };
  seenKeys.clear();
  for (const k of Object.keys(counters)) delete counters[k];

  vi.mocked(queryOne).mockImplementation(async (sql: any) => {
    const s = String(sql);
    if (s.includes("FROM rides WHERE preauth_reference")) return { ...ride } as any;
    if (s.includes("SELECT payment_status FROM rides"))
      return { payment_status: ride.payment_status } as any;
    if (s.includes("COUNT(*)::int AS n FROM saved_cards")) return { n: 0 } as any;
    if (s.includes("FROM saved_cards")) return null as any;
    return null as any;
  });

  vi.mocked(execute).mockImplementation(async (sql: any, params?: any) => {
    const s = String(sql);
    if (s.includes("ON CONFLICT (event_key)")) {
      const key = String(params?.[0]);
      if (seenKeys.has(key)) return { rowCount: 0 };
      seenKeys.add(key);
      bump("events");
      return { rowCount: 1 };
    }
    if (s.includes("SET payment_status = 'PAID'")) {
      // The guarded UPDATE: only fires while the ride is CAPTURE_PENDING.
      if (ride.payment_status !== "CAPTURE_PENDING") return { rowCount: 0 };
      bump("paid");
      return { rowCount: 1 };
    }
    if (s.includes("SET payment_status = 'PAYMENT_FAILED'")) {
      if (ride.payment_status !== "CAPTURE_PENDING") return { rowCount: 0 };
      bump("failed");
      return { rowCount: 1 };
    }
    if (s.includes("SET payment_status = 'HOLD_ACTIVE'")) {
      if (ride.payment_status !== "HOLD_PENDING") return { rowCount: 0 };
      bump("hold_active");
      return { rowCount: 1 };
    }
    if (s.includes("INSERT INTO saved_cards")) {
      bump("card_saved");
      return { rowCount: 1 };
    }
    if (s.includes("INSERT INTO payments")) {
      bump("ledger");
      return { rowCount: 1 };
    }
    return { rowCount: 1 }; // schema ensure (ALTER/CREATE) and the rest
  });

  const app = express();
  app.use(
    "/api/paystack/webhook",
    express.raw({ type: "application/json", limit: "1mb" })
  );
  app.use("/api/paystack", paystackWebhookRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  process.env = savedEnv;
  vi.clearAllMocks();
});

describe("POST /api/paystack/webhook", () => {
  const captureSuccess = JSON.stringify({
    event: "preauthorization.capture.success",
    data: {
      id: 3099,
      reference: "atyntuup5bec03e",
      status: "captured",
      captured_amount: "1000",
      amount: 1000,
      currency: "ZAR",
      authorization: { authorization_code: "AUTH_ove5p6reju", reusable: true },
      transaction: { id: "1504264401", status: "success", channel: "preauth" },
    },
  });

  it("rejects a bad x-paystack-signature with 401 and touches NOTHING", async () => {
    const res = await post(captureSuccess, "deadbeef".repeat(16));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toContain("invalid signature");
    expect(execute).not.toHaveBeenCalled(); // signature fails before any DB work
  });

  it("rejects a missing signature header with 401", async () => {
    const res = await post(captureSuccess);
    expect(res.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("capture.success with a VALID signature → 200, PAID + ledger row", async () => {
    const res = await post(captureSuccess, sign(captureSuccess));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ received: true, handled: true, duplicate: false });
    expect(counters.paid).toBe(1);
    expect(counters.ledger).toBe(1);
  });

  it("replaying the SAME event is a 200 duplicate with NO second transition", async () => {
    const first = await post(captureSuccess, sign(captureSuccess));
    expect(first.status).toBe(200);
    const replay = await post(captureSuccess, sign(captureSuccess));
    expect(replay.status).toBe(200);
    const body = await replay.json();
    expect(body.duplicate).toBe(true);
    expect(counters.paid).toBe(1); // exactly once, ever
    expect(counters.ledger).toBe(1);
  });

  it("capture.failed → PAYMENT_FAILED (guarded, once)", async () => {
    const raw = JSON.stringify({
      event: "preauthorization.capture.failed",
      data: { id: 3100, reference: "atyntuup5bec03e", message: "Declined" },
    });
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(200);
    expect((await res.json()).handled).toBe(true);
    expect(counters.failed).toBe(1);
  });

  it("reserve.success → HOLD_ACTIVE + the reusable authorization_code is saved", async () => {
    ride = { ...ride, payment_status: "HOLD_PENDING" };
    const raw = JSON.stringify({
      event: "preauthorization.reserve.success",
      data: {
        id: 543,
        reference: "pre_9gjnu6dc",
        status: "authorized",
        amount: 1000,
        expiry_date: "2026-10-17T00:00:00.000Z",
        expire_action: "release",
        authorization: {
          authorization_code: "AUTH_vbvd4qti3m",
          last4: "8016",
          card_type: "visa credit",
          bank: "ABSA BANK LIMITED, SOUTH AFRICA",
          exp_month: "11",
          exp_year: "2026",
          reusable: true,
        },
      },
    });
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(200);
    expect((await res.json()).handled).toBe(true);
    expect(counters.hold_active).toBe(1);
    expect(counters.card_saved).toBe(1); // Reserve-by-Code input for next time
  });

  it("capture.success while the ride is already PAID changes nothing (guard)", async () => {
    ride = { ...ride, payment_status: "PAID" };
    const res = await post(captureSuccess, sign(captureSuccess));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.handled).toBe(false);
    expect(counters.paid).toBeUndefined(); // guarded UPDATE never fired
  });

  it("an unknown event is acknowledged with 200 (no retries), state untouched", async () => {
    const raw = JSON.stringify({ event: "transfer.success", data: { reference: "x" } });
    const res = await post(raw, sign(raw));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ received: true, handled: false });
    expect(counters.paid).toBeUndefined();
  });
});


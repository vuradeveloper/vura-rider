// ─────────────────────────────────────────────────────────────────────────────
// CARD PREAUTHORIZATION — service contract tests.
//
// The point of these: every Paystack call must match the OFFICIAL docs
// (https://paystack.com/docs/payments/card-preauthorization/) exactly —
// endpoint path, parameter names, cent amounts (live ZAR floor 500), expire_after_days
// / expire_action, reference charset — and the webhook signature must be HMAC
// SHA512 of the raw body. fetch is stubbed, so nothing here touches the network.
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac } from "crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../config/database", () => ({
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
  execute: vi.fn(async () => ({ rowCount: 1 })),
}));

import {
  initializePreauthorization,
  reservePreauthorization,
  capturePreauthorization,
  releasePreauthorization,
  holdAmountCents,
  captureAmountCents,
  newPreauthReference,
  normalizePaymentStatus,
  verifyPaystackSignature,
  PreauthError,
  createRideHold,
} from "./preauthorization";
import { queryOne, execute } from "../config/database";

const SECRET = "sk_test_preauth_secret";
let fetchMock: ReturnType<typeof vi.fn>;
let savedEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  savedEnv = { ...process.env };
  process.env.PAYMENTS_MODE = "sandbox";
  process.env.PAYSTACK_SECRET_TEST = SECRET;
  delete process.env.PAYSTACK_SECRET_KEY;
  delete process.env.PREAUTH_EXPIRE_DAYS;
  fetchMock = vi.fn(async (_url: any, init: any) => ({
    ok: true,
    status: 200,
    json: async () => ({
      status: true,
      message: "Authorization URL created",
      data: {
        authorization_url: "https://checkout.paystack.com/preauth-abc",
        access_code: "preauth-abc",
        reference: JSON.parse(init?.body || "{}")?.reference || "ref",
        status: "authorized",
        expiry_date: "2026-10-17T00:00:00.000Z",
        authorization: { authorization_code: "AUTH_x", reusable: true },
      },
    }),
  }));
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(queryOne).mockResolvedValue(null as any);
  vi.mocked(execute).mockResolvedValue({ rowCount: 1 } as any);
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = savedEnv;
  vi.clearAllMocks();
});

function lastCall() {
  expect(fetchMock).toHaveBeenCalled();
  const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return {
    url: String(url),
    method: init?.method || "GET",
    headers: init?.headers || {},
    body: JSON.parse(String(init?.body)),
  };
}

describe("initializePreauthorization (docs-exact)", () => {
  it("POSTs email/amount(string cents)/currency/reference/expire_* to /preauthorization/initialize", async () => {
    const res = await initializePreauthorization({
      email: "rider@vura.com",
      amountRands: 24.99,
      reference: "VURAABC123",
    });
    const c = lastCall();
    expect(c.url).toBe("https://api.paystack.co/preauthorization/initialize");
    expect(c.method).toBe("POST");
    expect(c.headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(c.body).toEqual({
      email: "rider@vura.com",
      amount: "2499", // ZAR cents, string exactly as the docs cURL shows
      currency: "ZAR",
      reference: "VURAABC123",
      expire_after_days: 1, // docs: min 1, default 5 — we ask for the shortest
      expire_action: "release", // docs: frees the hold if nobody captures
    });
    expect(res.authorizationUrl).toBe("https://checkout.paystack.com/preauth-abc");
    expect(res.reference).toBe("VURAABC123");
  });

  it("enforces Paystack LIVE minimum of ZAR 5.00 for smaller fares", async () => {
    await initializePreauthorization({ email: "a@b.c", amountRands: 1 });
    expect(lastCall().body.amount).toBe("500");
  });
});

describe("reservePreauthorization — Reserve by Authorization Code (docs-exact)", () => {
  it("POSTs the initialize params PLUS authorization_code (amount as a number)", async () => {
    const res = await reservePreauthorization({
      email: "returning@vura.com",
      amountRands: 50,
      authorizationCode: "AUTH_dalhwqi5vw",
      reference: "VURAREF1",
    });
    const c = lastCall();
    expect(c.url).toBe("https://api.paystack.co/preauthorization/reserve_authorization");
    expect(c.body).toEqual({
      email: "returning@vura.com",
      currency: "ZAR",
      amount: 5000, // number of cents, as in the docs example
      authorization_code: "AUTH_dalhwqi5vw",
      reference: "VURAREF1",
      expire_after_days: 1,
      expire_action: "release",
    });
    expect(res.status).toBe("authorized");
  });
});

describe("capturePreauthorization (docs-exact)", () => {
  it("POSTs reference + currency + amount(string cents) to /preauthorization/capture", async () => {
    await capturePreauthorization({ reference: "123-abc", amountCents: 1000 });
    const c = lastCall();
    expect(c.url).toBe("https://api.paystack.co/preauthorization/capture");
    expect(c.body).toEqual({ reference: "123-abc", currency: "ZAR", amount: "1000" });
  });
});

describe("releasePreauthorization (docs-exact)", () => {
  it("POSTs ONLY the reference to /preauthorization/release", async () => {
    await releasePreauthorization({ reference: "123-abc" });
    const c = lastCall();
    expect(c.url).toBe("https://api.paystack.co/preauthorization/release");
    expect(c.body).toEqual({ reference: "123-abc" });
  });
});

describe("amounts, references, status enum", () => {
  it("holdAmountCents applies the live ZAR 5.00 floor and rounds correctly", () => {
    expect(holdAmountCents(1)).toBe(500); // R1 demo fare -> R5 hold (API floor)
    expect(holdAmountCents(0.2)).toBe(500);
    expect(holdAmountCents(12.345)).toBe(1235);
    expect(holdAmountCents(25)).toBe(2500);
  });

  it("captureAmountCents is the exact final fare (never floored up)", () => {
    expect(captureAmountCents(0.2)).toBe(20);
    expect(captureAmountCents(12.34)).toBe(1234);
  });

  it("newPreauthReference uses only docs-legal characters (- . = alphanumeric)", () => {
    const ref = newPreauthReference();
    expect(ref).toMatch(/^[A-Za-z0-9.-=]+$/);
    expect(ref.length).toBeGreaterThan(8);
  });

  it("normalizePaymentStatus maps NULL/''/legacy 'paid' to the enum", () => {
    expect(normalizePaymentStatus(null)).toBe("NONE");
    expect(normalizePaymentStatus("")).toBe("NONE");
    expect(normalizePaymentStatus("paid")).toBe("PAID"); // legacy affiliate value
    expect(normalizePaymentStatus("hold_active")).toBe("HOLD_ACTIVE");
    expect(normalizePaymentStatus("something_else")).toBe("NONE");
  });

  it("mock mode fabricates a checkout URL without touching fetch", async () => {
    process.env.PAYMENTS_MODE = "mock";
    const res = await initializePreauthorization({ email: "a@b.c", amountRands: 10 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.authorizationUrl).toContain("checkout.paystack.com/mock-preauth-");
  });
});

describe("verifyPaystackSignature — HMAC SHA512 of the raw body", () => {
  const body = Buffer.from('{"event":"preauthorization.capture.success"}', "utf8");

  it("accepts the correct HMAC signed with the secret", () => {
    const good = createHmac("sha512", SECRET).update(body).digest("hex");
    expect(verifyPaystackSignature(body, good, SECRET)).toBe(true);
  });

  it("rejects a wrong secret, a tampered body, and a missing header", () => {
    const good = createHmac("sha512", SECRET).update(body).digest("hex");
    expect(verifyPaystackSignature(body, good, "sk_wrong")).toBe(false);
    expect(
      verifyPaystackSignature(Buffer.from('{"event":"evil"}'), good, SECRET)
    ).toBe(false);
    expect(verifyPaystackSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyPaystackSignature(body, "", SECRET)).toBe(false);
    expect(verifyPaystackSignature(body, good, "")).toBe(false);
  });
});

describe("createRideHold guards", () => {
  it("404s (typed) when the ride does not exist", async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any);
    await expect(
      createRideHold({ rideId: "nope", userId: "u1", amountRands: 20, email: "a@b.c" })
    ).rejects.toMatchObject({ code: "ride_not_found", httpStatus: 404 });
    // ensurePreauthSchema ran first — additive ALTERs only, never a write to rides state
    expect(PreauthError).toBeDefined();
  });

  it("403s (typed) when the ride belongs to another passenger", async () => {
    vi.mocked(queryOne).mockResolvedValueOnce({
      id: "ride-1",
      passenger_id: "someone-else",
      payment_method: "card",
      status: "searching",
      estimated_fare: 20,
      actual_fare: null,
      payment_status: "NONE",
      preauth_reference: null,
      hold_checkout_url: null,
      hold_expires_at: null,
      hold_amount_cents: null,
      captured_amount: null,
    } as any);
    await expect(
      createRideHold({ rideId: "ride-1", userId: "u1", amountRands: 20, email: "a@b.c" })
    ).rejects.toMatchObject({ code: "not_owner", httpStatus: 403 });
  });
});


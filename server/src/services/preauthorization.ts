// ─────────────────────────────────────────────────────────────────────────────
// CARD PREAUTHORIZATION — real holds on the rider's card (SERVER-SIDE ONLY).
//
// Source of truth (every parameter below is copied from it, nothing guessed):
//   https://paystack.com/docs/payments/card-preauthorization/
//
//   POST /preauthorization/initialize             first-time riders → checkout URL
//   POST /preauthorization/reserve_authorization  returning riders → saved card
//   POST /preauthorization/capture                final fare when the ride completes
//   POST /preauthorization/release                cancel / no-driver / stuck search
//
// Doc facts this file encodes:
//   • amount is in the CENTS of the currency. Paystack's docs still say 100,
//     but the LIVE API rejects anything under ZAR 5.00 ("The preauthorization
//     amount must be at least ZAR 5.00", seen 2026-10-24), so MIN_HOLD_CENTS
//     below is 500. A smaller fare is still held at R5 and only the real fare
//     is captured (the balance auto-releases).
//   • currency must be "ZAR" (registered-SA-business feature).
//   • expire_after_days: 1..7, default 5; expire_action: "capture" | "release",
//     default "release" — we always ask for "release" so an abandoned hold frees
//     the rider's money by itself.
//   • reference: unique, case-sensitive, only -, ., = and alphanumeric.
//   • capture takes reference + amount + currency (≤ held; a lower capture
//     auto-releases the balance); release takes ONLY the reference.
//   • Webhooks are REQUIRED (the flow is async): x-paystack-signature is the
//     HMAC SHA512 of the raw request body signed with the secret key.
//   • reserve_authorization takes the initialize parameters PLUS
//     authorization_code — and authorization_code + email MUST be the ones from
//     the customer's first transaction.
//
// Ride payment_status enum (the rides.payment_status column already existed for
// the affiliate/pay-later flows with legacy value 'paid', which we honour):
//
//   NONE           no hold on this ride (cash, pay-later, pre-feature ride)
//   HOLD_PENDING   initialized — rider has not finished the secure page yet
//   HOLD_ACTIVE    funds held (reserve.success / reserve_authorization)
//   CAPTURE_PENDING capture sent — waiting for preauthorization.capture.success
//   PAID           capture confirmed by webhook (never set by the API call)
//   PAYMENT_FAILED capture failed (webhook) or could not be attempted
//   RELEASED       hold released (cancel / no driver / stuck search / expiry)
//   HOLD_EXPIRED   the hold window lapsed without capture or release
// ─────────────────────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from "crypto";
import {
  paystackFetch,
  paymentsMode,
  paystackConfig,
  isPaystackConfigured,
} from "./paystackPayment";
import { query, queryOne, execute } from "../config/database";

// ── Status enum ───────────────────────────────────────────────────────────────

export type RidePaymentStatus =
  | "NONE"
  | "HOLD_PENDING"
  | "HOLD_ACTIVE"
  | "CAPTURE_PENDING"
  | "PAID"
  | "PAYMENT_FAILED"
  | "RELEASED"
  | "HOLD_EXPIRED";

export const RIDE_PAYMENT_STATUSES: readonly RidePaymentStatus[] = [
  "NONE",
  "HOLD_PENDING",
  "HOLD_ACTIVE",
  "CAPTURE_PENDING",
  "PAID",
  "PAYMENT_FAILED",
  "RELEASED",
  "HOLD_EXPIRED",
];

const HOLD_STATES: ReadonlySet<string> = new Set([
  "HOLD_PENDING",
  "HOLD_ACTIVE",
  "CAPTURE_PENDING",
  "PAID",
  "PAYMENT_FAILED",
]);

/** Normalises whatever the column holds (NULL, '', legacy 'paid') to the enum. */
export function normalizePaymentStatus(raw: unknown): RidePaymentStatus {
  const v = String(raw ?? "").trim();
  if (!v) return "NONE";
  const up = v.toUpperCase();
  if (up === "PAID") return "PAID"; // legacy affiliate/pay-later value 'paid'
  return (RIDE_PAYMENT_STATUSES as readonly string[]).includes(up)
    ? (up as RidePaymentStatus)
    : "NONE";
}

/** Typed failure so routes map onto honest HTTP statuses in one catch. */
export class PreauthError extends Error {
  code:
    | "ride_not_found"
    | "not_owner"
    | "no_fare"
    | "not_configured"
    | "hold_failed"
    | "no_hold"
    | "hold_incomplete"
    | "hold_released"
    | "capture_exceeds_hold"
    | "capture_failed"
    | "release_failed";
  httpStatus: number;
  constructor(code: PreauthError["code"], message: string, httpStatus: number) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

// ── Amounts & references (docs-exact) ────────────────────────────────────────

/**
 * Paystack's LIVE minimum for /preauthorization/initialize is ZAR 5.00
 * (500 cents). Their documentation still says 100, and support email said R1,
 * but the API answered on 2026-10-24:
 *   "The preauthorization amount must be at least ZAR 5.00"
 * Keep one constant so a future policy change is a one-line edit.
 */
export const MIN_HOLD_CENTS = 500;

/**
 * Amount to HOLD, in cents. Paystack's live floor is R5, so the R1 test fare is
 * held at R5; a later capture of the real, lower fare auto-releases the balance
 * ("If the amount is lower than the initial preauthorized amount, the balance is
 * automatically released").
 */
export function holdAmountCents(fareRands: number): number {
  const cents = Math.round(Number(fareRands) * 100);
  return Number.isFinite(cents) && cents > 0 ? Math.max(MIN_HOLD_CENTS, cents) : MIN_HOLD_CENTS;
}

/** Amount to CAPTURE, in cents — the final fare, exact (never rounded up). */
export function captureAmountCents(fareRands: number): number {
  return Math.round(Number(fareRands) * 100);
}

/** Docs: unique, case-sensitive, only -, ., = and alphanumeric. */
export function newPreauthReference(prefix = "VURA"): string {
  return (
    prefix +
    Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).slice(2, 10).toUpperCase()
  );
}

/** Days until expire_action runs. Docs: min 1, default 5 — we default to 1. */
export function preauthExpireDays(): number {
  const n = parseInt(process.env.PREAUTH_EXPIRE_DAYS || "1", 10);
  return Math.min(7, Math.max(1, Number.isFinite(n) ? n : 1));
}

/** Minutes a ride may sit in searching/no_drivers before its hold is released. */
export function stuckSearchMinutes(): number {
  const n = parseInt(process.env.PREAUTH_STUCK_SEARCH_MINUTES || "15", 10);
  return Number.isFinite(n) && n > 0 ? n : 15;
}

// ── Schema (additive + idempotent; mirrors the money-table lazy-ensure style) ─

let schemaReady = false;

export async function ensurePreauthSchema(): Promise<void> {
  if (schemaReady) return;
  try {
    // payment_status already exists on installs that ran the affiliate/pay-later
    // flows — IF NOT EXISTS keeps those VARCHAR(20) columns untouched.
    await execute(
      `ALTER TABLE rides ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'NONE'`
    );
    await execute(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS preauth_reference TEXT`);
    await execute(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS hold_checkout_url TEXT`);
    await execute(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS hold_expires_at TIMESTAMPTZ`);
    await execute(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS hold_amount_cents INTEGER`);
    await execute(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS captured_amount NUMERIC(10,2)`);
    await execute(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ`);
    await execute(
      `CREATE UNIQUE INDEX IF NOT EXISTS rides_preauth_reference_key
         ON rides (preauth_reference) WHERE preauth_reference IS NOT NULL`
    );
    // One row per webhook event instance → replayed deliveries are dropped here
    // BEFORE any state transition, which is what makes the handlers idempotent.
    await execute(
      `CREATE TABLE IF NOT EXISTS paystack_webhook_events (
         event_key  TEXT PRIMARY KEY,
         event      TEXT NOT NULL,
         data       JSONB,
         received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`
    );
    // The saved-card table the webhook writes reusable authorization codes into
    // (same shape routes/payments.ts creates — IF NOT EXISTS is a no-op there).
    // `signature` is Paystack's per-card fingerprint (SIG_…) used by Pay Later
    // eligibility to identify "the same card"; card_auth_code provenance lives
    // on rides (015).
    await execute(`ALTER TABLE rides ADD COLUMN IF NOT EXISTS card_auth_code VARCHAR(100)`);
    await execute(
      `CREATE TABLE IF NOT EXISTS saved_cards (
         id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
         user_id UUID NOT NULL REFERENCES users(id),
         card_type VARCHAR(20),
         last4 VARCHAR(4),
         bank VARCHAR(100),
         exp_month INTEGER,
         exp_year INTEGER,
         card_number_masked VARCHAR(30),
         transaction_index VARCHAR(100),
         signature VARCHAR(64),
         is_default BOOLEAN DEFAULT false,
         created_at TIMESTAMPTZ DEFAULT NOW()
       )`
    );
    await execute(`ALTER TABLE saved_cards ADD COLUMN IF NOT EXISTS signature VARCHAR(64)`);
    schemaReady = true;
  } catch (err: any) {
    // Never throw: a boot-time hiccup retries on the next call instead of
    // crashing a request. Callers all handle their own missing-table paths.
    console.warn("[preauth] schema ensure failed:", err?.message || err);
  }
}

// ── Webhook signature (docs: HMAC SHA512 of the raw body with the secret) ────

/** The secret the x-paystack-signature header must be signed with. */
export function paystackWebhookSecret(): string {
  return paystackConfig().secretKey;
}

export function verifyPaystackSignature(
  rawBody: Buffer | string,
  header: string | string[] | undefined,
  secret: string
): boolean {
  if (!secret || !rawBody || rawBody.length === 0) return false;
  if (!header || typeof header !== "string" || header.length === 0) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(header, "utf8");
  // Constant-time compare — a plain === on attacker-controlled bytes leaks.
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── The four documented endpoints ─────────────────────────────────────────────

export async function initializePreauthorization(input: {
  email: string;
  /** Fare in RANDS — converted to cents here (docs minimum 100 cents). */
  amountRands: number;
  reference?: string;
  expireAfterDays?: number;
  expireAction?: "capture" | "release";
  callbackUrl?: string | null;
}): Promise<{ reference: string; authorizationUrl: string }> {
  if (paymentsMode() === "mock") {
    const reference = input.reference || newPreauthReference();
    return {
      reference,
      authorizationUrl: `https://checkout.paystack.com/mock-preauth-${reference}`,
    };
  }
  if (!isPaystackConfigured()) {
    throw new PreauthError(
      "not_configured",
      "Paystack is not configured on the server (PAYSTACK secret key missing).",
      503
    );
  }
  const reference = input.reference || newPreauthReference();
  const data = await paystackFetch<any>("/preauthorization/initialize", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      // Docs cURL sends amount as a string of cents; minimum 100 for ZAR.
      amount: String(holdAmountCents(input.amountRands)),
      currency: "ZAR",
      reference,
      expire_after_days: input.expireAfterDays ?? preauthExpireDays(),
      expire_action: input.expireAction ?? "release",
      ...(input.callbackUrl ? { callback_url: input.callbackUrl } : {}),
    }),
  });
  const url = String(data?.data?.authorization_url || "");
  if (!url) {
    throw new PreauthError(
      "hold_failed",
      "Paystack did not return an authorization_url.",
      502
    );
  }
  return {
    reference: String(data?.data?.reference || reference),
    authorizationUrl: url,
  };
}

export async function reservePreauthorization(input: {
  email: string;
  /** Fare in RANDS — converted to cents here. */
  amountRands: number;
  authorizationCode: string;
  reference?: string;
  expireAfterDays?: number;
  expireAction?: "capture" | "release";
}): Promise<{ reference: string; status: string; expiryDate: string | null }> {
  if (paymentsMode() === "mock") {
    return {
      reference: input.reference || newPreauthReference(),
      status: "authorized",
      expiryDate: new Date(Date.now() + 86_400_000).toISOString(),
    };
  }
  if (!isPaystackConfigured()) {
    throw new PreauthError(
      "not_configured",
      "Paystack is not configured on the server (PAYSTACK secret key missing).",
      503
    );
  }
  // Docs: "the same parameters as the Initialize endpoint except that it
  // requires the authorization_code" — the example sends amount as a NUMBER.
  const data = await paystackFetch<any>("/preauthorization/reserve_authorization", {
    method: "POST",
    body: JSON.stringify({
      email: input.email,
      currency: "ZAR",
      amount: Math.max(MIN_HOLD_CENTS, Math.round(input.amountRands * 100)),
      authorization_code: input.authorizationCode,
      ...(input.reference ? { reference: input.reference } : {}),
      expire_after_days: input.expireAfterDays ?? preauthExpireDays(),
      expire_action: input.expireAction ?? "release",
    }),
  });
  return {
    reference: String(data?.data?.reference || input.reference || ""),
    status: String(data?.data?.status || "authorized"),
    expiryDate: data?.data?.expiry_date ? String(data.data.expiry_date) : null,
  };
}

export async function capturePreauthorization(input: {
  reference: string;
  /** Final fare in CENTS (≤ the held amount — docs). */
  amountCents: number;
}): Promise<{ accepted: true }> {
  if (paymentsMode() === "mock") return { accepted: true };
  if (!isPaystackConfigured()) {
    throw new PreauthError(
      "not_configured",
      "Paystack is not configured on the server (PAYSTACK secret key missing).",
      503
    );
  }
  // Docs cURL: { reference, currency, amount } — amount a string of cents.
  await paystackFetch<any>("/preauthorization/capture", {
    method: "POST",
    body: JSON.stringify({
      reference: input.reference,
      currency: "ZAR",
      amount: String(Math.round(input.amountCents)),
    }),
  });
  // Capture is async on Paystack's side: this means "accepted"; the money is
  // only ours after the preauthorization.capture.success webhook.
  return { accepted: true };
}

export async function releasePreauthorization(input: {
  reference: string;
}): Promise<{ accepted: true }> {
  if (paymentsMode() === "mock") return { accepted: true };
  if (!isPaystackConfigured()) {
    throw new PreauthError(
      "not_configured",
      "Paystack is not configured on the server (PAYSTACK secret key missing).",
      503
    );
  }
  // Docs: "This endpoint only requires the reference passed in the request body."
  await paystackFetch<any>("/preauthorization/release", {
    method: "POST",
    body: JSON.stringify({ reference: input.reference }),
  });
  return { accepted: true };
}

// ── Ride-level state machine ──────────────────────────────────────────────────

export interface RideHoldResult {
  rideId: string;
  reference: string | null;
  paymentStatus: RidePaymentStatus;
  authorizationUrl?: string | null;
  holdExpiresAt?: string | null;
  alreadyHeld?: boolean;
}

interface RideHoldRow {
  id: string;
  passenger_id: string | null;
  payment_method: string | null;
  status: string;
  estimated_fare: number | string | null;
  actual_fare: number | string | null;
  payment_status: string | null;
  preauth_reference: string | null;
  hold_checkout_url: string | null;
  hold_expires_at: string | null;
  hold_amount_cents: number | null;
  captured_amount: number | string | null;
}

const HOLD_CLAIMABLE = `COALESCE(NULLIF(payment_status, ''), 'NONE')
        NOT IN ('HOLD_PENDING', 'HOLD_ACTIVE', 'CAPTURE_PENDING', 'PAID', 'PAYMENT_FAILED')`;

async function loadRide(rideId: string): Promise<RideHoldRow | null> {
  await ensurePreauthSchema();
  return await queryOne<RideHoldRow>(
    `SELECT id, passenger_id, payment_method, status,
            estimated_fare, actual_fare, payment_status,
            preauth_reference, hold_checkout_url, hold_expires_at,
            hold_amount_cents, captured_amount
       FROM rides WHERE id = $1`,
    [rideId]
  ).catch(() => null);
}

/**
 * Places (or re-reports) the hold for a ride — POST /api/rides/book.
 *
 * Claim-first: the ride row is atomically flipped to HOLD_PENDING with the new
 * reference BEFORE Paystack is called, so two concurrent taps can never create
 * two live holds on the same card. A Paystack failure rolls the claim back to
 * NONE. If the ride already has a hold, the SAME hold is returned (idempotent)
 * — including the checkout URL so the app can reopen the secure page.
 *
 * Saved card → /preauthorization/reserve_authorization → HOLD_ACTIVE with no
 *              redirect (the docs' "Reserve by Authorization Code" flow).
 * No card     → /preauthorization/initialize → HOLD_PENDING + authorization_url.
 */
export async function createRideHold(input: {
  rideId: string;
  userId: string;
  amountRands: number;
  email: string;
}): Promise<RideHoldResult> {
  const ride = await loadRide(input.rideId);
  if (!ride) throw new PreauthError("ride_not_found", "Ride not found.", 404);
  if (ride.passenger_id && ride.passenger_id !== input.userId) {
    throw new PreauthError("not_owner", "This ride does not belong to you.", 403);
  }

  const current = normalizePaymentStatus(ride.payment_status);
  if (HOLD_STATES.has(current)) {
    // Idempotent: the hold already exists — hand back what we have.
    return {
      rideId: ride.id,
      reference: ride.preauth_reference,
      paymentStatus: current,
      authorizationUrl: ride.hold_checkout_url,
      holdExpiresAt: ride.hold_expires_at,
      alreadyHeld: true,
    };
  }

  const fareRands =
    Number.isFinite(Number(input.amountRands)) && Number(input.amountRands) > 0
      ? Number(input.amountRands)
      : Number(ride.estimated_fare || 0);
  if (!Number.isFinite(fareRands) || fareRands <= 0) {
    throw new PreauthError(
      "no_fare",
      "This ride has no estimated fare to hold against.",
      400
    );
  }
  const reference = newPreauthReference();
  const expiresAt = new Date(
    Date.now() + preauthExpireDays() * 86_400_000
  ).toISOString();

  // ATOMIC CLAIM — only one writer can move a ride out of its non-hold state.
  const claim = await execute(
    `UPDATE rides
        SET payment_status = 'HOLD_PENDING',
            preauth_reference = $2,
            hold_expires_at = $3::timestamptz,
            hold_amount_cents = $4,
            hold_checkout_url = NULL,
            updated_at = NOW()
      WHERE id = $1 AND ${HOLD_CLAIMABLE}`,
    [ride.id, reference, expiresAt, holdAmountCents(fareRands)]
  );
  if (!claim || claim.rowCount === 0) {
    const again = await loadRide(ride.id);
    const st = normalizePaymentStatus(again?.payment_status);
    return {
      rideId: ride.id,
      reference: again?.preauth_reference ?? null,
      paymentStatus: st,
      authorizationUrl: again?.hold_checkout_url,
      holdExpiresAt: again?.hold_expires_at,
      alreadyHeld: true,
    };
  }

  const rollbackClaim = async () => {
    await execute(
      `UPDATE rides
          SET payment_status = 'NONE', preauth_reference = NULL,
              hold_expires_at = NULL, hold_amount_cents = NULL, updated_at = NOW()
        WHERE id = $1 AND payment_status = 'HOLD_PENDING' AND preauth_reference = $2`,
      [ride.id, reference]
    ).catch(() => {});
  };

  try {
    // Returning rider with a reusable card → Reserve by Authorization Code.
    const card = await queryOne<{ transaction_index: string }>(
      `SELECT transaction_index FROM saved_cards
        WHERE user_id = $1 AND transaction_index IS NOT NULL
        ORDER BY is_default DESC, created_at DESC LIMIT 1`,
      [input.userId]
    ).catch(() => null);

    if (card?.transaction_index) {
      const reserved = await reservePreauthorization({
        email: input.email,
        amountRands: fareRands,
        authorizationCode: card.transaction_index,
        reference,
      });
      await execute(
        `UPDATE rides
            SET payment_status = 'HOLD_ACTIVE',
                preauth_reference = $3,
                hold_expires_at = COALESCE($4::timestamptz, hold_expires_at),
                updated_at = NOW()
          WHERE id = $1 AND payment_status = 'HOLD_PENDING' AND preauth_reference = $2`,
        [ride.id, reference, reserved.reference || reference, reserved.expiryDate]
      );
      return {
        rideId: ride.id,
        reference: reserved.reference || reference,
        paymentStatus: "HOLD_ACTIVE",
        authorizationUrl: null,
        holdExpiresAt: reserved.expiryDate,
        alreadyHeld: false,
      };
    }

    // First-time rider → hosted checkout; funds stay in their account until
    // capture, and expire_action "release" frees the hold if they never finish.
    const init = await initializePreauthorization({
      email: input.email,
      amountRands: fareRands,
      reference,
    });
    await execute(
      `UPDATE rides
          SET preauth_reference = $3, hold_checkout_url = $4, updated_at = NOW()
        WHERE id = $1 AND payment_status = 'HOLD_PENDING' AND preauth_reference = $2`,
      [ride.id, reference, init.reference, init.authorizationUrl]
    );
    return {
      rideId: ride.id,
      reference: init.reference,
      paymentStatus: "HOLD_PENDING",
      authorizationUrl: init.authorizationUrl,
      holdExpiresAt: expiresAt,
      alreadyHeld: false,
    };
  } catch (err: any) {
    await rollbackClaim();
    if (err instanceof PreauthError) throw err;
    throw new PreauthError(
      "hold_failed",
      `Could not hold funds on your card: ${err?.message || "Paystack error"}`,
      // 422, not 502: Cloudflare replaces an origin 502 with its own HTML error
      // page, which hides Paystack's real reason from the rider app. A rejected
      // hold is an upstream-validation answer, so pass it through intact.
      422
    );
  }
}

/**
 * Captures the final fare for a completed ride — POST /api/rides/:id/complete
 * and the server-side completion hooks. NEVER marks PAID: that belongs to
 * preauthorization.capture.success (webhook), so an optimistic API response can
 * never lie about money that later fails to settle.
 */
export async function captureRideHold(
  rideId: string,
  opts: { amountRands?: number } = {}
): Promise<{
  paymentStatus: RidePaymentStatus;
  captured: boolean;
  alreadyProcessed?: boolean;
  capturedAmount?: number;
}> {
  const ride = await loadRide(rideId);
  if (!ride) throw new PreauthError("ride_not_found", "Ride not found.", 404);

  const current = normalizePaymentStatus(ride.payment_status);
  if (current === "CAPTURE_PENDING" || current === "PAID") {
    return {
      paymentStatus: current,
      captured: false,
      alreadyProcessed: true,
      capturedAmount: Number(ride.captured_amount ?? 0) || undefined,
    };
  }
  if (!ride.preauth_reference || current === "NONE") {
    throw new PreauthError(
      "no_hold",
      "There is no preauthorized hold on this ride to capture.",
      400
    );
  }
  if (current === "HOLD_PENDING") {
    throw new PreauthError(
      "hold_incomplete",
      "The rider has not finished the secure payment page yet — the funds are not held.",
      409
    );
  }
  if (current === "RELEASED" || current === "HOLD_EXPIRED") {
    throw new PreauthError(
      "hold_released",
      "This ride's hold was already released — no funds are held to capture.",
      409
    );
  }

  const fareRands =
    Number(opts.amountRands) > 0
      ? Number(opts.amountRands)
      : Number(ride.actual_fare) > 0
        ? Number(ride.actual_fare)
        : Number(ride.estimated_fare || 0);
  const cents = captureAmountCents(fareRands);
  if (!Number.isFinite(cents) || cents <= 0) {
    throw new PreauthError(
      "no_fare",
      "This ride has no final fare to capture.",
      400
    );
  }
  const held = Number(ride.hold_amount_cents || 0);
  if (held > 0 && cents > held) {
    // Docs: capture must be ≤ the initial amount. Fail honestly instead of
    // asking Paystack to do something it will reject — ops sees PAYMENT_FAILED.
    await execute(
      `UPDATE rides SET payment_status = 'PAYMENT_FAILED', updated_at = NOW()
        WHERE id = $1 AND payment_status = 'HOLD_ACTIVE'`,
      [ride.id]
    ).catch(() => {});
    console.error(
      `[preauth] capture EXCEEDS hold ride=${rideId} final=${cents}c > held=${held}c`
    );
    throw new PreauthError(
      "capture_exceeds_hold",
      `Final fare (R${(cents / 100).toFixed(2)}) exceeds the held amount (R${(held / 100).toFixed(2)}).`,
      409
    );
  }

  try {
    await capturePreauthorization({
      reference: ride.preauth_reference,
      amountCents: cents,
    });
  } catch (err: any) {
    await execute(
      `UPDATE rides SET payment_status = 'PAYMENT_FAILED', updated_at = NOW()
        WHERE id = $1 AND payment_status = 'HOLD_ACTIVE'`,
      [ride.id]
    ).catch(() => {});
    if (err instanceof PreauthError) throw err;
    throw new PreauthError(
      "capture_failed",
      `Could not capture the fare: ${err?.message || "Paystack error"}`,
      502
    );
  }

  await execute(
    `UPDATE rides SET payment_status = 'CAPTURE_PENDING', updated_at = NOW()
      WHERE id = $1 AND payment_status = 'HOLD_ACTIVE'`,
    [ride.id]
  );
  return {
    paymentStatus: "CAPTURE_PENDING",
    captured: true,
    capturedAmount: cents / 100,
  };
}

/**
 * Releases the hold — POST /api/rides/:id/cancel, every cancel path, and the
 * stuck-search reaper. Idempotent: PAID/RELEASED/NONE are no-ops, and
 * CAPTURE_PENDING is deliberately left alone (a capture is already racing).
 */
export async function releaseRideHold(
  rideId: string,
  reason = "cancelled"
): Promise<{
  paymentStatus: RidePaymentStatus;
  released: boolean;
  alreadyReleased?: boolean;
}> {
  const ride = await loadRide(rideId);
  if (!ride) throw new PreauthError("ride_not_found", "Ride not found.", 404);

  const current = normalizePaymentStatus(ride.payment_status);
  if (current === "RELEASED") {
    return { paymentStatus: "RELEASED", released: false, alreadyReleased: true };
  }
  if (current === "PAID" || current === "CAPTURE_PENDING") {
    // Money is (or will be) taken — releasing now would race the capture.
    return { paymentStatus: current, released: false };
  }
  if (!ride.preauth_reference || current === "NONE") {
    return { paymentStatus: "NONE", released: false };
  }

  try {
    await releasePreauthorization({ reference: ride.preauth_reference });
  } catch (err: any) {
    if (current === "HOLD_PENDING") {
      // The checkout never completed, so there is nothing for Paystack to
      // release — an error here means funds were NEVER held. Mark it released
      // locally so the rider's UI and the reaper stop caring about it.
      console.warn(
        `[preauth] release of an un-completed hold ${ride.preauth_reference} failed (${err?.message || err}) — funds were never held; marking RELEASED`
      );
    } else {
      // HOLD_ACTIVE and Paystack said no: the money is still held. Keep the
      // status honest — expiry (expire_action=release) or a retry will free it.
      throw new PreauthError(
        "release_failed",
        `Could not release the hold: ${err?.message || "Paystack error"}`,
        502
      );
    }
  }

  await execute(
    `UPDATE rides
        SET payment_status = 'RELEASED', hold_checkout_url = NULL, updated_at = NOW()
      WHERE id = $1 AND payment_status IN ('HOLD_PENDING', 'HOLD_ACTIVE', 'HOLD_EXPIRED')`,
    [ride.id]
  ).catch(() => {});
  const after = await loadRide(ride.id);
  const st = normalizePaymentStatus(after?.payment_status);
  if (st === "RELEASED") {
    console.log(`[preauth] hold released ride=${rideId} reason=${reason}`);
  }
  return { paymentStatus: st, released: st === "RELEASED", alreadyReleased: false };
}

/**
 * Requirement: reaper for rides stuck in "searching for a driver" past the
 * window — their holds are released so nobody's money sits held forever.
 */
export async function releaseStuckHolds(
  minutes: number = stuckSearchMinutes()
): Promise<number> {
  await ensurePreauthSchema();
  const rows = await query<{ id: string }>(
    `SELECT id FROM rides
      WHERE COALESCE(NULLIF(payment_status, ''), 'NONE') IN ('HOLD_PENDING', 'HOLD_ACTIVE')
        AND status IN ('searching', 'no_drivers')
        AND created_at < NOW() - make_interval(mins => $1::int)
      ORDER BY created_at
      LIMIT 25`,
    [String(minutes)]
  ).catch(() => [] as { id: string }[]);
  let released = 0;
  for (const row of rows) {
    try {
      const r = await releaseRideHold(row.id, `stuck_searching_${minutes}m`);
      if (r.released) released++;
    } catch (err: any) {
      console.warn(
        `[preauth] stuck-hold release failed ride=${row.id}:`,
        err?.message || err
      );
    }
  }
  if (released > 0) {
    console.log(
      `[preauth] released ${released} hold(s) stuck searching > ${minutes}m`
    );
  }
  return released;
}

export function startPreauthReaper(): NodeJS.Timeout {
  const timer = setInterval(() => {
    void releaseStuckHolds().catch((err) =>
      console.warn("[preauth] reaper tick failed:", err?.message || err)
    );
  }, 60_000);
  // Never keep the process alive just for the reaper.
  timer.unref?.();
  return timer;
}

export function stopPreauthReaper(timer: NodeJS.Timeout): void {
  clearInterval(timer);
}

// ── Webhook event handling (docs event names, idempotent by construction) ────

/**
 * Stores the reusable authorization_code from a successful hold so the NEXT
 * booking can use Reserve by Authorization Code without re-entering card
 * details (docs: reusable=true authorizations only, email must match).
 */
export async function saveReusableAuthorization(
  userId: string,
  auth: {
    authorization_code?: string;
    last4?: string;
    card_type?: string;
    brand?: string;
    bank?: string;
    exp_month?: string | number;
    exp_year?: string | number;
    reusable?: boolean;
    /** Paystack's per-card fingerprint (SIG_…) — stored for Pay Later
     *  same-card eligibility checks. Older webhook payloads may omit it. */
    signature?: string;
  }
): Promise<boolean> {
  const code = String(auth.authorization_code || "");
  if (!code || auth.reusable === false) return false;
  await ensurePreauthSchema();
  try {
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM saved_cards WHERE transaction_index = $1 LIMIT 1`,
      [code]
    );
    if (existing?.id) return false; // already on file — nothing to do
    const count = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM saved_cards WHERE user_id = $1`,
      [userId]
    );
    const isDefault = !Number(count?.n || 0);
    await execute(
      `INSERT INTO saved_cards
         (user_id, card_type, last4, bank, exp_month, exp_year, transaction_index, signature, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userId,
        String(auth.card_type || auth.brand || "card").slice(0, 20),
        String(auth.last4 || "").slice(0, 4) || "0000",
        auth.bank ? String(auth.bank).slice(0, 100) : null,
        auth.exp_month ? parseInt(String(auth.exp_month), 10) : null,
        auth.exp_year ? parseInt(String(auth.exp_year), 10) : null,
        code,
        auth.signature ? String(auth.signature).slice(0, 64) : null,
        isDefault,
      ]
    );
    return true;
  } catch (err: any) {
    // A card-file failure must never fail the webhook (Paystack would retry the
    // whole event) — the hold state is already correct without it.
    console.warn("[preauth] saveReusableAuthorization failed:", err?.message || err);
    return false;
  }
}

export interface WebhookHandleResult {
  received: true;
  event: string;
  duplicate: boolean;
  handled: boolean;
  detail?: string;
}

/**
 * Records a webhook event instance exactly once (paystack_webhook_events PK).
 * Exported so the Pay Later charge.* handlers share the same dedupe ledger —
 * returns false when the event was already seen (replay) and must be ignored.
 */
export async function recordWebhookEventOnce(
  event: string,
  data: any,
  ref: string
): Promise<boolean> {
  await ensurePreauthSchema();
  // Replays carry the same Paystack data.id (+reference) → same primary key →
  // ON CONFLICT DO NOTHING reports 0 rows and the caller skips the transition.
  const key = `${event}:${String(data?.id ?? "")}:${String(data?.transaction_id ?? "")}:${ref}`;
  const res = await execute(
    `INSERT INTO paystack_webhook_events (event_key, event, data)
     VALUES ($1, $2, $3) ON CONFLICT (event_key) DO NOTHING`,
    [key, event, JSON.stringify(data ?? {})]
  ).catch((e: any) => {
    console.error("[preauth] webhook event log failed:", e?.message || e);
    return null;
  });
  // Table missing/log failure → treat as fresh (guarded UPDATEs still idempotent).
  return res ? res.rowCount !== 0 : true;
}

/**
 * Applies one verified Paystack preauthorization event to the ride it belongs
 * to. Called ONLY from /api/paystack/webhook after the signature check.
 *
 * Every transition is a guarded UPDATE (…WHERE payment_status = 'the state we
 * expect'), so a late, out-of-order or replayed event changes nothing — that,
 * plus the paystack_webhook_events primary key, is the idempotency contract.
 */
export async function handlePreauthorizationEvent(
  event: string,
  payload: any
): Promise<WebhookHandleResult> {
  await ensurePreauthSchema();
  const data = payload?.data ?? {};
  const ref = String(data.reference || "");
  const done = (duplicate: boolean, handled: boolean, detail?: string) =>
    ({ received: true, event, duplicate, handled, detail }) as WebhookHandleResult;

  if (!ref) return done(false, false, "no reference in payload");

  const fresh = await recordWebhookEventOnce(event, data, ref);
  if (!fresh) return done(true, false, "duplicate delivery ignored");

  const ride = await queryOne<{
    id: string;
    passenger_id: string | null;
    driver_id: string | null;
    payment_status: string | null;
  }>(
    `SELECT id, passenger_id, driver_id, payment_status FROM rides WHERE preauth_reference = $1`,
    [ref]
  ).catch(() => null);
  if (!ride) {
    // A valid event for something we don't track: still 200 so Paystack stops
    // retrying — just nothing to update.
    return done(false, false, "no ride holds this reference");
  }

  switch (event) {
    case "preauthorization.reserve.success": {
      const st = normalizePaymentStatus(ride.payment_status);
      if (st === "RELEASED") {
        // The rider finished checkout AFTER the ride was cancelled. The hold
        // just became real — release it again so no money stays held.
        console.warn(
          `[preauth] reserve.success after RELEASE ride=${ride.id} — releasing late hold ${ref}`
        );
        releasePreauthorization({ reference: ref }).catch((e) =>
          console.error(
            "[preauth] late-hold release failed (expire_action=release is the backstop):",
            e?.message || e
          )
        );
        return done(false, true, "late reserve after release — releasing again");
      }
      const upd = await execute(
        `UPDATE rides
            SET payment_status = 'HOLD_ACTIVE',
                hold_expires_at = COALESCE($2::timestamptz, hold_expires_at),
                hold_checkout_url = NULL,
                updated_at = NOW()
          WHERE id = $1 AND payment_status = 'HOLD_PENDING'`,
        [ride.id, data.expiry_date ? String(data.expiry_date) : null]
      );
      // Save the reusable token for next time (docs' Reserve-by-Code input) —
      // including the card signature for Pay Later same-card eligibility.
      if (ride.passenger_id && data.authorization) {
        await saveReusableAuthorization(ride.passenger_id, data.authorization);
      }
      return done(
        false,
        (upd?.rowCount ?? 0) > 0,
        (upd?.rowCount ?? 0) > 0 ? "hold active" : `was ${st}, not HOLD_PENDING`
      );
    }

    case "preauthorization.capture.success": {
      const capturedRands = Number(data.captured_amount ?? data.amount ?? 0) / 100;
      const upd = await execute(
        `UPDATE rides
            SET payment_status = 'PAID',
                paid_at = NOW(),
                captured_amount = $2,
                updated_at = NOW()
          WHERE id = $1 AND payment_status = 'CAPTURE_PENDING'`,
        [ride.id, capturedRands]
      );
      if ((upd?.rowCount ?? 0) > 0) {
        // Provenance for Pay Later eligibility: WHICH card paid this ride.
        // countUnlockRides matches rides.card_auth_code against the rider's
        // saved card token (saved_cards.transaction_index); legacy rides
        // without provenance grandfather as card rides.
        if (data.authorization?.authorization_code) {
          await execute(
            `UPDATE rides
                SET card_auth_code = $2
              WHERE id = $1 AND card_auth_code IS DISTINCT FROM $2`,
            [ride.id, String(data.authorization.authorization_code)]
          ).catch(() => {});
        }
        // Ledger row so the money has a transaction trail (same table the
        // card-charging flows write to).
        try {
          await execute(
            `INSERT INTO payments (user_id, ride_id, reference, amount, currency, status, provider, raw_response)
             VALUES ($1, $2, $3, $4, 'ZAR', 'completed', 'paystack', $5)`,
            [ride.passenger_id, ride.id, ref, capturedRands, JSON.stringify(data)]
          );
        } catch (e: any) {
          console.warn("[preauth] payments ledger insert failed:", e?.message || e);
        }
        console.log(
          `[preauth] CAPTURED R${capturedRands.toFixed(2)} ride=${ride.id} ref=${ref}`
        );
        // ── Commission spec: the capture webhook is what RELEASES the driver's
        // wallet credit (pending → posted). Idempotent — a duplicate delivery
        // promotes nothing. The webhook's real Paystack fee refines the split.
        try {
          const feeCents =
            data.fee != null && Number.isFinite(Number(data.fee))
              ? Math.round(Number(data.fee))
              : null;
          const { confirmCardRideCredit } = await import("../services/walletService");
          await confirmCardRideCredit(ride.driver_id ?? "", ride.id, feeCents);
        } catch (e: any) {
          console.warn(`[wallet] webhook confirm ride=${ride.id}:`, e?.message || e);
        }
        return done(false, true, "paid");
      }
      const after = await queryOne<{ payment_status: string | null }>(
        `SELECT payment_status FROM rides WHERE id = $1`,
        [ride.id]
      );
      return done(
        false,
        false,
        `capture.success for ride in state ${normalizePaymentStatus(after?.payment_status)} — ignored`
      );
    }

    case "preauthorization.capture.failed": {
      const upd = await execute(
        `UPDATE rides SET payment_status = 'PAYMENT_FAILED', updated_at = NOW()
          WHERE id = $1 AND payment_status = 'CAPTURE_PENDING'`,
        [ride.id]
      );
      console.error(
        `[preauth] CAPTURE FAILED ride=${ride.id} ref=${ref} message=${data.message || "n/a"}`
      );
      // Wallet: the capture never happened — the pending driver credit must
      // not survive (voided; never posted, so the balance never moved anyway).
      try {
        const { closeRideWalletEntries } = await import("../services/walletService");
        await closeRideWalletEntries(ride.id, "capture_failed");
      } catch (e: any) {
        console.warn(`[wallet] capture.failed close ride=${ride.id}:`, e?.message || e);
      }
      return done(false, (upd?.rowCount ?? 0) > 0, "payment failed");
    }

    case "preauthorization.release.success": {
      const upd = await execute(
        `UPDATE rides
            SET payment_status = 'RELEASED', hold_checkout_url = NULL, updated_at = NOW()
          WHERE id = $1 AND payment_status IN ('HOLD_PENDING', 'HOLD_ACTIVE', 'HOLD_EXPIRED')`,
        [ride.id]
      );
      return done(
        false,
        (upd?.rowCount ?? 0) > 0,
        (upd?.rowCount ?? 0) > 0 ? "released" : "already terminal — ignored"
      );
    }

    case "preauthorization.release.failed": {
      // Docs: "please send an email to techsupport@paystack.com" — surface it.
      console.error(
        `[preauth] RELEASE FAILED ride=${ride.id} ref=${ref} — hold may still be active; ` +
          `Paystack support: techsupport@paystack.com`
      );
      return done(false, true, "release failed (status unchanged, still held)");
    }

    default:
      // Unknown/unsupported event: acknowledge with 200 (no retries), no state change.
      return done(false, false, `unhandled event ${event}`);
  }
}










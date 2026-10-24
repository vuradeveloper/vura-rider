export type RidePaymentStatus = "NONE" | "HOLD_PENDING" | "HOLD_ACTIVE" | "CAPTURE_PENDING" | "PAID" | "PAYMENT_FAILED" | "RELEASED" | "HOLD_EXPIRED";
export declare const RIDE_PAYMENT_STATUSES: readonly RidePaymentStatus[];
/** Normalises whatever the column holds (NULL, '', legacy 'paid') to the enum. */
export declare function normalizePaymentStatus(raw: unknown): RidePaymentStatus;
/** Typed failure so routes map onto honest HTTP statuses in one catch. */
export declare class PreauthError extends Error {
    code: "ride_not_found" | "not_owner" | "no_fare" | "not_configured" | "hold_failed" | "no_hold" | "hold_incomplete" | "hold_released" | "capture_exceeds_hold" | "capture_failed" | "release_failed";
    httpStatus: number;
    constructor(code: PreauthError["code"], message: string, httpStatus: number);
}
/**
 * Paystack's LIVE minimum for /preauthorization/initialize is ZAR 5.00
 * (500 cents). Their documentation still says 100, and support email said R1,
 * but the API answered on 2026-10-24:
 *   "The preauthorization amount must be at least ZAR 5.00"
 * Keep one constant so a future policy change is a one-line edit.
 */
export declare const MIN_HOLD_CENTS = 500;
/**
 * Amount to HOLD, in cents. Paystack's live floor is R5, so the R1 test fare is
 * held at R5; a later capture of the real, lower fare auto-releases the balance
 * ("If the amount is lower than the initial preauthorized amount, the balance is
 * automatically released").
 */
export declare function holdAmountCents(fareRands: number): number;
/** Amount to CAPTURE, in cents — the final fare, exact (never rounded up). */
export declare function captureAmountCents(fareRands: number): number;
/** Docs: unique, case-sensitive, only -, ., = and alphanumeric. */
export declare function newPreauthReference(prefix?: string): string;
/** Days until expire_action runs. Docs: min 1, default 5 — we default to 1. */
export declare function preauthExpireDays(): number;
/** Minutes a ride may sit in searching/no_drivers before its hold is released. */
export declare function stuckSearchMinutes(): number;
export declare function ensurePreauthSchema(): Promise<void>;
/** The secret the x-paystack-signature header must be signed with. */
export declare function paystackWebhookSecret(): string;
export declare function verifyPaystackSignature(rawBody: Buffer | string, header: string | string[] | undefined, secret: string): boolean;
export declare function initializePreauthorization(input: {
    email: string;
    /** Fare in RANDS — converted to cents here (docs minimum 100 cents). */
    amountRands: number;
    reference?: string;
    expireAfterDays?: number;
    expireAction?: "capture" | "release";
    callbackUrl?: string | null;
}): Promise<{
    reference: string;
    authorizationUrl: string;
}>;
export declare function reservePreauthorization(input: {
    email: string;
    /** Fare in RANDS — converted to cents here. */
    amountRands: number;
    authorizationCode: string;
    reference?: string;
    expireAfterDays?: number;
    expireAction?: "capture" | "release";
}): Promise<{
    reference: string;
    status: string;
    expiryDate: string | null;
}>;
export declare function capturePreauthorization(input: {
    reference: string;
    /** Final fare in CENTS (≤ the held amount — docs). */
    amountCents: number;
}): Promise<{
    accepted: true;
}>;
export declare function releasePreauthorization(input: {
    reference: string;
}): Promise<{
    accepted: true;
}>;
export interface RideHoldResult {
    rideId: string;
    reference: string | null;
    paymentStatus: RidePaymentStatus;
    authorizationUrl?: string | null;
    holdExpiresAt?: string | null;
    alreadyHeld?: boolean;
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
export declare function createRideHold(input: {
    rideId: string;
    userId: string;
    amountRands: number;
    email: string;
}): Promise<RideHoldResult>;
/**
 * Captures the final fare for a completed ride — POST /api/rides/:id/complete
 * and the server-side completion hooks. NEVER marks PAID: that belongs to
 * preauthorization.capture.success (webhook), so an optimistic API response can
 * never lie about money that later fails to settle.
 */
export declare function captureRideHold(rideId: string, opts?: {
    amountRands?: number;
}): Promise<{
    paymentStatus: RidePaymentStatus;
    captured: boolean;
    alreadyProcessed?: boolean;
    capturedAmount?: number;
}>;
/**
 * Releases the hold — POST /api/rides/:id/cancel, every cancel path, and the
 * stuck-search reaper. Idempotent: PAID/RELEASED/NONE are no-ops, and
 * CAPTURE_PENDING is deliberately left alone (a capture is already racing).
 */
export declare function releaseRideHold(rideId: string, reason?: string): Promise<{
    paymentStatus: RidePaymentStatus;
    released: boolean;
    alreadyReleased?: boolean;
}>;
/**
 * Requirement: reaper for rides stuck in "searching for a driver" past the
 * window — their holds are released so nobody's money sits held forever.
 */
export declare function releaseStuckHolds(minutes?: number): Promise<number>;
export declare function startPreauthReaper(): NodeJS.Timeout;
export declare function stopPreauthReaper(timer: NodeJS.Timeout): void;
/**
 * Stores the reusable authorization_code from a successful hold so the NEXT
 * booking can use Reserve by Authorization Code without re-entering card
 * details (docs: reusable=true authorizations only, email must match).
 */
export declare function saveReusableAuthorization(userId: string, auth: {
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
}): Promise<boolean>;
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
export declare function recordWebhookEventOnce(event: string, data: any, ref: string): Promise<boolean>;
/**
 * Applies one verified Paystack preauthorization event to the ride it belongs
 * to. Called ONLY from /api/paystack/webhook after the signature check.
 *
 * Every transition is a guarded UPDATE (…WHERE payment_status = 'the state we
 * expect'), so a late, out-of-order or replayed event changes nothing — that,
 * plus the paystack_webhook_events primary key, is the idempotency contract.
 */
export declare function handlePreauthorizationEvent(event: string, payload: any): Promise<WebhookHandleResult>;
//# sourceMappingURL=preauthorization.d.ts.map
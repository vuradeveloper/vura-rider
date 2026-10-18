export interface PayLaterConfig {
    ridesToUnlock: number;
    creditLimitR: number;
    limitStepR: number;
    ridesPerStep: number;
    capR: number;
    ridesToRepay: number;
    repayPerRideR: number;
    retryDays: number[];
    autoDebitThresholdR: number;
    workerIntervalMs: number;
}
export declare function payLaterConfig(): PayLaterConfig;
/** Credit ladder: 0 below the unlock threshold, then +limitStepR every
 *  ridesPerStep rides, capped. The flat configured limit is the step-0 value. */
export declare function computeCreditLimit(completedRides: number): number;
export declare function ensurePayLaterTables(): Promise<void>;
/**
 * Counts completed rides that paid with the rider's CURRENT saved card:
 *   • provenance match — rides.card_auth_code (stamped by the preauth capture
 *     webhook and the saved-card charge path) equals saved_cards.transaction_index;
 *   • grandfather — pre-feature card rides carry no provenance and count
 *     (they WERE card-paid; a ride paid by a DIFFERENT known card never counts);
 *   • anti ride-farming — a (rider, driver) pair used ≥5 completed times is
 *     excluded entirely (kept from v1).
 * With no saved card the provenance match is empty → only grandfathered
 * rides count (the brief's "one card" rule still holds once a card exists).
 */
export declare function countUnlockRides(dbUserId: string): Promise<number>;
/** v1 counter (any completed ride, no card provenance) — kept exported for
 *  compatibility; eligibility/ladder use countUnlockRides. */
export declare function countCompletedRides(dbUserId: string): Promise<number>;
/** outstanding = Σ debits − Σ CONFIRMED credits (pending/failed credits never
 *  reduce the balance — the brief's webhook-confirmation rule). */
export declare function ledgerOutstanding(riderId: string): Promise<number>;
export declare function hasPastDueDebit(riderId: string): Promise<boolean>;
export declare function pastDueAmount(riderId: string): Promise<number>;
export declare function getPayLaterEligibility(dbUserId: string): Promise<{
    enrolled: boolean;
    status: any;
    unlocked: boolean;
    rides_completed: number;
    rides_required: number;
    progress_pct: number;
    limit_r: number;
    outstanding_r: number;
    available_r: number;
    past_due: boolean;
    past_due_r: number;
    due_date: string | null;
    terms_accepted_at: any;
    auto_debit: {
        enabled: boolean;
        consent_at: any;
        threshold_r: number;
        retry_days: number[];
    };
    ride_to_repay: {
        rides_required: number;
        rides_done: number;
        rides_left: number;
        amount_per_ride_r: number;
        outstanding_r: number;
    };
    has_card: boolean;
    card_last4: string | null;
    ride_breakdown: {
        total_completed: number;
        paid_by_card: number;
        same_card: number;
        excluded_by_farm: number;
    };
}>;
export type PayLaterEligibility = Awaited<ReturnType<typeof getPayLaterEligibility>>;
/**
 * Confirms a PENDING repayment credit (Paystack charge.success) in one tx:
 * guarded pending→confirmed (second call = no-op), FIFO settlement across the
 * rider's oldest open debits, mirror recompute, attempt log flipped to success.
 */
export declare function confirmRepaymentReference(reference: string): Promise<{
    confirmed: boolean;
    amount?: number;
    riderId?: string;
    detail?: string;
}>;
/** Marks a pending credit failed (charge.failed webhook) + flips the attempt
 *  log — money never moved, so the balance stays untouched. */
export declare function markRepaymentFailed(reference: string, reason: string): Promise<{
    failed: boolean;
    riderId?: string;
}>;
/** Any repayment still awaiting its webhook? Used to prevent double-charges
 *  (double-tap, or manual repay racing an auto-debit). */
export declare function findPendingRepayment(riderId: string): Promise<string | null>;
export interface EnrollInput {
    accountHolder?: string;
    bankCode?: string;
    accountNumber?: string;
    cardToken?: string;
    identityFingerprint?: string;
    deviceId?: string;
}
/**
 * v1 UPGRADE: card-first enrollment — ONE saved card is the repayment rail
 * (the bank mandate is gone; it never ran outside mock). Bank fields remain
 * accepted for fingerprint/back-compat with the old screen. Gate = same-card
 * unlock rides (mock mode bypasses so the flow stays testable).
 */
export declare function enrollPayLater(dbUserId: string, input: EnrollInput): Promise<{
    account: any;
    mandate: {
        token: null;
        bankVerified: boolean;
    };
    card: {
        verified: boolean;
        holdReference: string;
    };
    completed_rides: number;
    mode: import("./paystackPayment").PaymentsMode;
}>;
/** Records the rider's explicit acceptance of the Pay Later terms (required
 *  by the booking guard before any pay-later ride). First acceptance wins. */
export declare function acceptPayLaterTerms(dbUserId: string): Promise<{
    terms_accepted_at: any;
}>;
/**
 * Take-a-pay-later-ride preflight (the app calls this before booking; the
 * socket booking guard re-checks server-side — never trust the client):
 * active account → terms accepted → NOT past due → fare fits available credit.
 */
export declare function takePayLaterRide(dbUserId: string, estimatedFareR: number): Promise<{
    approved: true;
    limit_r: number;
    outstanding_r: number;
    available_r: number;
    due_date: Date | null;
    terms_accepted_at: any;
}>;
export declare function getPayLaterStatus(dbUserId: string): Promise<{
    enrolled: boolean;
    mode: import("./paystackPayment").PaymentsMode;
    eligibility: {
        enrolled: boolean;
        status: any;
        unlocked: boolean;
        rides_completed: number;
        rides_required: number;
        progress_pct: number;
        limit_r: number;
        outstanding_r: number;
        available_r: number;
        past_due: boolean;
        past_due_r: number;
        due_date: string | null;
        terms_accepted_at: any;
        auto_debit: {
            enabled: boolean;
            consent_at: any;
            threshold_r: number;
            retry_days: number[];
        };
        ride_to_repay: {
            rides_required: number;
            rides_done: number;
            rides_left: number;
            amount_per_ride_r: number;
            outstanding_r: number;
        };
        has_card: boolean;
        card_last4: string | null;
        ride_breakdown: {
            total_completed: number;
            paid_by_card: number;
            same_card: number;
            excluded_by_farm: number;
        };
    };
    account?: undefined;
    completed_rides?: undefined;
    rides?: undefined;
} | {
    enrolled: boolean;
    mode: import("./paystackPayment").PaymentsMode;
    account: {
        id: any;
        status: any;
        credit_limit: number;
        outstanding: number;
        available: number;
        account_number_masked: any;
        bank_code: any;
        card_token: any;
        terms_accepted_at: any;
        auto_debit_enabled: boolean;
        auto_debit_consent_at: any;
        repay_ride_count: number;
    };
    completed_rides: number;
    rides: any[];
    eligibility: {
        enrolled: boolean;
        status: any;
        unlocked: boolean;
        rides_completed: number;
        rides_required: number;
        progress_pct: number;
        limit_r: number;
        outstanding_r: number;
        available_r: number;
        past_due: boolean;
        past_due_r: number;
        due_date: string | null;
        terms_accepted_at: any;
        auto_debit: {
            enabled: boolean;
            consent_at: any;
            threshold_r: number;
            retry_days: number[];
        };
        ride_to_repay: {
            rides_required: number;
            rides_done: number;
            rides_left: number;
            amount_per_ride_r: number;
            outstanding_r: number;
        };
        has_card: boolean;
        card_last4: string | null;
        ride_breakdown: {
            total_completed: number;
            paid_by_card: number;
            same_card: number;
            excluded_by_farm: number;
        };
    };
}>;
export declare function refreshPayLaterLimit(dbUserId: string): Promise<{
    account: any;
    completed_rides: number;
}>;
export interface RepayResult {
    success: boolean;
    status: "confirmed" | "pending";
    reference: string;
    amount: number;
    message?: string;
    account?: {
        credit_limit: number;
        outstanding: number;
        available: number;
    };
}
/**
 * "Pay what I owe" — charges the rider's SAVED CARD (Paystack
 * charge_authorization) for `amountRands` (default: the full balance).
 *
 * Per the brief the LEDGER only changes when Paystack's webhook confirms:
 *   sandbox/live → charge accepted → credit row 'pending' → charge.success
 *                  webhook confirms it (confirmRepaymentReference);
 *   mock         → confirmed inline (no webhooks in mock);
 *   mock fail    → PAYMENTS_MOCK_FAIL_COLLECT=1 simulates a decline (the
 *                  dev switch the v1 tooling already used).
 * A repayment already awaiting its webhook blocks a second charge (no
 * double-tap, no manual-vs-auto race).
 */
export declare function repayWithCard(dbUserId: string, opts?: {
    amountRands?: number;
    rideId?: string | null;
}): Promise<RepayResult>;
/**
 * Legacy per-ride repayment route (POST /pay-later/:rideId/pay) — kept for the
 * old screen, now charging the card through the SAME webhook-confirmed flow
 * (v1 used to decrement the balance without ever moving money).
 */
export declare function payRideWithPayLater(dbUserId: string, rideId: string): Promise<{
    success: boolean;
    alreadyPaid: boolean;
    status?: undefined;
    reference?: undefined;
    amount_paid?: undefined;
    message?: undefined;
    account?: undefined;
} | {
    success: boolean;
    status: "pending" | "confirmed";
    reference: string;
    amount_paid: number;
    message: string | undefined;
    account: {
        credit_limit: number;
        outstanding: number;
        available: number;
    } | undefined;
    alreadyPaid?: undefined;
}>;
/** Auto-debit toggle with explicit consent (brief: opt-in, revocable). */
export declare function setPayLaterAutoDebit(dbUserId: string, enabled: boolean): Promise<{
    enabled: boolean;
    consent_at: any;
}>;
/**
 * Books the debt when a pay-later ride COMPLETES: one ledger debit (unique per
 * ride+source), mirror recompute, due date (month-end, like v1), ride marked
 * payment_status='pending'. Returns true when THIS call created the debit.
 */
export declare function registerPayLaterDebit(rideId: string): Promise<boolean>;
/**
 * Ride-to-repay: every PAY_LATER_RIDES_TO_REPAY completed rides (while a
 * balance is owed) clears PAY_LATER_REPAY_PER_RIDE_R — a PART of the balance,
 * never the whole debt (the brief's assumption #2). Idempotent per ride via
 * the (ride_id, source) unique index; the cycle counter only advances when
 * this ride hasn't counted yet.
 */
export declare function applyRideToRepay(rideId: string): Promise<void>;
/** Single completion entry point — call from every ride-completion path.
 *  Fire-and-forget safe: never breaks the completion itself. */
export declare function onRideCompletedPayLater(rideId: string): Promise<void>;
export declare function simulatePayLaterRide(dbUserId: string, rideId: string): Promise<{
    rideId: string;
    booked: boolean;
    due_at: string | Date;
    account: {
        credit_limit: number;
        outstanding: number;
        available: number;
    };
}>;
export interface CollectionSummary {
    attempted: number;
    succeeded: number;
    pending: number;
    failed: number;
    overdue: number;
    details: {
        rideId: string | null;
        attempt: number;
        result: string;
        overdue: boolean;
    }[];
}
/**
 * Charges consented riders' saved cards for what they owe, on their due date:
 *   • EVERY attempt is logged (payment_collections, provider='paystack') — brief;
 *   • retries follow PAY_LATER_RETRY_DAYS after the due date (day 1/3/7 by
 *     default — configurable, bounded: after the last retry fails the account
 *     goes overdue → frozen + identity-blacklisted (v1 safety policy) and the
 *     rider is PUSH-notified;
 *   • success = charge accepted → PENDING credit; the charge.success WEBHOOK
 *     confirms it into the ledger (never the API call itself);
 *   • a pending repayment blocks another charge (no double-debits);
 *   • auto-debit requires the rider's opt-in consent (auto_debit_enabled).
 */
export declare function runMonthlyCollection(): Promise<CollectionSummary>;
export interface PayLaterWebhookResult {
    received: true;
    event: string;
    duplicate: boolean;
    handled: boolean;
    detail?: string;
}
/**
 * charge.success / charge.failed for PLR* references (manual + auto
 * repayments). Routed from routes/paystackWebhook.ts — the same
 * signature-verified pipe as the preauthorization events. Idempotency:
 * paystack_webhook_events PK (shared via recordWebhookEventOnce) + the credit
 * row's unique reference + guarded pending→confirmed/failed UPDATEs.
 * Other charge.* references (card registration, legacy ride charges) are
 * acknowledged but ignored.
 */
export declare function handlePayLaterChargeWebhook(event: string, payload: any): Promise<PayLaterWebhookResult>;
/**
 * Scheduled auto-debit pass (repayment option b): runs the collection job
 * every PAY_LATER_WORKER_INTERVAL_MS (default 6h) + once shortly after boot
 * (catch-up after deploys/restarts, same pattern as cleanupStaleRides).
 */
export declare function startPayLaterWorker(): NodeJS.Timeout;
export declare function stopPayLaterWorker(): void;
//# sourceMappingURL=PayLaterService.d.ts.map
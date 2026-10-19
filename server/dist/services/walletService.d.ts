export interface WalletConfig {
    /** Platform commission on the fare, percent (spec default 10). */
    commission_pct: number;
    /** VAT slice INSIDE the commission, percent of the commission (SA 15). */
    vat_pct: number;
    /** Fallback Paystack fee, percent of fare — used when the webhook omits it. */
    paystack_fee_fallback_pct: number;
    /** Cash rides are blocked once the balance is BELOW -limit (rands). */
    negative_limit_rand: number;
}
export declare const DEFAULT_WALLET_CONFIG: WalletConfig;
export declare function toCents(rands: number): number;
export declare function toRands(cents: number): number;
/** Cash rides blocked at exactly this balance threshold (cents). */
export declare function cashBlockThresholdCents(cfg: WalletConfig): number;
export declare function ensureWalletTables(): Promise<void>;
/** Stored config merged over defaults — never throws. */
export declare function getWalletConfig(): Promise<WalletConfig>;
/** Validate + persist (console-tunable). Throws on bad input. */
export declare function putWalletConfig(patch: Partial<WalletConfig>, actorId?: string | null): Promise<WalletConfig>;
export interface CommissionSplit {
    fare_cents: number;
    commission_cents: number;
    vat_cents: number;
    paystack_fee_cents: number;
    margin_cents: number;
    /** What the driver earns (the card credit / ride net). */
    net_cents: number;
}
/**
 * The 10% split (pure — unit-tested). Commission is VAT-INCLUSIVE (SA model):
 * the VAT slice is carved OUT of our commission, never added on top of the
 * driver. The Paystack fee is also paid from our commission (assumption A);
 * margin is whatever remains — recorded honestly even when ≤ 0 on tiny fares.
 */
export declare function commissionSplit(fareRands: number, cfg: WalletConfig, paystackFeeCents?: number | null): CommissionSplit;
/** True when the wallet ledger exists (migration ran / self-heal created it). */
export declare function walletLedgerReady(): Promise<boolean>;
/** The driver's balance in cents (0 when no wallet row yet). */
export declare function getBalanceCents(driverId: string): Promise<number>;
/**
 * Cash rides blocked below the configured negative limit; card rides are
 * ALWAYS allowed (they are how the driver recovers). Pure-ish decision used
 * by acceptRide AND covered by unit tests.
 */
export declare function cashRideBlocked(balanceCents: number, cfg: WalletConfig): boolean;
/**
 * Ride completion entry — THE hook the completion handler calls.
 *   • card / pay_later → card_credit_pending (+net), waits for the webhook;
 *   • cash             → commission_debit (−commission), posted now.
 * Idempotent: the (ride_id, type) unique makes a re-fired completion a no-op.
 * Also keeps driver_earnings truthful for the admin Money screen (gross /
 * real commission as fee / net).
 */
export declare function recordRideCompletion(driverId: string, rideId: string, fareRands: number, paymentMethod: string, paystackFeeCents?: number | null): Promise<void>;
/**
 * THE webhook confirm (preauthorization.capture.success): promote the ride's
 * pending card credit to posted and move the money. Idempotent — the
 * `WHERE status = 'pending'` guard makes a duplicate delivery a no-op, and a
 * ride whose entry is missing (legacy, captured without completion) posts a
 * catch-up credit so the driver is never under-paid.
 */
export declare function confirmCardRideCredit(driverId: string, rideId: string, paystackFeeCents?: number | null): Promise<void>;
/**
 * The ride ended WITHOUT completing (cancelled / capture failed / refunded):
 * void a pending card credit; reverse already-posted ride entries ONCE
 * (append-only audit — reversals reference the original rows).
 */
export declare function closeRideWalletEntries(rideId: string, reason: string): Promise<void>;
/** Successful payout → posted ledger debit (idempotent per payout id). */
export declare function recordPayoutDebit(driverId: string, payoutId: string, amountRands: number): Promise<void>;
export interface WalletViewEntry {
    id: string;
    ride_id: string | null;
    type: string;
    status: string;
    amount_cents: number;
    balance_after_cents: number;
    commission_cents: number;
    created_at: string;
    payment_method: string | null;
    fare_rands: number | null;
}
/** Balance + the ride list the driver's wallet page renders (§5). */
export declare function getWalletView(driverId: string): Promise<{
    balance_cents: number;
    commission_pct: number;
    entries: WalletViewEntry[];
}>;
/**
 * Backfill — seed the ledger from completed rides for drivers who predate
 * the wallet. Idempotent: a driver who already has ONE ledger row is never
 * re-seeded (that is the whole guard — rerunning can't double-credit).
 */
export declare function backfillDriverLedger(driverId: string): Promise<void>;
//# sourceMappingURL=walletService.d.ts.map
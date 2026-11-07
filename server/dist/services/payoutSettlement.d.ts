/**
 * Payout settlement shared by POST /api/payouts/request and the Paystack
 * transfer webhook. The request path only knows the immediate API answer
 * (`success` / `pending` / `failed`); Paystack later confirms the final state
 * with transfer.success / transfer.failed / transfer.reversed.
 */
export interface PayoutRow {
    id: string;
    driver_id: string;
    amount: number | string;
    status: string;
    reference: string | null;
    transfer_code: string | null;
}
/**
 * A payout is final and successful: mark the oldest unpaid earnings as paid
 * and post the wallet debit. Both steps are idempotent per payout id.
 */
export declare function markPayoutEarningsPaid(payout: PayoutRow): Promise<void>;
/**
 * Handle Paystack transfer webhooks. Returns a small JSON object for the
 * webhook response; a missing payout is acknowledged but ignored (Paystack
 * sends every transfer on the account, including ones not created by Vura).
 */
export declare function handleTransferEvent(event: string, payload: any): Promise<any>;
//# sourceMappingURL=payoutSettlement.d.ts.map
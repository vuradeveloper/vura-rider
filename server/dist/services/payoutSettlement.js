"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markPayoutEarningsPaid = markPayoutEarningsPaid;
exports.handleTransferEvent = handleTransferEvent;
const database_1 = require("../config/database");
const walletService_1 = require("./walletService");
/**
 * A payout is final and successful: mark the oldest unpaid earnings as paid
 * and post the wallet debit. Both steps are idempotent per payout id.
 */
async function markPayoutEarningsPaid(payout) {
    const amountRands = Number(payout.amount) || 0;
    try {
        const toPay = await (0, database_1.query)(`SELECT de.id, COALESCE(de.net_amount, 0)::float AS net FROM driver_earnings de
       LEFT JOIN driver_earnings_paid dep ON dep.earning_id = de.id
       WHERE de.driver_id = $1 AND dep.earning_id IS NULL
       ORDER BY de.created_at ASC`, [payout.driver_id]);
        let remaining = amountRands;
        for (const e of toPay || []) {
            if (remaining <= 0)
                break;
            await (0, database_1.execute)(`INSERT INTO driver_earnings_paid (earning_id, payout_id) VALUES ($1, $2)
         ON CONFLICT (earning_id) DO NOTHING`, [e.id, payout.id]).catch(() => undefined);
            remaining -= Math.min(Number(e.net) || 0, remaining);
        }
    }
    catch (err) {
        console.warn("Mark-paid earnings error:", err);
    }
    try {
        await (0, walletService_1.recordPayoutDebit)(payout.driver_id, payout.id, amountRands);
    }
    catch (err) {
        console.warn(`[wallet] payout debit failed payout=${payout.id}:`, err?.message || err);
    }
}
/**
 * Handle Paystack transfer webhooks. Returns a small JSON object for the
 * webhook response; a missing payout is acknowledged but ignored (Paystack
 * sends every transfer on the account, including ones not created by Vura).
 */
async function handleTransferEvent(event, payload) {
    const data = payload?.data || {};
    const reference = String(data.reference || "");
    const transferCode = String(data.transfer_code || "");
    if (!reference && !transferCode) {
        return { received: true, event, handled: false, detail: "no reference" };
    }
    const row = await (0, database_1.queryOne)(`SELECT id, driver_id, amount, status, reference, transfer_code
       FROM payouts
      WHERE ($1 <> '' AND reference = $1)
         OR ($2 <> '' AND transfer_code = $2)
      ORDER BY created_at DESC
      LIMIT 1`, [reference, transferCode]).catch(() => null);
    if (!row) {
        return { received: true, event, handled: false, detail: "payout not found" };
    }
    const target = event === "transfer.success"
        ? "success"
        : event === "transfer.failed"
            ? "failed"
            : event === "transfer.reversed"
                ? "reversed"
                : null;
    if (!target) {
        return { received: true, event, handled: false, detail: "unsupported transfer event" };
    }
    if (row.status === target) {
        return { received: true, event, handled: true, duplicate: true, payout: row.id, status: target };
    }
    const message = data.message || data.gateway_response || (target === "success" ? "Transfer successful" : "Transfer failed");
    await (0, database_1.execute)(`UPDATE payouts
        SET status = $2,
            transfer_code = COALESCE(NULLIF($3, ''), transfer_code),
            message = $4,
            updated_at = NOW()
      WHERE id = $1`, [row.id, target, transferCode, String(message)]).catch(() => { });
    if (target === "success") {
        await markPayoutEarningsPaid({ ...row, status: "success", transfer_code: transferCode || row.transfer_code });
    }
    else if (row.status === "success") {
        // The money already left the Paystack balance and was debited from the
        // driver's wallet; a later failure/reversal must give it back exactly once.
        await (0, walletService_1.recordPayoutReversal)(row.driver_id, row.id, Number(row.amount) || 0);
    }
    return {
        received: true,
        event,
        handled: true,
        payout: row.id,
        previous: row.status,
        status: target,
    };
}
//# sourceMappingURL=payoutSettlement.js.map
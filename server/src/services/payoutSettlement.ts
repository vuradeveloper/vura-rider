import { query, queryOne, execute } from "../config/database";
import { recordPayoutDebit, recordPayoutReversal } from "./walletService";

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
export async function markPayoutEarningsPaid(payout: PayoutRow): Promise<void> {
  const amountRands = Number(payout.amount) || 0;
  try {
    const toPay = await query<{ id: string; net: number }>(
      `SELECT de.id, COALESCE(de.net_amount, 0)::float AS net FROM driver_earnings de
       LEFT JOIN driver_earnings_paid dep ON dep.earning_id = de.id
       WHERE de.driver_id = $1 AND dep.earning_id IS NULL
       ORDER BY de.created_at ASC`,
      [payout.driver_id]
    );
    let remaining = amountRands;
    for (const e of toPay || []) {
      if (remaining <= 0) break;
      await execute(
        `INSERT INTO driver_earnings_paid (earning_id, payout_id) VALUES ($1, $2)
         ON CONFLICT (earning_id) DO NOTHING`,
        [e.id, payout.id]
      ).catch(() => undefined);
      remaining -= Math.min(Number(e.net) || 0, remaining);
    }
  } catch (err) {
    console.warn("Mark-paid earnings error:", err);
  }

  try {
    await recordPayoutDebit(payout.driver_id, payout.id, amountRands);
  } catch (err: any) {
    console.warn(`[wallet] payout debit failed payout=${payout.id}:`, err?.message || err);
  }
}

/**
 * Handle Paystack transfer webhooks. Returns a small JSON object for the
 * webhook response; a missing payout is acknowledged but ignored (Paystack
 * sends every transfer on the account, including ones not created by Vura).
 */
export async function handleTransferEvent(event: string, payload: any): Promise<any> {
  const data = payload?.data || {};
  const reference = String(data.reference || "");
  const transferCode = String(data.transfer_code || "");
  if (!reference && !transferCode) {
    return { received: true, event, handled: false, detail: "no reference" };
  }

  const row = await queryOne<PayoutRow>(
    `SELECT id, driver_id, amount, status, reference, transfer_code
       FROM payouts
      WHERE ($1 <> '' AND reference = $1)
         OR ($2 <> '' AND transfer_code = $2)
      ORDER BY created_at DESC
      LIMIT 1`,
    [reference, transferCode]
  ).catch(() => null);

  if (!row) {
    return { received: true, event, handled: false, detail: "payout not found" };
  }

  const target =
    event === "transfer.success"
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

  const message =
    data.message || data.gateway_response || (target === "success" ? "Transfer successful" : "Transfer failed");

  await execute(
    `UPDATE payouts
        SET status = $2,
            transfer_code = COALESCE(NULLIF($3, ''), transfer_code),
            message = $4,
            updated_at = NOW()
      WHERE id = $1`,
    [row.id, target, transferCode, String(message)]
  ).catch(() => {});

  if (target === "success") {
    await markPayoutEarningsPaid({ ...row, status: "success", transfer_code: transferCode || row.transfer_code });
  } else if (row.status === "success") {
    // The money already left the Paystack balance and was debited from the
    // driver's wallet; a later failure/reversal must give it back exactly once.
    await recordPayoutReversal(row.driver_id, row.id, Number(row.amount) || 0);
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

// ─────────────────────────────────────────────────────────────────────────────
// creditReconciler — settles or voids card credits that were left PENDING.
//
// The happy path is:
//   ride completes → wallet_ledger(card_credit_pending, status='pending')
//                  → capture the preauthorization
//                  → Paystack webhook "preauthorization.capture.success"
//                  → confirmCardRideCredit() promotes pending → posted
//
// If ANY link in that chain breaks, the driver's receipt says "Waiting for
// Paystack to settle" forever: nothing retries and nothing times out. Seen in
// production on 03 Nov 2026 (ride b38b7f3b…): the booking hold had never been
// created, so capture threw `no_hold`, the caller only logged a warning, and the
// pending credit stayed orange indefinitely.
//
// This worker closes every one of those gaps by re-deriving the truth from the
// ride row every few minutes:
//
//   ride cancelled                    → void the pending credit
//   captured / paid / capture_pending → post it (webhook was lost)
//   HOLD_ACTIVE                       → capture now, then post
//   HOLD_PENDING (rider abandoned)    → void after HOLD_ABANDON_HOURS
//   no hold / released / expired      → void (no money was ever held)
//
// Every action goes through the SAME idempotent functions the webhook uses, so a
// duplicate run (or a webhook arriving at the same moment) is a no-op.
//
// Safety: CREDIT_RECONCILE_DRY_RUN=1 logs what it WOULD do and changes nothing.
// ─────────────────────────────────────────────────────────────────────────────

import { query } from "../config/database";
import { captureRideHold } from "./preauthorization";
import { confirmCardRideCredit, closeRideWalletEntries } from "./walletService";

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000; // every 10 minutes
const DEFAULT_MIN_AGE_MIN = 30; // ignore fresh credits still in flight
const HOLD_ABANDON_HOURS = 6; // HOLD_PENDING older than this = rider gave up
const BATCH_LIMIT = 100;

function envInt(name: string, fallback: number, min = 0): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
}

function envBool(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v == null || v === "") return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

interface PendingRow {
  ride_id: string;
  driver_id: string;
  amount_cents: number;
  created_at: string;
  ride_status: string | null;
  payment_status: string | null;
  preauth_reference: string | null;
}

type Action =
  | "post"
  | "capture_then_post"
  | "void_cancelled"
  | "void_no_hold"
  | "void_abandoned"
  | "skip";

/** Decide what should happen to one pending credit. Pure and testable. */
export function decideAction(row: PendingRow, nowMs: number): Action {
  const st = String(row.payment_status || "").toUpperCase();
  const ride = String(row.ride_status || "").toLowerCase();

  if (ride === "cancelled") return "void_cancelled";

  // Money is already (or is about to be) captured — the webhook was lost.
  if (st === "PAID" || st === "CAPTURED" || st === "CAPTURE_PENDING") return "post";

  // Funds are held and the ride completed: capture, then post.
  if (st === "HOLD_ACTIVE") return "capture_then_post";

  // Hold exists but the rider never finished the secure page. Give them a
  // window, then close it — otherwise the receipt is orange forever.
  if (st === "HOLD_PENDING") {
    const ageH = (nowMs - new Date(row.created_at).getTime()) / 3_600_000;
    return ageH >= HOLD_ABANDON_HOURS ? "void_abandoned" : "skip";
  }

  // Nothing was ever held: NONE / RELEASED / HOLD_EXPIRED / FAILED, or no
  // reference at all. There is no money to capture.
  if (!row.preauth_reference) return "void_no_hold";
  return "void_no_hold";
}

export async function reconcileOnce(): Promise<{
  scanned: number;
  posted: number;
  captured: number;
  voided: number;
  skipped: number;
  failed: number;
}> {
  const dry = envBool("CREDIT_RECONCILE_DRY_RUN", false);
  const minAge = envInt("CREDIT_RECONCILE_MIN_AGE_MIN", DEFAULT_MIN_AGE_MIN, 0);
  const stats = { scanned: 0, posted: 0, captured: 0, voided: 0, skipped: 0, failed: 0 };

  const rows = await query(
    `SELECT w.ride_id, w.driver_id, w.amount_cents, w.created_at,
            r.status AS ride_status,
            r.payment_status,
            r.preauth_reference
       FROM wallet_ledger w
       JOIN rides r ON r.id = w.ride_id
      WHERE w.type = 'card_credit_pending'
        AND w.status = 'pending'
        AND w.created_at < NOW() - ($1::int * INTERVAL '1 minute')
      ORDER BY w.created_at ASC
      LIMIT ${BATCH_LIMIT}`,
    [minAge]
  ).catch(() => null);

  const list: PendingRow[] = ((rows as PendingRow[]) || []);
  stats.scanned = list.length;

  for (const row of list) {
    const now = Date.now();
    const action = decideAction(row, now);
    const tag = `[reconcile] ride=${row.ride_id} status=${row.payment_status} action=${action}`;

    try {
      if (action === "skip") {
        stats.skipped++;
        continue;
      }
      if (dry) {
        console.log(`${tag} (dry-run — no change)`);
        stats.skipped++;
        continue;
      }

      switch (action) {
        case "post": {
          await confirmCardRideCredit(row.driver_id, row.ride_id);
          console.log(`${tag} posted`);
          stats.posted++;
          break;
        }
        case "capture_then_post": {
          // Idempotent: an already-captured hold returns alreadyProcessed.
          const res = await captureRideHold(row.ride_id);
          if (res?.captured || res?.alreadyProcessed) {
            await confirmCardRideCredit(row.driver_id, row.ride_id);
            console.log(`${tag} captured=${res?.captured} then posted`);
            stats.captured++;
            stats.posted++;
          } else {
            // Not captured yet (Paystack queued it). Leave it for the next pass;
            // the webhook, when it lands, posts it.
            console.log(`${tag} capture queued (payment_status=${res?.paymentStatus})`);
            stats.skipped++;
          }
          break;
        }
        case "void_cancelled":
          await closeRideWalletEntries(row.ride_id, "reconcile_cancelled");
          console.log(`${tag} voided (ride cancelled)`);
          stats.voided++;
          break;
        case "void_abandoned":
          await closeRideWalletEntries(row.ride_id, "reconcile_abandoned_hold");
          console.log(`${tag} voided (checkout abandoned)`);
          stats.voided++;
          break;
        case "void_no_hold":
          await closeRideWalletEntries(row.ride_id, "reconcile_no_hold");
          console.log(`${tag} voided (no money was ever held)`);
          stats.voided++;
          break;
        default:
          stats.skipped++;
      }
    } catch (e: any) {
      stats.failed++;
      // A stale hold that Paystack has already expired is not an error: the
      // next pass will see RELEASED/HOLD_EXPIRED and void it.
      console.warn(`${tag} failed:`, e?.message || e);
    }
  }

  if (stats.scanned > 0) {
    console.log(
      `[reconcile] scanned=${stats.scanned} posted=${stats.posted} captured=${stats.captured} ` +
        `voided=${stats.voided} skipped=${stats.skipped} failed=${stats.failed}${dry ? " (DRY RUN)" : ""}`
    );
  }
  return stats;
}

let running = false;

export function startCreditReconciler(): void {
  const intervalMs = envInt("CREDIT_RECONCILE_INTERVAL_MS", DEFAULT_INTERVAL_MS, 60_000);

  const tick = async () => {
    if (running) return; // never overlap two passes
    running = true;
    try {
      await reconcileOnce();
    } catch (e: any) {
      console.warn("[reconcile] pass failed:", e?.message || e);
    } finally {
      running = false;
    }
  };

  // Catch up shortly after boot (the deploy that fixes a stuck receipt should
  // settle it without waiting a full interval).
  setTimeout(() => {
    void tick();
  }, 90_000);
  setInterval(() => {
    void tick();
  }, intervalMs).unref?.();

  console.log(
    `[reconcile] credit reconciler started (every ${Math.round(intervalMs / 60_000)} min, ` +
      `min age ${envInt("CREDIT_RECONCILE_MIN_AGE_MIN", DEFAULT_MIN_AGE_MIN, 0)} min` +
      `${envBool("CREDIT_RECONCILE_DRY_RUN", false) ? ", DRY RUN" : ""})`
  );
}

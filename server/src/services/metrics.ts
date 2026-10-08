// ─────────────────────────────────────────────────────────────────────────────
// DISPATCH COUNTERS — the five numbers that answer "is Module 1 healthy?"
// without grepping logs.
//
//   upsert_failures   driver_cells index writes that failed (GPS still saved;
//                     matching quietly falls back to haversine for that driver)
//   h3_path_failures  flag-on requests where the H3 path THREW (haversine
//                     carried the request — see trace stage h3_path_failed)
//   fallback_used     flag-on requests served by the old path (throw, cold
//                     index, empty cells — the rollout guard working)
//   offer_driver_busy offers skipped because the driver already held a pending
//                     offer for another ride (001b unique index)
//   no_drivers        rides parked with a rider-facing "no drivers"
//
// In-memory and per-process: EB instances each have their own, which is fine
// for a debug endpoint (you watch one instance at a time). NEVER throws —
// metrics must not be able to break dispatch.
// ─────────────────────────────────────────────────────────────────────────────

export type CounterName =
  | "upsert_failures"
  | "h3_path_failures"
  | "fallback_used"
  | "offer_driver_busy"
  | "no_drivers"
  // ── Offer delivery hardening ──
  | "offer_socket_down" // offers sent while the driver's socket room was EMPTY
  | "push_delivered_zero" // a push answered "delivered to 0 devices" (or failed)
  | "offer_undeliverable" // offers skipped instantly: socket down AND push 0
  | "offer_acked" // device confirmed the offer rendered (driver:ride:offer:ack)
  | "offer_not_acked" // an offer that closed without ever being acknowledged
  // ── Module 2: destination mode ──
  | "destination_activated" // successful Set-Destination (session row created)
  | "destination_filtered" // candidates removed by the destinationFit predicate
  | "destination_predicate_error" // destinationFit threw — driver skipped, ride served
  | "destination_ended"; // sessions closed by the auto-end sweep

import { hostname } from "os";

const counters: Record<CounterName, number> = {
  upsert_failures: 0,
  h3_path_failures: 0,
  fallback_used: 0,
  offer_driver_busy: 0,
  no_drivers: 0,
  offer_socket_down: 0,
  push_delivered_zero: 0,
  offer_undeliverable: 0,
  offer_acked: 0,
  offer_not_acked: 0,
  destination_activated: 0,
  destination_filtered: 0,
  destination_predicate_error: 0,
  destination_ended: 0,
};

/** Increment a counter (in-memory, sync, infallible). */
export function bump(name: CounterName): void {
  try {
    counters[name] += 1;
  } catch {
    /* never throws */
  }
}

/** Snapshot for the debug endpoints. Counters are PER INSTANCE (one EB
 * instance has its own memory); `instance` names the host and `started_at`
 * says when this process's counters began — both reset on redeploy. */
export function getCounters(): Record<CounterName, number> & {
  instance: string;
  started_at: string;
} {
  let host = "unknown";
  try {
    host = hostname();
  } catch {
    /* keep unknown */
  }
  return { ...counters, instance: host, started_at: startedAt };
}

const startedAt = new Date().toISOString();

/** Test seam. */
export function resetCounters(): void {
  (Object.keys(counters) as CounterName[]).forEach((k) => (counters[k] = 0));
}

// ── Rate-limited error logging ───────────────────────────────────────────────
// A driver whose upsert fails on every 15s ping would otherwise print one line
// per ping forever. Keyed (default per driver_id), logged at most once per
// THROTTLE_MS per key; the counter still counts EVERY failure.
const THROTTLE_MS = 60_000;
const lastLogged = new Map<string, number>();

export function rateLimitedLog(key: string, message: string): boolean {
  const now = Date.now();
  const last = lastLogged.get(key) ?? 0;
  if (now - last < THROTTLE_MS) return false;
  lastLogged.set(key, now);
  // Bound the map: a key nobody re-fails should not be remembered forever.
  if (lastLogged.size > 2000) {
    const cutoff = now - THROTTLE_MS;
    for (const [k, t] of lastLogged) if (t < cutoff) lastLogged.delete(k);
  }
  console.warn(message);
  return true;
}

/**
 * A driver_cells index write failed. GPS itself was already saved — this only
 * costs H3 indexing for that driver — so: count it, and say it at most once a
 * minute per driver instead of once per ping.
 */
export function noteIndexUpsertFailure(driverId: string, err: any): void {
  try {
    bump("upsert_failures");
    rateLimitedLog(
      `upsert:${driverId}`,
      `[driverIndex] upsert failed driver=${driverId} (counted; further failures for this driver logged ≤1/min): ${err?.message ?? err}`
    );
  } catch {
    /* never throws */
  }
}

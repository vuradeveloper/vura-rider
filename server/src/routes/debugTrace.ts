// ─────────────────────────────────────────────────────────────────────────────
// GET /debug/trips/:id/trace — ADMIN-ONLY per-trip dispatch trace.
//
// Answers "where did the time go" for ONE trip, with the stages from the
// debugging brief: request_received, trip_saved, dispatch_started,
// drivers_found(count), offer_sent, the delivery ack, driver_response.
//
// AUTH: a real Firebase bearer token (requireAuth) whose email is in
// ADMIN_EMAILS — the same gate admin.ts uses. No shared query key like the
// /api/dev/dispatch inspector; this endpoint is never open.
//
// NOTE ON STAGE NAMES: the brief calls the delivery ack `offer_acked`; the
// implementation has always written it as `offer_delivered_ack`
// (socket handler `driver:ride:offer:ack`). Both names are returned so callers
// of either spelling are served — `stage_aliases` documents the mapping and
// `offer_acked` is a boolean shorthand for it.
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { readTrace, TRACE_STAGES } from "../services/trace";
import { getCounters } from "../services/metrics";

const router = Router();

function isAdmin(req: AuthRequest): boolean {
  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase());
  return (
    admins.length > 0 &&
    !!req.user?.email &&
    admins.includes(req.user.email.toLowerCase())
  );
}

// ── PII guard ────────────────────────────────────────────────────────────────
// AUDIT (what producers actually write into ride_events.detail today):
//   trace(): trace_id, stage, at, ms_from_start, counts, driver/ride ids,
//            radius/distance numbers, channel, delivered, error strings.
//   logRideEvent(): round, count, distanceKm, expiresIn, reason, version.
//   REST request(): source, payment_method, has_pickup_coords.
// None contain names, phone numbers or addresses — the OFFER SOCKET PAYLOAD
// carries pickup_address, but that is emitted, never traced. To keep that true
// forever, every detail object is projected through this allow-dangerous-key
// blacklist before leaving the endpoint: a future trace that adds an address
// or a name gets "[redacted]" instead of leaking.
const SENSITIVE_KEY = /(address|phone|email|photo|password|token|secret|(^|_)name($|_))/i;
const REDACTED = "[redacted]";

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

// GET /debug/trips/:id/trace — admin only.
router.get("/trips/:id/trace", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  const rideId = String(req.params.id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(rideId)) {
    res.status(400).json({ error: "ride id must be a uuid" });
    return;
  }

  try {
    const traceData = await readTrace(rideId);
    // PII guard: details leave redacted (see SENSITIVE_KEY above).
    const stages = traceData.stages.map((s) => ({
      ...s,
      detail: redact(s.detail) as Record<string, unknown>,
    }));
    const seen = new Set(stages.map((s) => s.stage));
    const missing = TRACE_STAGES.filter((s) => !seen.has(s));

    // The slowest hop, so "it was slow" becomes "request->trip_saved: 1200ms".
    const slowest =
      stages
        .filter((s) => typeof s.ms_since_previous === "number")
        .sort((a, b) => (b.ms_since_previous ?? 0) - (a.ms_since_previous ?? 0))[0] ?? null;

    res.json({
      ...traceData,
      stages,
      missing_stages: missing,
      slowest_hop: slowest ? { stage: slowest.stage, ms: slowest.ms_since_previous } : null,
      offer_acked: seen.has("offer_delivered_ack"),
      stage_aliases: { offer_acked: "offer_delivered_ack" },
      complete: seen.has("driver_response"),
      // Process-wide dispatch counters (also on GET /debug/counters).
      counters: getCounters(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "trace read failed" });
  }
});

// GET /debug/counters — admin-only dispatch counters (module health at a glance):
// upsert_failures, h3_path_failures, fallback_used, offer_driver_busy,
// no_drivers. Per-process, in-memory, reset on restart.
router.get("/counters", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!isAdmin(req)) {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  res.json(getCounters());
});

export default router;

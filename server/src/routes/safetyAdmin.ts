// ─────────────────────────────────────────────────────────────────────────────
// SAFETY ADMIN API (/api/admin/v2/safety/*): /live (map rides), /rides/:id/
// track (path+anomalies+SOS, AUDITED view), /anomalies + /sos (log + inbox
// with handling), /overview (dashboard counters), /config (thresholds §1/§6).
// Reads need trips.read; writes vary per route.
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { query, queryOne } from "../config/database";
import { requireAdmin, resolveAdminActor, writeAudit } from "../services/adminAuth";
import { maskPhone } from "../lib/format";
import { getSafetySettings, putSafetySettings, type SafetySettings } from "../services/safetyConfig";
import { ridePath } from "../services/locationLog";

const router = Router();

/** AdminActor is {email, role} — resolve the users.id for handled_by columns. */
async function actorUserId(actor: { email: string }): Promise<string | null> {
  const u = await queryOne<{ id: string }>(
    "SELECT id FROM users WHERE lower(email) = lower($1)",
    [actor.email]
  ).catch(() => null);
  return u?.id ?? null;
}

// GET /safety/live — active rides for the map: endpoints, driver's current
// fix, and per-ride open-anomaly / SOS / pending-check-in counters.
router.get("/live", requireAdmin("trips.read"), async (req: AuthRequest, res: Response) => {
  try {
    const rows = await query<any>(
      `SELECT r.id, r.status, r.created_at, r.trip_started_at, r.scheduled_at,
              r.pickup_address, r.destination_address,
              r.pickup_lat, r.pickup_lng, r.destination_lat, r.destination_lng,
              r.estimated_fare, r.tier,
              pu.full_name AS rider_name, pu.phone AS rider_phone,
              du.full_name AS driver_name, du.phone AS driver_phone,
              dp.vehicle_color, dp.vehicle_make, dp.vehicle_model, dp.license_plate,
              dp.current_lat AS driver_lat, dp.current_lng AS driver_lng,
              dp.current_heading AS driver_heading,
              (SELECT COUNT(*)::int FROM ride_anomalies a
                WHERE a.ride_id = r.id
                  AND a.status IN ('new','checkin_sent','no_response','escalated')) AS open_anomalies,
              (SELECT COUNT(*)::int FROM sos_alerts s
                WHERE s.ride_id = r.id AND s.status <> 'resolved') AS open_sos,
              (SELECT COUNT(*)::int FROM ride_checkins c
                WHERE c.ride_id = r.id AND c.status = 'pending') AS pending_checkins
         FROM rides r
         LEFT JOIN users pu ON pu.id = r.passenger_id
         LEFT JOIN users du ON du.id = r.driver_id
         LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
        WHERE r.status IN ('searching','scheduled','accepted','driver_arrived','in_progress')
        ORDER BY r.created_at DESC
        LIMIT 200`
    ).catch((err: any) => {
      if (/does not exist/i.test(String(err?.message))) return [];
      throw err;
    });
    res.json({
      rides: rows.map((r: any) => ({
        ...r,
        rider_phone: maskPhone(r.rider_phone ?? null),
        driver_phone: maskPhone(r.driver_phone ?? null),
        flagged: (r.open_anomalies ?? 0) > 0 || (r.open_sos ?? 0) > 0,
        sos: (r.open_sos ?? 0) > 0,
      })),
      generated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[safety/admin] live error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /safety/rides/:id/track — follow view: travelled path, anomalies,
// check-ins, SOS. EVERY call is audit-logged (who viewed, when, which ride).
router.get("/rides/:id/track", requireAdmin("trips.read"), async (req: AuthRequest, res: Response) => {
  try {
    const actor = await resolveAdminActor(req);
    const rideId = String(req.params.id);
    const ride = await queryOne<any>(
      `SELECT r.id, r.status, r.created_at, r.trip_started_at,
              r.pickup_address, r.destination_address,
              r.pickup_lat, r.pickup_lng, r.destination_lat, r.destination_lng,
              pu.full_name AS rider_name, pu.phone AS rider_phone,
              du.full_name AS driver_name, du.phone AS driver_phone,
              dp.vehicle_color, dp.vehicle_make, dp.vehicle_model, dp.license_plate,
              dp.current_lat AS driver_lat, dp.current_lng AS driver_lng
         FROM rides r
         LEFT JOIN users pu ON pu.id = r.passenger_id
         LEFT JOIN users du ON du.id = r.driver_id
         LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
        WHERE r.id = $1`,
      [rideId]
    );
    if (!ride) { res.status(404).json({ error: "Ride not found" }); return; }

    const [points, anomalies, checkins, sos] = await Promise.all([
      ridePath(rideId).catch(() => []),
      query(`SELECT id, type, severity, data, status, note, detected_at, handled_at
               FROM ride_anomalies WHERE ride_id = $1 ORDER BY detected_at DESC`, [rideId]).catch(() => []),
      query(`SELECT id, anomaly_id, sent_at, respond_by, responded_at, response, status
               FROM ride_checkins WHERE ride_id = $1 ORDER BY sent_at DESC`, [rideId]).catch(() => []),
      query(`SELECT id, status, triggered_by_role, payload, created_at, acknowledged_at,
                    resolved_at, outcome
               FROM sos_alerts WHERE ride_id = $1 ORDER BY created_at DESC`, [rideId]).catch(() => []),
    ]);

    if (actor) {
      await writeAudit(actor, {
        action: "safety.view_location",
        entityType: "ride",
        entityId: rideId,
        newValue: { points: points.length, at: new Date().toISOString() },
      }).catch(() => { });
    }
    res.json({
      ride: { ...ride, rider_phone: maskPhone(ride.rider_phone ?? null), driver_phone: maskPhone(ride.driver_phone ?? null) },
      points,
      anomalies,
      checkins,
      sos,
    });
  } catch (err: any) {
    console.error("[safety/admin] track error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /safety/anomalies?status=new|checkin_sent|no_response|escalated|safe|…
router.get("/anomalies", requireAdmin("trips.read"), async (req: AuthRequest, res: Response) => {
  try {
    const status = typeof req.query.status === "string" && req.query.status ? req.query.status : null;
    const params: unknown[] = [];
    let where = "";
    if (status) { params.push(status); where = "WHERE a.status = $1"; }
    const rows = await query<any>(
      `SELECT a.id, a.ride_id, a.type, a.severity, a.data, a.status, a.note,
              a.detected_at, a.handled_at, a.driver_id,
              r.status AS ride_status, r.pickup_address, r.destination_address,
              du.full_name AS driver_name, dp.license_plate
         FROM ride_anomalies a
         JOIN rides r ON r.id = a.ride_id
         LEFT JOIN users du ON du.id = a.driver_id
         LEFT JOIN driver_profiles dp ON dp.user_id = a.driver_id
         ${where}
         ORDER BY a.detected_at DESC
         LIMIT 300`,
      params
    ).catch((err: any) => {
      if (/does not exist/i.test(String(err?.message))) return [];
      throw err;
    });
    res.json({ anomalies: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /safety/anomalies/:id — handle it: false_alarm (tuned away later),
// resolved (acknowledged), or a note back onto an open one.
router.patch("/anomalies/:id", requireAdmin("tickets.write"), async (req: AuthRequest, res: Response) => {
  try {
    const actor = await resolveAdminActor(req);
    if (!actor) { res.status(403).json({ error: "Admin only" }); return; }
    const status = String(req.body?.status || "");
    const note = req.body?.note != null ? String(req.body.note).slice(0, 500) : null;
    if (!["false_alarm", "resolved", "safe", "escalated", "new"].includes(status)) {
      res.status(400).json({ error: "status must be false_alarm|resolved|safe|escalated|new" });
      return;
    }
    const row = await queryOne<any>(
      `UPDATE ride_anomalies
          SET status = $2, note = COALESCE($3, note), handled_by = $4, handled_at = NOW()
        WHERE id = $1
        RETURNING id, ride_id, type, status, note`,
      [String(req.params.id), status, note, await actorUserId(actor)]
    );
    if (!row) { res.status(404).json({ error: "Anomaly not found" }); return; }
    await writeAudit(actor, {
      action: "safety.anomaly_handled",
      entityType: "ride_anomaly",
      entityId: row.id,
      newValue: { status, note },
    }).catch(() => { });
    res.json({ anomaly: row });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /safety/sos?status=active — the inbox; active first (the loud list).
router.get("/sos", requireAdmin("trips.read"), async (req: AuthRequest, res: Response) => {
  try {
    const status = typeof req.query.status === "string" && req.query.status ? req.query.status : null;
    const params: unknown[] = [];
    let where = "";
    if (status) { params.push(status); where = "WHERE s.status = $1"; }
    const rows = await query<any>(
      `SELECT s.id, s.ride_id, s.triggered_by_role, s.status, s.payload,
              s.created_at, s.acknowledged_at, s.resolved_at, s.outcome,
              u.full_name AS handler_name
         FROM sos_alerts s
         LEFT JOIN users u ON u.id = COALESCE(s.resolved_by, s.acknowledged_by)
         ${where}
         ORDER BY (s.status = 'active') DESC, s.created_at DESC
         LIMIT 200`,
      params
    ).catch((err: any) => {
      if (/does not exist/i.test(String(err?.message))) return [];
      throw err;
    });
    res.json({ alerts: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /safety/sos/:id — acknowledge, then resolve with an outcome note.
router.patch("/sos/:id", requireAdmin("tickets.write"), async (req: AuthRequest, res: Response) => {
  try {
    const actor = await resolveAdminActor(req);
    if (!actor) { res.status(403).json({ error: "Admin only" }); return; }
    const status = String(req.body?.status || "");
    const outcome = req.body?.outcome != null ? String(req.body.outcome).slice(0, 1000) : null;
    if (!["acknowledged", "resolved", "active"].includes(status)) {
      res.status(400).json({ error: "status must be acknowledged|resolved|active" });
      return;
    }
    const actorId = await actorUserId(actor);
    const row = await queryOne<any>(
      `UPDATE sos_alerts
          SET status = $2,
              acknowledged_by = CASE WHEN $2 = 'acknowledged' THEN $3 ELSE acknowledged_by END,
              acknowledged_at = CASE WHEN $2 = 'acknowledged' THEN NOW() ELSE acknowledged_at END,
              resolved_by   = CASE WHEN $2 = 'resolved' THEN $3 ELSE resolved_by END,
              resolved_at   = CASE WHEN $2 = 'resolved' THEN NOW() ELSE resolved_at END,
              outcome = COALESCE($4, outcome)
        WHERE id = $1
        RETURNING id, ride_id, status, outcome`,
      [String(req.params.id), status, actorId, outcome]
    );
    if (!row) { res.status(404).json({ error: "SOS alert not found" }); return; }
    await writeAudit(actor, {
      action: "sos.handled",
      entityType: "sos_alert",
      entityId: row.id,
      newValue: { status, outcome },
    }).catch(() => { });
    res.json({ alert: row });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /safety/overview — the dashboard banner: active SOS, unacknowledged,
// escalated check-ins and locked PINs in one poll.
router.get("/overview", requireAdmin("trips.read"), async (_req: AuthRequest, res: Response) => {
  try {
    const r = await queryOne<any>(
      `SELECT
         (SELECT COUNT(*)::int FROM sos_alerts WHERE status = 'active') AS active_sos,
         (SELECT COUNT(*)::int FROM sos_alerts WHERE status = 'acknowledged') AS acknowledged_sos,
         (SELECT COUNT(*)::int FROM ride_anomalies WHERE status IN ('no_response','escalated')) AS escalated_anomalies,
         (SELECT COUNT(*)::int FROM ride_checkins WHERE status = 'pending') AS pending_checkins,
         (SELECT COUNT(*)::int FROM safety_events WHERE type = 'pin_locked') AS locked_pins`
    );
    res.json(r ?? {});
  } catch (err: any) {
    if (/does not exist/i.test(String(err?.message))) { res.json({}); return; }
    res.status(500).json({ error: err.message });
  }
});

// GET /safety/config — the tunable thresholds (§1 + retention §6).
router.get("/config", requireAdmin("settings.read"), async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ settings: await getSafetySettings() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /safety/config — validated partial update, audited (who tuned what).
router.put("/config", requireAdmin("settings.write"), async (req: AuthRequest, res: Response) => {
  try {
    const actor = await resolveAdminActor(req);
    if (!actor) { res.status(403).json({ error: "Admin only" }); return; }
    const before = await getSafetySettings();
    const next = await putSafetySettings(
      (req.body?.settings ?? req.body ?? {}) as Partial<SafetySettings>,
      await actorUserId(actor)
    );
    await writeAudit(actor, {
      action: "safety.config_updated",
      entityType: "safety_config",
      entityId: "settings",
      oldValue: before,
      newValue: next,
    }).catch(() => { });
    res.json({ settings: next });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;



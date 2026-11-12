// ─────────────────────────────────────────────────────────────────────────────
// /api/admin/v2/app-versions — who is actually running which build?
//
// Why this exists: Play/App Store update at their own pace, and a driver on an
// old APK will not see a new UI until the store pushes it. Ops needs a list of
// exactly who is behind so they can send the Play link to those drivers instead
// of guessing.
//
// Read-only. Uses user_sessions.app_version, which both apps already send on
// session start and every heartbeat.
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { query, queryOne } from "../config/database";
import { requireAdmin } from "../services/adminAuth";
import {
  emailDriverUpdate,
  listOutdatedDrivers,
  sendAppVersionDigest,
  whatsappLink,
} from "../services/appVersionDigest";

const router = Router();

/** Versions we consider current. Override with env without a code change. */
const LATEST = {
  driver: process.env.DRIVER_LATEST_VERSION || "1.8.18",
  rider: process.env.RIDER_LATEST_VERSION || "1.5.25",
};

const STORE = {
  driver: process.env.DRIVER_STORE_URL || "https://play.google.com/store/apps/details?id=app.vura.driver",
  rider: process.env.RIDER_STORE_URL || "https://play.google.com/store/apps/details?id=app.vura.rider",
};

router.get("/", requireAdmin("drivers.read"), async (_req: AuthRequest, res: Response) => {
  try {
    const dist = await query<{ app: string; version: string; platform: string; users: number; last_seen: string }>(
      `SELECT COALESCE(NULLIF(s.app, ''), CASE WHEN u.role = 'driver' THEN 'driver' ELSE 'rider' END) AS app,
              COALESCE(NULLIF(s.app_version, ''), 'unknown') AS version,
              COALESCE(NULLIF(s.platform, ''), 'unknown') AS platform,
              COUNT(DISTINCT s.user_id)::int AS users,
              MAX(s.last_seen_at) AS last_seen
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.revoked_at IS NULL
          AND s.last_seen_at > NOW() - INTERVAL '60 days'
        GROUP BY 1, 2, 3
        ORDER BY users DESC`
    ).catch(() => []);

    const outdated = await listOutdatedDrivers();
    const driversOutdated = outdated.map((d) => ({
      ...d,
      // Mask the address in the list; ops opens the driver profile for details.
      email: d.email ? String(d.email).replace(/^(.).*(@.*)$/, "$1***$2") : null,
      whatsapp: whatsappLink(d),
    }));

    const counts = await queryOne<{ drivers: number; riders: number }>(
      `SELECT COUNT(DISTINCT s.user_id) FILTER (WHERE u.role = 'driver')::int AS drivers,
              COUNT(DISTINCT s.user_id) FILTER (WHERE u.role <> 'driver')::int AS riders
         FROM user_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.revoked_at IS NULL AND s.last_seen_at > NOW() - INTERVAL '30 days'`
    ).catch(() => null);

    res.json({
      latest: LATEST,
      store: STORE,
      totals: {
        drivers_seen_30d: Number(counts?.drivers || 0),
        riders_seen_30d: Number(counts?.riders || 0),
        drivers_outdated: driversOutdated.length,
      },
      distribution: dist,
      drivers_outdated: driversOutdated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/digest", requireAdmin("drivers.read"), async (_req: AuthRequest, res: Response) => {
  try {
    const out = await sendAppVersionDigest();
    res.json(out);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/notify", requireAdmin("drivers.read"), async (req: AuthRequest, res: Response) => {
  try {
    const ids: string[] = Array.isArray(req.body?.driverIds) ? req.body.driverIds.map(String) : [];
    const all = await listOutdatedDrivers();
    const targets = ids.length ? all.filter((d) => ids.includes(d.id)) : all;
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const d of targets) {
      const r = await emailDriverUpdate(d).catch((e) => ({ ok: false, error: String(e) }));
      results.push({ id: d.id, ok: r.ok, error: (r as any).error });
    }
    res.json({
      targets: targets.length,
      sent: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

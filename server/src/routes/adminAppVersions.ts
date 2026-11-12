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
import { sendResendEmail } from "../services/adminInvite";
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

// POST /download-test � send a real download link to one address so the whole
// delivery path (Resend ? inbox ? phone ? install) can be proven end to end.
router.post("/download-test", requireAdmin("drivers.read"), async (req: AuthRequest, res: Response) => {
  try {
    const email = String(req.body?.email || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      res.status(400).json({ error: "Enter a valid email address" });
      return;
    }
    const link =
      String(req.body?.url || "").trim() ||
      process.env.RIDER_APK_URL ||
      "https://www.ridevura.com/downloads/vura-rider-demo.apk";

    const html = `<!doctype html><html><body style="margin:0;background:#F4F1EC;font-family:Arial,Helvetica,sans-serif;color:#0B0B0C">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 0">
        <tr><td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #E6E1DA">
            <tr><td style="background:#0B0B0C;padding:18px 24px">
              <span style="color:#fff;font-size:18px;font-weight:800">VURA</span>
              <span style="color:#E1251B;font-size:10px;font-weight:800;letter-spacing:.22em;margin-left:10px">DOWNLOAD</span>
            </td></tr>
            <tr><td style="padding:24px">
              <h1 style="margin:0 0 8px;font-size:22px">Your Vura download link</h1>
              <p style="margin:0 0 18px;color:#6B6560;font-size:13px">Tap the button on your Android phone. The file downloads, then open it to install.</p>
              <p style="margin:0 0 18px"><a href="${link}" style="display:inline-block;background:#E1251B;color:#fff;text-decoration:none;font-size:13px;font-weight:800;padding:13px 20px">DOWNLOAD VURA</a></p>
              <p style="margin:0 0 8px;font-size:12px;color:#6B6560">Or copy this link into your phone browser:</p>
              <p style="margin:0 0 18px;font-size:12px;word-break:break-all;color:#0B0B0C">${link}</p>
              <p style="margin:0;font-size:12px;color:#6B6560">Android will ask you to allow installs from this source once. After installing, open Vura and sign in as usual.</p>
              <p style="margin:14px 0 0;font-size:11px;color:#B26A00">This is a demo APK. It does not update itself � the Play version does. Use this link for testing only.</p>
            </td></tr>
          </table>
        </td></tr>
      </table></body></html>`;

    const out = await sendResendEmail({
      to: email,
      subject: "Your Vura download link",
      html,
    });
    res.json({ ok: out.ok, email, link, error: out.error });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

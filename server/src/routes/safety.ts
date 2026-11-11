import { Router, Response } from "express";
import rateLimit from "express-rate-limit";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";
import {
  ensureShareToken,
  publicBaseUrl,
  triggerSos,
} from "../services/sosService";
import { respondCheckin } from "../services/checkinService";
import { getRidePinForRider } from "../services/pinService";
import { ensureSafetyTables } from "../services/safetyConfig";

const router = Router();

// Safety calls are urgent, but they are also a way to spam the on-call inbox.
const sosLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => String(req.userId || "anonymous"),
  message: { error: "Too many SOS attempts. Your last alert is active.", code: "sos_rate_limited" },
});
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => String(req.userId || "anonymous"),
  message: { error: "Too many contact changes. Try again later.", code: "contact_rate_limited" },
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** True when this user is the rider or driver on the ride. */
async function assertRideParty(
  rideId: string,
  userId: string,
  res: Response
): Promise<boolean> {
  if (!UUID_RE.test(rideId)) {
    res.status(400).json({ error: "Invalid ride reference." });
    return false;
  }
  const ride = await queryOne<{ passenger_id: string; driver_id: string | null }>(
    "SELECT passenger_id, driver_id FROM rides WHERE id = $1",
    [rideId]
  ).catch(() => null);
  if (!ride) {
    res.status(404).json({ error: "Ride not found" });
    return false;
  }
  if (String(ride.passenger_id) !== userId && String(ride.driver_id) !== userId) {
    res.status(403).json({ error: "That trip is not on your account." });
    return false;
  }
  return true;
}

/** DB user id for the authed Firebase uid (the routes' shared resolution). */
async function dbUserId(req: AuthRequest): Promise<string | null> {
  const u = await queryOne<{ id: string }>(
    "SELECT id FROM users WHERE firebase_uid = $1",
    [req.userId!]
  ).catch(() => null);
  return u?.id ?? null;
}

// Ensure safety tables exist (the shared DDL is idempotent and also creates
// safety_events, which the share token + SOS paths need).
async function ensureTables() {
  await ensureSafetyTables();
  await execute(`ALTER TABLE emergency_contacts ADD COLUMN IF NOT EXISTS email VARCHAR(255)`).catch(
    () => undefined
  );
}

// GET /api/safety/contacts — List emergency contacts
router.get("/contacts", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await ensureTables();
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user) { res.json({ contacts: [] }); return; }

    const contacts = await query(
      `SELECT id, name, phone, email, relationship FROM emergency_contacts
        WHERE user_id = $1 ORDER BY created_at DESC`,
      [user.id]
    );
    res.json({ contacts });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/safety/contacts — Add emergency contact
router.post("/contacts", requireAuth, contactLimiter, async (req: AuthRequest, res: Response) => {
  try {
    await ensureTables();
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const name = String(req.body?.name || "").trim().slice(0, 100);
    const phone = String(req.body?.phone || "").trim().slice(0, 30);
    const relationship = String(req.body?.relationship || "").trim().slice(0, 60) || null;
    const email = String(req.body?.email || "").trim().toLowerCase().slice(0, 255) || null;
    if (!name || phone.replace(/\D/g, "").length < 6) {
      res.status(400).json({ error: "A name and a valid phone number are required." });
      return;
    }
    if (email && !EMAIL_RE.test(email)) {
      res.status(400).json({ error: "That email address doesn't look right." });
      return;
    }

    const count = await queryOne<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM emergency_contacts WHERE user_id = $1",
      [user.id]
    ).catch(() => null);
    if ((count?.n ?? 0) >= 5) {
      res.status(409).json({
        error: "You can save up to 5 emergency contacts. Remove one first.",
        code: "contact_limit",
      });
      return;
    }

    const duplicate = await queryOne<{ id: string }>(
      `SELECT id FROM emergency_contacts
        WHERE user_id = $1
          AND (regexp_replace(phone, '\\D', '', 'g') = regexp_replace($2, '\\D', '', 'g')
               OR ($3::text IS NOT NULL AND LOWER(email) = $3))
        LIMIT 1`,
      [user.id, phone, email]
    ).catch(() => null);
    if (duplicate) {
      res.status(409).json({ error: "That contact is already saved.", code: "duplicate_contact" });
      return;
    }

    const contact = await queryOne(
      `INSERT INTO emergency_contacts (user_id, name, phone, email, relationship)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, name, phone, email, relationship`,
      [user.id, name, phone, email, relationship]
    );
    res.status(201).json(contact);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/safety/contacts/:id — Delete emergency contact
router.delete("/contacts/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    await execute("DELETE FROM emergency_contacts WHERE id = $1 AND user_id = $2", [req.params.id, user.id]);
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/safety/sos — Trigger SOS (§4): enriches the alert with both
// people's names + phones, the car incl. plate, live GPS and the ride id/time,
// stores it in sos_alerts for the admin console, and answers with the truth —
// Vura's safety team is alerted; no emergency service is called automatically.
router.post("/sos", requireAuth, sosLimiter, async (req: AuthRequest, res: Response) => {
  try {
    await ensureTables();
    const uid = await dbUserId(req);
    if (!uid) { res.status(404).json({ error: "User not found" }); return; }
    const { rideId, location } = req.body || {};
    if (rideId && !(await assertRideParty(String(rideId), uid, res))) return;
    const role: "rider" | "driver" = String(req.body?.role) === "driver" ? "driver" : "rider";
    const result = await triggerSos({
      rideId: rideId ? String(rideId) : null,
      byUserId: uid,
      byRole: role,
      location:
        location && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng))
          ? { lat: Number(location.lat), lng: Number(location.lng) }
          : null,
    });
    res.json({
      success: true,
      id: result.id,
      message: result.message,
      ride_id: result.ride_id,
      share_url: result.share_url,
      contacts_notified: result.contacts_notified,
      safety_team_notified: result.safety_team_notified,
      duplicate: result.duplicate,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/safety/checkin/respond — the rider's "I'm safe" (or SOS) answer
// to the anomaly check-in prompt. Stops the admin escalation clock.
router.post("/checkin/respond", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const uid = await dbUserId(req);
    if (!uid) { res.status(404).json({ error: "User not found" }); return; }
    const { rideId, response } = req.body || {};
    if (!rideId || !["safe", "sos"].includes(String(response))) {
      res.status(400).json({ error: "rideId and response ('safe'|'sos') are required" });
      return;
    }
    const io = (global as any).__vuraIo;
    const out = await respondCheckin(io, String(rideId), uid, response as "safe" | "sos");
    if (!out.ok) { res.status(400).json({ error: out.error }); return; }
    res.json({ success: true, sos: out.sos ?? null });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/safety/pin?rideId= — the rider's start PIN (§3). Only the ride's
// passenger can read it; nothing after the trip starts (spent/dead secret).
router.get("/pin", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const uid = await dbUserId(req);
    if (!uid) { res.status(404).json({ error: "User not found" }); return; }
    const rideId = String(req.query.rideId || "");
    if (!rideId) { res.status(400).json({ error: "rideId is required" }); return; }
    const out = await getRidePinForRider(rideId, uid);
    if (!out) { res.status(404).json({ error: "No PIN for this ride" }); return; }
    res.json({ ride_id: rideId, pin: out.pin, locked: out.locked });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/safety/share — Generate/reuse the live share link for a ride the
// caller is actually on. Reusing the active token stops the app's REST +
// socket pair from minting two links for the same trip.
router.post("/share", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await ensureTables();
    const uid = await dbUserId(req);
    if (!uid) { res.status(404).json({ error: "User not found" }); return; }
    const rideId = String(req.body?.rideId || "");
    if (!rideId || !(await assertRideParty(rideId, uid, res))) return;
    const shareToken = await ensureShareToken(rideId);
    if (!shareToken) {
      res.status(500).json({ error: "Could not create a share link" });
      return;
    }
    // ALWAYS share an HTTPS link. Behind the AWS ALB / nginx, `req.protocol`
    // resolves to "http" (the proxy talks HTTP to the app) unless `trust proxy`
    // is enabled — and the public site only answers on port 443. An "http" share
    // link would time out in the recipient's browser and never show the trip.
    res.json({ shareToken, shareUrl: `${publicBaseUrl()}/share/${shareToken}` });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/safety/share/stop — Stop sharing
router.post("/share/stop", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    await ensureTables();
    const uid = await dbUserId(req);
    if (!uid) { res.status(404).json({ error: "User not found" }); return; }
    const rideId = String(req.body?.rideId || "");
    if (!rideId || !(await assertRideParty(rideId, uid, res))) return;
    await execute(
      "INSERT INTO safety_events (ride_id, type, data) VALUES ($1, 'share_ended', $2)",
      [rideId, JSON.stringify({ timestamp: new Date().toISOString() })]
    );
    res.json({ success: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/safety/events — Get safety events
router.get("/events", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const uid = await dbUserId(req);
    if (!uid) { res.status(404).json({ error: "User not found" }); return; }
    const rideId = String(req.query.rideId || "");
    if (!rideId || !(await assertRideParty(rideId, uid, res))) return;
    const events = await query(
      "SELECT id, ride_id, type, data, created_at FROM safety_events WHERE ride_id = $1 ORDER BY created_at DESC",
      [rideId]
    );
    res.json({ events });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
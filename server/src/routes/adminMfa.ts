import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { queryOne } from "../config/database";
import { getAuth } from "../config/firebase";
import { requireAdmin, resolveAdminActor, resolveAdminRole, writeAudit } from "../services/adminAuth";
import {
  AdminMfaError,
  disableAdminMfa,
  enableAdminMfa,
  getAdminMfaStatus,
  resetAdminMfa,
  startAdminMfaSetup,
  verifyAdminMfa,
} from "../services/adminMfa";

/**
 * Admin TOTP 2FA endpoints.
 *
 * These routes use Firebase auth + admin-role resolution, but deliberately do
 * NOT use requireAdmin(): that middleware itself requires a valid MFA token, so
 * using it here would make enrollment impossible. The reset route is the one
 * exception – it is a governance action and requires a fully authenticated
 * admin (including their own MFA token).
 */

const router = Router();

// Never let a proxy/browser cache a TOTP secret, recovery code or session token.
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

async function mfaAdmin(req: AuthRequest): Promise<{ uid: string; email: string } | null> {
  const uid = req.userId;
  const email = String(req.user?.email || "").trim().toLowerCase();
  if (!uid) return null;
  const role = await resolveAdminRole(email);
  if (role) return { uid, email };
  // Legacy admin accounts: users.role='admin'. Admin V2 is the normal path, but
  // the MFA screen must still be reachable during the transition.
  try {
    const user = await queryOne<{ role: string | null }>(
      "SELECT role FROM users WHERE firebase_uid = $1",
      [uid]
    );
    if (String(user?.role || "").toLowerCase() === "admin") return { uid, email };
  } catch {
    /* table/permission issue — the caller stays unauthenticated */
  }
  return null;
}

function fail(res: Response, err: any, fallback: string): void {
  const status = err instanceof AdminMfaError ? err.statusCode : Number(err?.statusCode) || 500;
  if (status >= 500) console.error(`[admin-mfa] ${fallback}:`, err?.message || err);
  res.status(status).json({
    error: err?.message || fallback,
    code: err instanceof AdminMfaError ? err.code : "mfa_error",
  });
}

// GET /api/admin/v2/mfa/status — is this admin enrolled/locked?
router.get("/status", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const admin = await mfaAdmin(req);
    if (!admin) { res.status(403).json({ error: "Admin only", code: "admin_only" }); return; }
    res.json(await getAdminMfaStatus(admin.uid));
  } catch (err: any) {
    fail(res, err, "Could not read the 2FA status");
  }
});

// POST /api/admin/v2/mfa/setup — create a pending secret + otpauth URI
router.post("/setup", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const admin = await mfaAdmin(req);
    if (!admin) { res.status(403).json({ error: "Admin only", code: "admin_only" }); return; }
    const setup = await startAdminMfaSetup(admin.uid, admin.email);
    res.json(setup);
  } catch (err: any) {
    fail(res, err, "Could not start 2FA setup");
  }
});

// POST /api/admin/v2/mfa/enable — verify the first code and return recovery codes
router.post("/enable", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const admin = await mfaAdmin(req);
    if (!admin) { res.status(403).json({ error: "Admin only", code: "admin_only" }); return; }
    const code = String(req.body?.code || "").trim();
    if (!code) { res.status(400).json({ error: "Enter the code from your authenticator app." }); return; }
    const result = await enableAdminMfa(admin.uid, code);
    const actor = await resolveAdminActor(req);
    if (actor) {
      await writeAudit(actor, {
        action: "admin.mfa.enable",
        entityType: "admin_user",
        entityId: admin.uid,
        newValue: { enabled: true },
      });
    }
    res.json(result);
  } catch (err: any) {
    fail(res, err, "Could not enable 2FA");
  }
});

// POST /api/admin/v2/mfa/verify — TOTP or one-time recovery code -> session token
router.post("/verify", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const admin = await mfaAdmin(req);
    if (!admin) { res.status(403).json({ error: "Admin only", code: "admin_only" }); return; }
    const code = String(req.body?.code || "").trim();
    if (!code) { res.status(400).json({ error: "Enter your authenticator code." }); return; }
    res.json(await verifyAdminMfa(admin.uid, code));
  } catch (err: any) {
    fail(res, err, "Could not verify the 2FA code");
  }
});

// POST /api/admin/v2/mfa/disable — require a current code
router.post("/disable", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const admin = await mfaAdmin(req);
    if (!admin) { res.status(403).json({ error: "Admin only", code: "admin_only" }); return; }
    const code = String(req.body?.code || "").trim();
    if (!code) { res.status(400).json({ error: "Enter a current authenticator code." }); return; }
    await disableAdminMfa(admin.uid, code);
    const actor = await resolveAdminActor(req);
    if (actor) {
      await writeAudit(actor, {
        action: "admin.mfa.disable",
        entityType: "admin_user",
        entityId: admin.uid,
        newValue: { enabled: false },
      });
    }
    res.json({ success: true });
  } catch (err: any) {
    fail(res, err, "Could not disable 2FA");
  }
});

// POST /api/admin/v2/mfa/reset — governance-only lockout recovery.
// Requires a fully authenticated governance admin (including their own MFA).
router.post("/reset", requireAdmin("admins.manage"), async (req: AuthRequest, res: Response) => {
  try {
    let uid = String(req.body?.uid || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!uid && email) {
      const account = await getAuth().getUserByEmail(email).catch(() => null);
      uid = account?.uid || "";
    }
    if (!uid) { res.status(404).json({ error: "Admin account not found" }); return; }
    await resetAdminMfa(uid);
    const actor = await resolveAdminActor(req);
    if (actor) {
      await writeAudit(actor, {
        action: "admin.mfa.reset",
        entityType: "admin_user",
        entityId: uid,
        newValue: { enabled: false, email: email || null },
      });
    }
    res.json({ success: true });
  } catch (err: any) {
    fail(res, err, "Could not reset 2FA");
  }
});

export default router;

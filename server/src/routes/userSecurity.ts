import { Router, Response } from "express";
import rateLimit from "express-rate-limit";
import { AuthRequest, requireAuth } from "../middleware/auth";
import {
  UserSecurityError,
  disableTwoFactor,
  enableTwoFactor,
  getSecurityStatus,
  listSecurityActivity,
  regenerateRecoveryCodes,
  startTwoFactorSetup,
  verifyTwoFactor,
} from "../services/userSecurity";

/**
 * Account security for riders and drivers.
 *
 * Mounted at /api/users/security. Every route except `status` and
 * `2fa/verify` is behind the normal auth middleware AND, when 2FA is on, the
 * step-up gate in middleware/auth.ts. `verify` has to be reachable BEFORE the
 * gate passes — that is the whole point of it.
 */
const router = Router();

const codeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many security-code attempts. Try again in a few minutes.",
    code: "security_rate_limited",
  },
});

function fail(res: Response, err: any, fallback: string): void {
  if (err instanceof UserSecurityError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code });
    return;
  }
  // AdminMfaError: the encryption key is not configured (503). Surfacing it
  // honestly is better than a generic 500 that looks like a code bug.
  if (err && typeof err.statusCode === "number" && typeof err.code === "string") {
    res.status(err.statusCode).json({ error: err.message, code: err.code });
    return;
  }
  console.error(`[user-security] ${fallback}:`, err?.message || err);
  res.status(500).json({ error: fallback });
}

// GET /api/users/security/status — always reachable, even while the 2FA gate
// is up. The app needs it to know whether to show the code screen.
router.get("/status", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const status = await getSecurityStatus(req.userId!);
    res.json({
      ...status,
      // Feature availability is honest: if the server has no encryption key the
      // app disables enrollment instead of showing a button that cannot work.
      available: true,
    });
  } catch (err) {
    fail(res, err, "Could not load your security settings");
  }
});

// POST /api/users/security/2fa/setup — returns the secret ONCE, for the
// authenticator app. It is not enabled until a valid code is entered.
router.post("/2fa/setup", requireAuth, codeLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const setup = await startTwoFactorSetup(req.userId!, req.user?.email);
    res.json(setup);
  } catch (err) {
    fail(res, err, "Could not start two-factor setup");
  }
});

// POST /api/users/security/2fa/enable — confirms the first code and returns
// the recovery codes (the only time they are ever shown).
router.post("/2fa/enable", requireAuth, codeLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const result = await enableTwoFactor(req.userId!, String(req.body?.code || ""));
    res.status(201).json(result);
  } catch (err) {
    fail(res, err, "Could not enable two-factor authentication");
  }
});

// POST /api/users/security/2fa/verify — login challenge. Returns the short
// step-up token the app sends as X-Vura-2FA.
router.post("/2fa/verify", requireAuth, codeLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const result = await verifyTwoFactor(req.userId!, String(req.body?.code || ""));
    res.json(result);
  } catch (err) {
    fail(res, err, "Could not verify that code");
  }
});

// POST /api/users/security/2fa/disable — requires a current code, so a stolen
// unlocked phone cannot simply switch the protection off.
router.post("/2fa/disable", requireAuth, codeLimiter, async (req: AuthRequest, res: Response) => {
  try {
    await disableTwoFactor(req.userId!, String(req.body?.code || ""));
    res.json({ success: true });
  } catch (err) {
    fail(res, err, "Could not turn off two-factor authentication");
  }
});

// POST /api/users/security/recovery/regenerate — new one-time codes.
router.post(
  "/recovery/regenerate",
  requireAuth,
  codeLimiter,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await regenerateRecoveryCodes(req.userId!, String(req.body?.code || ""));
      res.json(result);
    } catch (err) {
      fail(res, err, "Could not create new recovery codes");
    }
  }
);

// GET /api/users/security/activity — the account's recent security events.
router.get("/activity", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Number(req.query.limit || 20);
    const events = await listSecurityActivity(req.userId!, limit);
    res.json({ events });
  } catch (err) {
    fail(res, err, "Could not load your security activity");
  }
});

export default router;

// ─────────────────────────────────────────────────────────────────────────────
// /api/admin/features — admin-only flag & allowlist control (RC4 Item 1/1b).
//
//   GET    /api/admin/features         read all three flags + allowlists,
//                                       last 5 rides' matching paths, build
//   PUT    /api/admin/features         { key, changes } — validated keys only
//   POST   /api/admin/features/enable  one-call enable for test accounts by
//                                       id / email / phone (no SQL needed)
//
// Auth: Firebase bearer (requireAuth) + email in ADMIN_EMAILS — the same gate
// every other route in admin.ts uses. All logic lives in services/featureFlags
// so the integration tests exercise the exact code path without HTTP.
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import {
  FeatureFlagError,
  enableForAccounts,
  readFeatures,
  updateFeature,
} from "../services/featureFlags";

const router = Router();

function isAdmin(req: AuthRequest): boolean {
  const admins = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase());
  return admins.length > 0 && !!req.user?.email && admins.includes(req.user.email.toLowerCase());
}

function actorOf(req: AuthRequest): string {
  return req.user?.email || req.userId || "unknown";
}

function sendError(res: Response, err: any) {
  if (err instanceof FeatureFlagError) {
    res.status(err.code === "no_row" ? 409 : 400).json({ error: err.message, code: err.code });
    return;
  }
  console.error("[admin/features] unexpected error:", err);
  res.status(500).json({ error: err?.message || "unexpected error" });
}

router.get("/features", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!isAdmin(req)) { res.status(403).json({ error: "Admin only" }); return; }
  try {
    res.json(await readFeatures());
  } catch (err) {
    sendError(res, err);
  }
});

router.put("/features", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!isAdmin(req)) { res.status(403).json({ error: "Admin only" }); return; }
  try {
    const { key, changes } = req.body || {};
    res.json(await updateFeature(key, changes, actorOf(req)));
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/features/enable", requireAuth, async (req: AuthRequest, res: Response) => {
  if (!isAdmin(req)) { res.status(403).json({ error: "Admin only" }); return; }
  try {
    const body = req.body || {};
    res.json(
      await enableForAccounts(
        {
          driverIds: body.driverIds,
          riderIds: body.riderIds,
          driverEmails: body.driverEmails,
          driverPhones: body.driverPhones,
          riderEmails: body.riderEmails,
          riderPhones: body.riderPhones,
          features: body.features,
        },
        actorOf(req),
      ),
    );
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
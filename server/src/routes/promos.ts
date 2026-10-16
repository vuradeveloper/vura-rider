// ─────────────────────────────────────────────────────────────────────────────
// /api/promos — the APP-facing promo reads (admin CRUD lives in adminV2).
//   GET /api/promos/active?side=rider|driver — live promos for that side.
// The server filters by window + audience; the apps never see the other side.
// ─────────────────────────────────────────────────────────────────────────────
import { Router } from "express";
import { requireAuth, type AuthRequest } from "../middleware/auth";
import { activePromosForSide } from "../services/promos";

const router = Router();

router.get("/active", requireAuth, async (req: AuthRequest, res) => {
  try {
    const side = String(req.query.side || "");
    if (side !== "rider" && side !== "driver") {
      res.status(400).json({ error: "side must be 'rider' or 'driver'" });
      return;
    }
    // Missing table (server older than migration 012) answers [] so the apps
    // simply show no promo instead of an error.
    const promos = await activePromosForSide(side).catch(() => []);
    res.json({ promos });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Could not load promos" });
  }
});

export default router;
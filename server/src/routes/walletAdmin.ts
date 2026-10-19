// ─────────────────────────────────────────────────────────────────────────────
// WALLET / COMMISSION ADMIN API (/api/admin/v2/wallet/config): the tunable
// numbers behind the 10% split — commission %, VAT slice (inside our
// commission), Paystack fee fallback, and the cash-ride negative limit.
// Reads need settings.read; writes need settings.write and are audited.
// ─────────────────────────────────────────────────────────────────────────────
import { Router, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { requireAdmin, resolveAdminActor, writeAudit } from "../services/adminAuth";
import {
  getWalletConfig,
  putWalletConfig,
  type WalletConfig,
} from "../services/walletService";

const router = Router();

// GET /wallet/config — current commission settings.
router.get("/config", requireAdmin("settings.read"), async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ settings: await getWalletConfig() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /wallet/config — validated partial update, audited (who changed money).
router.put("/config", requireAdmin("settings.write"), async (req: AuthRequest, res: Response) => {
  try {
    const actor = await resolveAdminActor(req);
    if (!actor) { res.status(403).json({ error: "Admin only" }); return; }
    const before = await getWalletConfig();
    const next = await putWalletConfig(
      (req.body?.settings ?? req.body ?? {}) as Partial<WalletConfig>
    );
    await writeAudit(actor, {
      action: "wallet.config_updated",
      entityType: "wallet_config",
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

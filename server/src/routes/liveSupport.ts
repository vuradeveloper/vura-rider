import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { getRiderChat, sendRiderMessage } from "../services/liveSupport";

const router = Router();

// GET /api/support/live-chat — the rider's latest conversation (any status).
router.get("/live-chat", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const chat = await getRiderChat(req.userId!);
    res.json({ chat });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || "Could not load live support" });
  }
});

// POST /api/support/live-chat — send a message; opens a chat if none is open.
router.post("/live-chat", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) {
      res.status(400).json({ error: "Type a message first" });
      return;
    }
    if (message.length > 4000) {
      res.status(400).json({ error: "Message is too long" });
      return;
    }
    const chat = await sendRiderMessage({
      firebaseUid: req.userId!,
      message,
      rideId: req.body?.rideId ? String(req.body.rideId) : null,
    });
    res.status(201).json({ chat });
  } catch (err: any) {
    res.status(400).json({ error: err?.message || "Could not send your message" });
  }
});

export default router;

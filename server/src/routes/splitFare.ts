import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import {
  createSplitInvite,
  declineSplit,
  listPendingInvites,
  listRideSplits,
  paySplit,
  SplitError,
} from "../services/splitFareService";

const router = Router();

function fail(res: Response, err: any) {
  if (err instanceof SplitError) {
    res.status(err.httpStatus).json({ error: err.message, code: err.code });
    return;
  }
  res.status(500).json({ error: err?.message || "Split fare failed." });
}

// POST /api/split/invite — invite one co-rider to share this ride.
// body: { rideId, inviteeEmail, shareCount }  (shareCount = TOTAL riders, 2–4)
router.post("/invite", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const split = await createSplitInvite({
      firebaseUid: req.userId!,
      rideId: String(req.body?.rideId || ""),
      inviteeEmail: String(req.body?.inviteeEmail || ""),
      shareCount: Number(req.body?.shareCount || 2),
    });
    res.status(201).json(split);
  } catch (err: any) {
    fail(res, err);
  }
});

// GET /api/split/pending — open invites for the signed-in rider (Home banner).
router.get("/pending", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const splits = await listPendingInvites(req.userId!);
    res.json({ splits });
  } catch (err: any) {
    fail(res, err);
  }
});

// GET /api/split/ride/:rideId — all shares on one ride (booking rider only).
router.get("/ride/:rideId", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const splits = await listRideSplits(req.userId!, String(req.params.rideId));
    res.json({ splits });
  } catch (err: any) {
    fail(res, err);
  }
});

// POST /api/split/:id/pay — co-rider pays their share from their saved card.
router.post("/:id/pay", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await paySplit({
      firebaseUid: req.userId!,
      splitId: String(req.params.id),
    });
    res.json(result);
  } catch (err: any) {
    fail(res, err);
  }
});

// POST /api/split/:id/decline — co-rider declines; the booking rider covers.
router.post("/:id/decline", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const result = await declineSplit({
      firebaseUid: req.userId!,
      splitId: String(req.params.id),
    });
    res.json(result);
  } catch (err: any) {
    fail(res, err);
  }
});

// Legacy endpoint kept for older builds. Accepting without paying is refused —
// money must land before the share counts.
router.post("/respond", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    if (req.body?.accept) {
      res.status(400).json({
        error: "Paying the share is what accepts it. Open the invite and pay.",
        code: "payment_required",
      });
      return;
    }
    const result = await declineSplit({
      firebaseUid: req.userId!,
      splitId: String(req.body?.splitId || ""),
    });
    res.json(result);
  } catch (err: any) {
    fail(res, err);
  }
});

// Legacy status endpoint (older builds) — now delegates to the ride listing.
router.get("/status", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const splits = await listRideSplits(req.userId!, String(req.query.rideId || ""));
    res.json({ splits });
  } catch (err: any) {
    fail(res, err);
  }
});

export default router;

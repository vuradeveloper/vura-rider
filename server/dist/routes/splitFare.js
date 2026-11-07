"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const splitFareService_1 = require("../services/splitFareService");
const router = (0, express_1.Router)();
function fail(res, err) {
    if (err instanceof splitFareService_1.SplitError) {
        res.status(err.httpStatus).json({ error: err.message, code: err.code });
        return;
    }
    res.status(500).json({ error: err?.message || "Split fare failed." });
}
// POST /api/split/invite — invite one co-rider to share this ride.
// body: { rideId, inviteeEmail, shareCount }  (shareCount = TOTAL riders, 2–4)
router.post("/invite", auth_1.requireAuth, async (req, res) => {
    try {
        const split = await (0, splitFareService_1.createSplitInvite)({
            firebaseUid: req.userId,
            rideId: String(req.body?.rideId || ""),
            inviteeEmail: String(req.body?.inviteeEmail || ""),
            shareCount: Number(req.body?.shareCount || 2),
        });
        res.status(201).json(split);
    }
    catch (err) {
        fail(res, err);
    }
});
// GET /api/split/pending — open invites for the signed-in rider (Home banner).
router.get("/pending", auth_1.requireAuth, async (req, res) => {
    try {
        const splits = await (0, splitFareService_1.listPendingInvites)(req.userId);
        res.json({ splits });
    }
    catch (err) {
        fail(res, err);
    }
});
// GET /api/split/ride/:rideId — all shares on one ride (booking rider only).
router.get("/ride/:rideId", auth_1.requireAuth, async (req, res) => {
    try {
        const splits = await (0, splitFareService_1.listRideSplits)(req.userId, String(req.params.rideId));
        res.json({ splits });
    }
    catch (err) {
        fail(res, err);
    }
});
// POST /api/split/:id/pay — co-rider pays their share from their saved card.
router.post("/:id/pay", auth_1.requireAuth, async (req, res) => {
    try {
        const result = await (0, splitFareService_1.paySplit)({
            firebaseUid: req.userId,
            splitId: String(req.params.id),
        });
        res.json(result);
    }
    catch (err) {
        fail(res, err);
    }
});
// POST /api/split/:id/decline — co-rider declines; the booking rider covers.
router.post("/:id/decline", auth_1.requireAuth, async (req, res) => {
    try {
        const result = await (0, splitFareService_1.declineSplit)({
            firebaseUid: req.userId,
            splitId: String(req.params.id),
        });
        res.json(result);
    }
    catch (err) {
        fail(res, err);
    }
});
// Legacy endpoint kept for older builds. Accepting without paying is refused —
// money must land before the share counts.
router.post("/respond", auth_1.requireAuth, async (req, res) => {
    try {
        if (req.body?.accept) {
            res.status(400).json({
                error: "Paying the share is what accepts it. Open the invite and pay.",
                code: "payment_required",
            });
            return;
        }
        const result = await (0, splitFareService_1.declineSplit)({
            firebaseUid: req.userId,
            splitId: String(req.body?.splitId || ""),
        });
        res.json(result);
    }
    catch (err) {
        fail(res, err);
    }
});
// Legacy status endpoint (older builds) — now delegates to the ride listing.
router.get("/status", auth_1.requireAuth, async (req, res) => {
    try {
        const splits = await (0, splitFareService_1.listRideSplits)(req.userId, String(req.query.rideId || ""));
        res.json({ splits });
    }
    catch (err) {
        fail(res, err);
    }
});
exports.default = router;
//# sourceMappingURL=splitFare.js.map
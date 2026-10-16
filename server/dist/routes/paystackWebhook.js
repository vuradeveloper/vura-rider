"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/paystack/webhook — Paystack card-preauthorization events.
//
// Mounted in index.ts WITH express.raw() BEFORE express.json(), so req.body is
// the exact bytes Paystack signed: x-paystack-signature is the HMAC SHA512 of
// the raw request body with the secret key (docs: payments/webhooks). Nothing
// here is trusted until that header verifies.
//
// Events handled (docs: card-preauthorization):
//   preauthorization.reserve.success  → HOLD_ACTIVE + save reusable card
//   preauthorization.capture.success   → PAID (+ payments ledger row)
//   preauthorization.capture.failed    → PAYMENT_FAILED
//   preauthorization.release.success   → RELEASED
//   preauthorization.release.failed    → logged (hold stays; support notified)
//
// Handlers are idempotent (event-log primary key + guarded UPDATEs), so Paystack's
// retry schedule (72h live / 10h test without a 200) can never double-apply.
// ─────────────────────────────────────────────────────────────────────────────
const express_1 = require("express");
const preauthorization_1 = require("../services/preauthorization");
const router = (0, express_1.Router)();
router.post("/webhook", async (req, res) => {
    try {
        const raw = Buffer.isBuffer(req.body)
            ? req.body
            : typeof req.body === "string"
                ? Buffer.from(req.body)
                : null;
        if (!raw || raw.length === 0) {
            res.status(400).json({ error: "raw body required for signature verification" });
            return;
        }
        const secret = (0, preauthorization_1.paystackWebhookSecret)();
        if (!secret) {
            // Never process unverified events — fail closed until the key is set.
            res.status(503).json({ error: "webhook secret not configured" });
            return;
        }
        const signature = req.headers["x-paystack-signature"];
        if (!(0, preauthorization_1.verifyPaystackSignature)(raw, signature, secret)) {
            console.warn("[preauth] webhook REJECTED — bad x-paystack-signature");
            res.status(401).json({ error: "invalid signature" });
            return;
        }
        let payload;
        try {
            payload = JSON.parse(raw.toString("utf8"));
        }
        catch {
            res.status(400).json({ error: "invalid JSON body" });
            return;
        }
        const event = String(payload?.event || "");
        if (!event) {
            res.status(400).json({ error: "missing event" });
            return;
        }
        const result = await (0, preauthorization_1.handlePreauthorizationEvent)(event, payload);
        // 200: Paystack keeps retrying anything else for 72 hours. `duplicate`
        // answers are still 200 — a replay is success, not an error.
        res.status(200).json(result);
    }
    catch (err) {
        // Verified but broke (e.g. DB hiccup): 500 so Paystack's retry re-runs it —
        // the handlers are idempotent, so the retry cannot double-apply anything.
        console.error("[preauth] webhook handler error:", err?.message || err);
        res.status(500).json({ error: String(err?.message || err) });
    }
});
exports.default = router;
//# sourceMappingURL=paystackWebhook.js.map
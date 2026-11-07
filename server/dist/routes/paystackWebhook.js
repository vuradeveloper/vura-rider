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
const PayLaterService_1 = require("../services/PayLaterService");
const database_1 = require("../config/database");
const paystackPayment_1 = require("../services/paystackPayment");
/**
 * Legacy card-registration charges (reference VURACARD...) used a real R1
 * charge. The new flow uses a preauthorization hold, but events already in
 * flight still need to save the card and refund the R1 even if the app never
 * returned to poll /verify.
 */
async function handleLegacyCardRegisterCharge(payload) {
    const data = payload?.data || {};
    const ref = String(data.reference || "");
    const upper = ref.toUpperCase();
    if (!upper.startsWith("VURACARD") && !upper.startsWith("VURAADD"))
        return false;
    const row = await (0, database_1.queryOne)(`SELECT id, user_id, status FROM payments
      WHERE reference = $1 AND ride_id IS NULL LIMIT 1`, [ref]).catch(() => null);
    if (!row)
        return false;
    if (["card_saved", "refunded", "released"].includes(String(row.status))) {
        // The refund may have happened before the card was tokenised (the old
        // /verify raced the webhook). Recover the card from the charge payload
        // without issuing a second refund.
        if (String(row.status) === "refunded" && data.authorization) {
            const stored = await (0, preauthorization_1.saveReusableAuthorization)(row.user_id, data.authorization).catch(() => false);
            if (stored) {
                await (0, database_1.execute)(`UPDATE payments SET status = 'card_saved', updated_at = NOW() WHERE id = $1`, [row.id]).catch(() => { });
            }
        }
        return true;
    }
    let stored = false;
    if (data.authorization) {
        stored = await (0, preauthorization_1.saveReusableAuthorization)(row.user_id, data.authorization).catch(() => false);
    }
    // The R1 was a verification charge. Refund it exactly once via the status
    // guard. Paystack refunds are asynchronous; the dashboard shows refund.pending
    // until the bank completes it.
    try {
        await (0, paystackPayment_1.refundTransaction)(ref, Number(data.amount || 0) / 100);
    }
    catch (e) {
        console.warn(`[preauth] legacy card refund failed ref=${ref}:`, e?.message || e);
    }
    await (0, database_1.execute)(`UPDATE payments SET status = $2, raw_response = $3, updated_at = NOW()
      WHERE id = $1`, [row.id, stored ? "card_saved" : "refunded", JSON.stringify(data)]).catch(() => { });
    console.log(`[preauth] legacy card register ref=${ref} saved=${stored} (R1 refund requested)`);
    return true;
}
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
        // charge.* events are Pay Later REPAYMENT confirmations ("PLR..." references)
        // OR legacy card-registration charges ("VURACARD..." references). The new
        // card flow uses preauthorization.*; the legacy branch saves the card and
        // refunds the R1 even when the app never returned to poll /verify.
        let result;
        if (event.startsWith("charge.")) {
            const legacyCard = event === "charge.success" ? await handleLegacyCardRegisterCharge(payload) : false;
            result = legacyCard
                ? {
                    received: true,
                    event,
                    duplicate: false,
                    handled: true,
                    detail: "legacy card registration saved + R1 refund requested",
                }
                : await (0, PayLaterService_1.handlePayLaterChargeWebhook)(event, payload);
        }
        else {
            result = await (0, preauthorization_1.handlePreauthorizationEvent)(event, payload);
        }
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
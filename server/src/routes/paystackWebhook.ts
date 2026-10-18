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
import { Router, Response } from "express";
import {
  handlePreauthorizationEvent,
  paystackWebhookSecret,
  verifyPaystackSignature,
} from "../services/preauthorization";
import { handlePayLaterChargeWebhook } from "../services/PayLaterService";

const router = Router();

router.post("/webhook", async (req: any, res: Response) => {
  try {
    const raw: Buffer | null = Buffer.isBuffer(req.body)
      ? req.body
      : typeof req.body === "string"
        ? Buffer.from(req.body)
        : null;
    if (!raw || raw.length === 0) {
      res.status(400).json({ error: "raw body required for signature verification" });
      return;
    }

    const secret = paystackWebhookSecret();
    if (!secret) {
      // Never process unverified events — fail closed until the key is set.
      res.status(503).json({ error: "webhook secret not configured" });
      return;
    }

    const signature = req.headers["x-paystack-signature"];
    if (!verifyPaystackSignature(raw, signature as string | undefined, secret)) {
      console.warn("[preauth] webhook REJECTED — bad x-paystack-signature");
      res.status(401).json({ error: "invalid signature" });
      return;
    }

    let payload: any;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      res.status(400).json({ error: "invalid JSON body" });
      return;
    }
    const event = String(payload?.event || "");
    if (!event) {
      res.status(400).json({ error: "missing event" });
      return;
    }

    // charge.* events are Pay Later REPAYMENT confirmations ("PLR…" references
    // only — card registration / legacy charges are acknowledged, not touched).
    // preauthorization.* keeps its own handler. Both are idempotent.
    const result = event.startsWith("charge.")
      ? await handlePayLaterChargeWebhook(event, payload)
      : await handlePreauthorizationEvent(event, payload);
    // 200: Paystack keeps retrying anything else for 72 hours. `duplicate`
    // answers are still 200 — a replay is success, not an error.
    res.status(200).json(result);
  } catch (err: any) {
    // Verified but broke (e.g. DB hiccup): 500 so Paystack's retry re-runs it —
    // the handlers are idempotent, so the retry cannot double-apply anything.
    console.error("[preauth] webhook handler error:", err?.message || err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

export default router;

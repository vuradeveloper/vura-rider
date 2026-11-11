"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const adminAuth_1 = require("../services/adminAuth");
const emailCampaigns_1 = require("../services/emailCampaigns");
const emailTemplate_1 = require("../services/emailTemplate");
/**
 * Admin email centre.
 *
 * Mounted at /api/admin/v2/email. A campaign is composed as a draft, previewed,
 * optionally test-sent, then queued. The background worker in
 * services/emailCampaigns.ts does the fan-out so the console request never
 * hangs on thousands of Resend calls.
 */
const router = (0, express_1.Router)();
function fail(res, err) {
    const status = /required|must be|at least|fewer|Unknown|Choose/.test(String(err?.message || ""))
        ? 400
        : 500;
    if (status === 500)
        console.error("[admin-email] route error:", err?.message || err);
    res.status(status).json({ error: String(err?.message || "Email request failed") });
}
function bodyToInput(body) {
    const audience = String(body?.audience || "riders");
    if (!emailCampaigns_1.EMAIL_AUDIENCES.includes(audience)) {
        throw new Error("Unknown audience");
    }
    return {
        name: String(body?.name || "").trim(),
        subject: String(body?.subject || "").trim(),
        heading: String(body?.heading || "").trim(),
        body: String(body?.body || "").trim(),
        audience: audience,
        targetUserIds: Array.isArray(body?.targetUserIds) ? body.targetUserIds.map(String) : null,
        kind: "announcement",
        promoCode: body?.promoCode ? String(body.promoCode).trim().slice(0, 60) : null,
        discountLabel: body?.discountLabel ? String(body.discountLabel).trim().slice(0, 80) : null,
        expiresAt: body?.expiresAt ? String(body.expiresAt) : null,
        imageUrl: body?.imageUrl ? String(body.imageUrl).trim().slice(0, 1000) : null,
        ctaLabel: body?.ctaLabel ? String(body.ctaLabel).trim().slice(0, 40) : "Open Vura",
        ctaUrl: body?.ctaUrl ? String(body.ctaUrl).trim().slice(0, 1000) : "https://www.ridevura.com",
    };
}
router.get("/campaigns", (0, adminAuth_1.requireAdmin)("messaging.send"), async (_req, res) => {
    try {
        res.json({ campaigns: await (0, emailCampaigns_1.listEmailCampaigns)(200) });
    }
    catch (err) {
        fail(res, err);
    }
});
router.post("/campaigns", (0, adminAuth_1.requireAdmin)("messaging.send"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const campaign = await (0, emailCampaigns_1.createEmailCampaign)({
            ...bodyToInput(req.body),
            createdBy: actor.email,
        });
        await (0, adminAuth_1.writeAudit)(actor, {
            action: "email.campaign.create",
            entityType: "email_campaign",
            entityId: campaign.id,
            newValue: { subject: campaign.subject, audience: campaign.audience },
        });
        res.status(201).json({ campaign });
    }
    catch (err) {
        fail(res, err);
    }
});
router.post("/campaigns/:id/send", (0, adminAuth_1.requireAdmin)("messaging.send"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const campaign = await (0, emailCampaigns_1.queueEmailCampaign)(String(req.params.id));
        if (!campaign) {
            res.status(409).json({
                error: "This campaign is already queued, sending or sent.",
                code: "not_queueable",
            });
            return;
        }
        await (0, adminAuth_1.writeAudit)(actor, {
            action: "email.campaign.queue",
            entityType: "email_campaign",
            entityId: campaign.id,
            newValue: { subject: campaign.subject, audience: campaign.audience },
        });
        res.json({ campaign, queued: true });
    }
    catch (err) {
        fail(res, err);
    }
});
router.post("/test", (0, adminAuth_1.requireAdmin)("messaging.send"), async (req, res) => {
    try {
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (!actor) {
            res.status(403).json({ error: "Admin only" });
            return;
        }
        const input = bodyToInput(req.body);
        await (0, emailCampaigns_1.sendTestEmail)(input, actor.email);
        res.json({ success: true, sent_to: actor.email });
    }
    catch (err) {
        fail(res, err);
    }
});
router.post("/preview", (0, adminAuth_1.requireAdmin)("messaging.send"), async (req, res) => {
    try {
        const input = bodyToInput(req.body);
        const html = (0, emailTemplate_1.renderMarketingEmail)({
            heading: input.heading || "Your Vura offer",
            body: input.body || "Use your code on your next trip.",
            subject: input.subject || "Vura",
            audienceLabel: input.audience,
            promoCode: input.promoCode,
            discountLabel: input.discountLabel,
            expiresAt: input.expiresAt,
            // No saved campaign id in a draft preview — use the generic hero.
            heroUrl: input.imageUrl || `${(0, emailTemplate_1.emailPublicBase)()}/api/email/hero/generic.png`,
            ctaLabel: input.ctaLabel,
            ctaUrl: input.ctaUrl,
            unsubscribeUrl: (0, emailTemplate_1.unsubscribeUrl)("00000000-0000-4000-8000-000000000000", "preview"),
            recipientName: "Thabo",
        });
        res.json({ html });
    }
    catch (err) {
        fail(res, err);
    }
});
exports.default = router;
//# sourceMappingURL=adminEmail.js.map
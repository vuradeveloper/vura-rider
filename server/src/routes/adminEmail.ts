import { Router, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { requireAdmin, resolveAdminActor, writeAudit } from "../services/adminAuth";
import {
  EMAIL_AUDIENCES,
  createEmailCampaign,
  listEmailCampaigns,
  queueEmailCampaign,
  sendTestEmail,
  type EmailAudience,
} from "../services/emailCampaigns";
import {
  emailPublicBase,
  renderMarketingEmail,
  unsubscribeUrl,
} from "../services/emailTemplate";

/**
 * Admin email centre.
 *
 * Mounted at /api/admin/v2/email. A campaign is composed as a draft, previewed,
 * optionally test-sent, then queued. The background worker in
 * services/emailCampaigns.ts does the fan-out so the console request never
 * hangs on thousands of Resend calls.
 */
const router = Router();

function fail(res: Response, err: any): void {
  const status = /required|must be|at least|fewer|Unknown|Choose/.test(String(err?.message || ""))
    ? 400
    : 500;
  if (status === 500) console.error("[admin-email] route error:", err?.message || err);
  res.status(status).json({ error: String(err?.message || "Email request failed") });
}

function bodyToInput(body: any) {
  const audience = String(body?.audience || "riders");
  if (!(EMAIL_AUDIENCES as readonly string[]).includes(audience)) {
    throw new Error("Unknown audience");
  }
  return {
    name: String(body?.name || "").trim(),
    subject: String(body?.subject || "").trim(),
    heading: String(body?.heading || "").trim(),
    body: String(body?.body || "").trim(),
    audience: audience as EmailAudience,
    targetUserIds: Array.isArray(body?.targetUserIds) ? body.targetUserIds.map(String) : null,
    kind: "announcement" as const,
    promoCode: body?.promoCode ? String(body.promoCode).trim().slice(0, 60) : null,
    discountLabel: body?.discountLabel ? String(body.discountLabel).trim().slice(0, 80) : null,
    expiresAt: body?.expiresAt ? String(body.expiresAt) : null,
    imageUrl: body?.imageUrl ? String(body.imageUrl).trim().slice(0, 1000) : null,
    ctaLabel: body?.ctaLabel ? String(body.ctaLabel).trim().slice(0, 40) : "Open Vura",
    ctaUrl: body?.ctaUrl ? String(body.ctaUrl).trim().slice(0, 1000) : "https://www.ridevura.com",
  };
}

router.get("/campaigns", requireAdmin("messaging.send"), async (_req: AuthRequest, res: Response) => {
  try {
    res.json({ campaigns: await listEmailCampaigns(200) });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/campaigns", requireAdmin("messaging.send"), async (req: AuthRequest, res: Response) => {
  try {
    const actor = await resolveAdminActor(req);
    if (!actor) { res.status(403).json({ error: "Admin only" }); return; }
    const campaign = await createEmailCampaign({
      ...bodyToInput(req.body),
      createdBy: actor.email,
    });
    await writeAudit(actor, {
      action: "email.campaign.create",
      entityType: "email_campaign",
      entityId: campaign.id,
      newValue: { subject: campaign.subject, audience: campaign.audience },
    });
    res.status(201).json({ campaign });
  } catch (err) {
    fail(res, err);
  }
});

router.post(
  "/campaigns/:id/send",
  requireAdmin("messaging.send"),
  async (req: AuthRequest, res: Response) => {
    try {
      const actor = await resolveAdminActor(req);
      if (!actor) { res.status(403).json({ error: "Admin only" }); return; }
      const campaign = await queueEmailCampaign(String(req.params.id));
      if (!campaign) {
        res.status(409).json({
          error: "This campaign is already queued, sending or sent.",
          code: "not_queueable",
        });
        return;
      }
      await writeAudit(actor, {
        action: "email.campaign.queue",
        entityType: "email_campaign",
        entityId: campaign.id,
        newValue: { subject: campaign.subject, audience: campaign.audience },
      });
      res.json({ campaign, queued: true });
    } catch (err) {
      fail(res, err);
    }
  }
);

router.post("/test", requireAdmin("messaging.send"), async (req: AuthRequest, res: Response) => {
  try {
    const actor = await resolveAdminActor(req);
    if (!actor) { res.status(403).json({ error: "Admin only" }); return; }
    const input = bodyToInput(req.body);
    await sendTestEmail(input, actor.email);
    res.json({ success: true, sent_to: actor.email });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/preview", requireAdmin("messaging.send"), async (req: AuthRequest, res: Response) => {
  try {
    const input = bodyToInput(req.body);
    const html = renderMarketingEmail({
      heading: input.heading || "Your Vura offer",
      body: input.body || "Use your code on your next trip.",
      subject: input.subject || "Vura",
      audienceLabel: input.audience,
      promoCode: input.promoCode,
      discountLabel: input.discountLabel,
      expiresAt: input.expiresAt,
      // No saved campaign id in a draft preview — use the generic hero.
      heroUrl: input.imageUrl || `${emailPublicBase()}/api/email/hero/generic.png`,
      ctaLabel: input.ctaLabel,
      ctaUrl: input.ctaUrl,
      unsubscribeUrl: unsubscribeUrl("00000000-0000-4000-8000-000000000000", "preview"),
      recipientName: "Thabo",
    });
    res.json({ html });
  } catch (err) {
    fail(res, err);
  }
});

export default router;

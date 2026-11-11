import { createHmac, timingSafeEqual } from "crypto";
import { execute, query, queryOne } from "../config/database";
import { sendResendEmail } from "./adminInvite";
import {
  emailPublicBase,
  renderMarketingEmail,
  unsubscribeUrl,
} from "./emailTemplate";

/**
 * Admin email broadcasts + promo announcement emails.
 *
 * A campaign is queued, then a small background worker sends it in batches.
 * That keeps the HTTP request fast, survives an app-server restart (progress is
 * persisted), and lets the admin see recipient/sent/failed counts.
 *
 * Every message carries a signed unsubscribe link; users who opt out are
 * excluded from every future audience query. This is marketing mail, so it
 * must remain opt-out-able.
 */

export const EMAIL_AUDIENCES = ["riders", "drivers", "all", "specific"] as const;
export type EmailAudience = (typeof EMAIL_AUDIENCES)[number];

export interface EmailCampaignInput {
  name: string;
  subject: string;
  heading: string;
  body: string;
  audience: EmailAudience;
  targetUserIds?: string[] | null;
  kind?: "promo" | "announcement";
  promoId?: string | null;
  promoCode?: string | null;
  discountLabel?: string | null;
  expiresAt?: string | null;
  imageUrl?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  createdBy?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BATCH = 25;
let schemaPromise: Promise<void> | null = null;

export function ensureEmailCampaignSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await execute(`
        CREATE TABLE IF NOT EXISTS email_campaigns (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name TEXT NOT NULL,
          subject TEXT NOT NULL,
          heading TEXT NOT NULL,
          body TEXT NOT NULL,
          audience TEXT NOT NULL DEFAULT 'riders',
          target_user_ids UUID[],
          kind TEXT NOT NULL DEFAULT 'announcement',
          promo_id UUID,
          promo_code TEXT,
          discount_label TEXT,
          expires_at TIMESTAMPTZ,
          image_url TEXT,
          cta_label TEXT,
          cta_url TEXT,
          status TEXT NOT NULL DEFAULT 'draft'
            CHECK (status IN ('draft','queued','sending','sent','failed')),
          recipient_count INTEGER NOT NULL DEFAULT 0,
          processed_count INTEGER NOT NULL DEFAULT 0,
          sent_count INTEGER NOT NULL DEFAULT 0,
          failed_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          created_by TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          queued_at TIMESTAMPTZ,
          started_at TIMESTAMPTZ,
          finished_at TIMESTAMPTZ
        )
      `);
      await execute(`CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON email_campaigns (status, queued_at)`);
      await execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_opt_out BOOLEAN NOT NULL DEFAULT FALSE`).catch(() => undefined);
      await execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_opt_out_at TIMESTAMPTZ`).catch(() => undefined);
      await execute(`ALTER TABLE admin_promos ADD COLUMN IF NOT EXISTS email_sent_at TIMESTAMPTZ`).catch(() => undefined);
      await execute(`ALTER TABLE admin_campaigns ADD COLUMN IF NOT EXISTS email_campaign_id UUID`).catch(() => undefined);
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

function unsubKey(): string {
  return (
    process.env.EMAIL_UNSUB_KEY ||
    process.env.ADMIN_2FA_KEY ||
    "vura-email-unsubscribe-v1"
  );
}

export function emailUnsubToken(userId: string): string {
  return createHmac("sha256", unsubKey())
    .update(`unsubscribe:${userId}`)
    .digest("hex");
}

export function verifyEmailUnsubToken(userId: string, token: string): boolean {
  const expected = Buffer.from(emailUnsubToken(userId));
  const supplied = Buffer.from(String(token || ""));
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

function validate(input: EmailCampaignInput): void {
  if (!EMAIL_AUDIENCES.includes(input.audience)) throw new Error("Unknown audience");
  if (!input.name?.trim() || input.name.trim().length < 3) throw new Error("Name must be at least 3 characters");
  if (!input.subject?.trim()) throw new Error("Subject is required");
  if (!input.heading?.trim()) throw new Error("Heading is required");
  if (!input.body?.trim()) throw new Error("Message is required");
  if (input.subject.length > 180) throw new Error("Subject must be 180 characters or fewer");
  if (input.heading.length > 140) throw new Error("Heading must be 140 characters or fewer");
  if (input.body.length > 4000) throw new Error("Message must be 4 000 characters or fewer");
  if (input.audience === "specific" && (!input.targetUserIds || input.targetUserIds.length === 0)) {
    throw new Error("Choose at least one target user");
  }
}

export async function createEmailCampaign(
  input: EmailCampaignInput
): Promise<any> {
  validate(input);
  await ensureEmailCampaignSchema();
  const row = await queryOne<any>(
    `INSERT INTO email_campaigns
       (name, subject, heading, body, audience, target_user_ids, kind, promo_id,
        promo_code, discount_label, expires_at, image_url, cta_label, cta_url, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::uuid[],$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      input.name.trim().slice(0, 120),
      input.subject.trim().slice(0, 180),
      input.heading.trim().slice(0, 140),
      input.body.trim(),
      input.audience,
      input.targetUserIds?.length ? input.targetUserIds : null,
      input.kind || "announcement",
      input.promoId || null,
      input.promoCode || null,
      input.discountLabel || null,
      input.expiresAt || null,
      input.imageUrl || null,
      input.ctaLabel || "Open Vura",
      input.ctaUrl || "https://www.ridevura.com",
      input.createdBy || null,
    ]
  );
  if (!row) throw new Error("Could not create email campaign");
  if (!row.image_url) {
    const hero = `${emailPublicBase()}/api/email/hero/${row.id}.png`;
    await execute(`UPDATE email_campaigns SET image_url = $2 WHERE id = $1`, [row.id, hero]).catch(
      () => undefined
    );
    row.image_url = hero;
  }
  return row;
}

export async function listEmailCampaigns(limit = 100): Promise<any[]> {
  await ensureEmailCampaignSchema();
  return query(
    `SELECT * FROM email_campaigns ORDER BY created_at DESC LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 100, 1), 500)]
  );
}

export async function getEmailCampaign(id: string): Promise<any | null> {
  await ensureEmailCampaignSchema();
  return queryOne(`SELECT * FROM email_campaigns WHERE id = $1`, [id]);
}

export async function queueEmailCampaign(id: string): Promise<any | null> {
  await ensureEmailCampaignSchema();
  return queryOne(
    `UPDATE email_campaigns
        SET status = 'queued', queued_at = NOW(), last_error = NULL
      WHERE id = $1 AND status IN ('draft', 'failed')
      RETURNING *`,
    [id]
  );
}

function recipientWhere(campaign: any): { sql: string; params: any[] } {
  const audience = String(campaign.audience || "riders");
  const roleClause =
    audience === "riders"
      ? `role IN ('passenger', 'rider')`
      : audience === "drivers"
        ? `role = 'driver'`
        : `role IN ('passenger', 'rider', 'driver')`;
  const params: any[] = [];
  let sql = `email IS NOT NULL AND email <> '' AND COALESCE(email_opt_out, FALSE) = FALSE AND ${roleClause}`;
  if (audience === "specific") {
    const ids = Array.isArray(campaign.target_user_ids) ? campaign.target_user_ids : [];
    if (!ids.length) return { sql: "FALSE", params: [] };
    params.push(ids);
    sql += ` AND id = ANY($${params.length}::uuid[])`;
  }
  return { sql, params };
}

export async function countEmailRecipients(campaign: any): Promise<number> {
  const where = recipientWhere(campaign);
  const row = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM users WHERE ${where.sql}`,
    where.params
  ).catch(() => null);
  return Number(row?.n || 0);
}

/** Queue an email for every recipient of the admin campaign that just pushed. */
export async function queueAdminCampaignEmail(
  campaign: { title: string; body: string; audience: string; name?: string },
  actorEmail: string
): Promise<any | null> {
  const audience: EmailAudience =
    campaign.audience === "riders" || campaign.audience === "drivers" || campaign.audience === "all"
      ? campaign.audience
      : "all";
  const row = await createEmailCampaign({
    name: campaign.name || `Campaign ${campaign.title}`.slice(0, 120),
    subject: campaign.title,
    heading: campaign.title,
    body: campaign.body,
    audience,
    kind: "announcement",
    ctaLabel: "Open Vura",
    ctaUrl: "https://www.ridevura.com",
    createdBy: actorEmail,
  });
  await queueEmailCampaign(row.id);
  return row;
}

/**
 * A newly created/activated promo is also a marketing moment. This claims
 * `admin_promos.email_sent_at` atomically, so editing the same promo or two
 * admins clicking at once can never send the announcement twice.
 */
export async function queuePromoEmail(promo: any, actorEmail: string): Promise<any | null> {
  await ensureEmailCampaignSchema();
  if (!promo?.id || promo.active !== true) return null;
  const claimed = await queryOne<any>(
    `UPDATE admin_promos
        SET email_sent_at = NOW()
      WHERE id = $1 AND email_sent_at IS NULL AND active = TRUE
      RETURNING *`,
    [promo.id]
  ).catch(() => null);
  if (!claimed) return null;

  const pct = Number(claimed.discount_pct || 0);
  const fixed = Number(claimed.discount_fixed || 0);
  const discount = pct > 0 ? `${pct}% off` : fixed > 0 ? `R${fixed.toFixed(2)} off` : "A special offer";
  const audience: EmailAudience =
    claimed.audience === "both" ? "all" : claimed.audience === "driver" ? "drivers" : "riders";
  const targetIds = Array.isArray(claimed.target_user_ids) ? claimed.target_user_ids : null;
  const row = await createEmailCampaign({
    name: `Promo ${claimed.code}`.slice(0, 120),
    subject: `${claimed.title} — ${discount}`,
    heading: claimed.title,
    body:
      claimed.subtitle ||
      `Use code ${claimed.code} on your next Vura trip. The discount is applied automatically at checkout.`,
    audience: targetIds?.length ? "specific" : audience,
    targetUserIds: targetIds,
    kind: "promo",
    promoId: claimed.id,
    promoCode: claimed.code,
    discountLabel: discount,
    expiresAt: claimed.ends_at || null,
    ctaLabel: claimed.audience === "driver" ? "Open Vura Driver" : "Book a ride",
    ctaUrl: "https://www.ridevura.com",
    createdBy: actorEmail,
  });
  await queueEmailCampaign(row.id);
  return row;
}

export async function sendTestEmail(input: EmailCampaignInput, to: string): Promise<void> {
  validate(input);
  const html = renderMarketingEmail({
    heading: input.heading,
    body: input.body,
    subject: input.subject,
    audienceLabel: input.audience,
    promoCode: input.promoCode,
    discountLabel: input.discountLabel,
    expiresAt: input.expiresAt,
    heroUrl: input.imageUrl || `${emailPublicBase()}/api/email/hero/generic.png`,
    ctaLabel: input.ctaLabel,
    ctaUrl: input.ctaUrl,
    unsubscribeUrl: unsubscribeUrl("00000000-0000-4000-8000-000000000000", "test"),
    recipientName: "Test",
  });
  const res = await sendResendEmail({
    to,
    subject: `[TEST] ${input.subject}`,
    html,
  });
  if (!res.ok) throw new Error(res.error || "Could not send test email");
}

async function sendOne(campaign: any, recipient: { id: string; email: string; full_name: string | null }) {
  const html = renderMarketingEmail({
    heading: campaign.heading,
    body: campaign.body,
    subject: campaign.subject,
    audienceLabel: campaign.audience,
    promoCode: campaign.promo_code,
    discountLabel: campaign.discount_label,
    expiresAt: campaign.expires_at,
    heroUrl: campaign.image_url,
    ctaLabel: campaign.cta_label,
    ctaUrl: campaign.cta_url,
    unsubscribeUrl: unsubscribeUrl(recipient.id, emailUnsubToken(recipient.id)),
    recipientName: recipient.full_name,
  });
  let res = await sendResendEmail({
    to: recipient.email,
    subject: campaign.subject,
    html,
  });
  // Resend can 429 a burst. One short retry is enough; a permanent failure is
  // counted and the campaign continues.
  if (!res.ok && /rate|too many|429/i.test(res.error || "")) {
    await new Promise((r) => setTimeout(r, 1200));
    res = await sendResendEmail({ to: recipient.email, subject: campaign.subject, html });
  }
  return res.ok;
}

async function processClaimed(campaign: any): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    await execute(
      `UPDATE email_campaigns
          SET status = 'failed', last_error = $2, finished_at = NOW()
        WHERE id = $1`,
      [campaign.id, "RESEND_API_KEY is not configured"]
    );
    return;
  }

  const where = recipientWhere(campaign);
  const total = await countEmailRecipients(campaign);
  await execute(`UPDATE email_campaigns SET recipient_count = $2 WHERE id = $1`, [
    campaign.id,
    total,
  ]);

  let offset = Number(campaign.processed_count || 0);
  let sent = Number(campaign.sent_count || 0);
  let failed = Number(campaign.failed_count || 0);

  // Keep going until a batch comes back empty. OFFSET is the persisted progress
  // marker, so a restart resumes instead of re-blasting the whole audience.
  for (;;) {
    const limitParam = `$${where.params.length + 1}`;
    const offsetParam = `$${where.params.length + 2}`;
    const rows = await query<{ id: string; email: string; full_name: string | null }>(
      `SELECT id, email, full_name FROM users
        WHERE ${where.sql}
        ORDER BY id
        LIMIT ${limitParam} OFFSET ${offsetParam}`,
      [...where.params, BATCH, offset]
    );
    if (!rows.length) break;

    let batchSent = 0;
    let batchFailed = 0;
    for (const recipient of rows) {
      const email = String(recipient.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) {
        batchFailed++;
        continue;
      }
      const ok = await sendOne(campaign, { ...recipient, email }).catch(() => false);
      if (ok) batchSent++;
      else batchFailed++;
      await new Promise((r) => setTimeout(r, 120));
    }
    offset += rows.length;
    sent += batchSent;
    failed += batchFailed;
    await execute(
      `UPDATE email_campaigns
          SET processed_count = $2, sent_count = $3, failed_count = $4
        WHERE id = $1`,
      [campaign.id, offset, sent, failed]
    );
  }

  await execute(
    `UPDATE email_campaigns
        SET status = 'sent', finished_at = NOW(), recipient_count = $2,
            processed_count = $3, sent_count = $4, failed_count = $5
      WHERE id = $1`,
    [campaign.id, total, offset, sent, failed]
  );
}

let workerBusy = false;

export async function processEmailQueue(): Promise<void> {
  if (workerBusy) return;
  workerBusy = true;
  try {
    await ensureEmailCampaignSchema();
    // A crashed worker leaves a row in `sending`; reclaim it after 15 minutes.
    await execute(
      `UPDATE email_campaigns
          SET status = 'queued'
        WHERE status = 'sending' AND started_at < NOW() - INTERVAL '15 minutes'`
    ).catch(() => undefined);

    const claimed = await queryOne<any>(
      `UPDATE email_campaigns
          SET status = 'sending', started_at = COALESCE(started_at, NOW())
        WHERE id = (
          SELECT id FROM email_campaigns
           WHERE status = 'queued'
           ORDER BY queued_at NULLS FIRST, created_at
           LIMIT 1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING *`
    );
    if (!claimed) return;

    try {
      await processClaimed(claimed);
    } catch (err: any) {
      await execute(
        `UPDATE email_campaigns
            SET status = 'failed', last_error = $2, finished_at = NOW()
          WHERE id = $1`,
        [claimed.id, String(err?.message || err).slice(0, 500)]
      );
      console.error(`[email] campaign ${claimed.id} failed:`, err?.message || err);
    }
  } finally {
    workerBusy = false;
  }
}

export function startEmailCampaignWorker(intervalMs = 10_000): void {
  ensureEmailCampaignSchema().catch((err) =>
    console.error("[email] schema ensure failed:", err?.message || err)
  );
  setInterval(() => {
    void processEmailQueue().catch((err) =>
      console.error("[email] worker tick failed:", err?.message || err)
    );
  }, Math.max(5_000, Number(intervalMs) || 10_000)).unref?.();
}

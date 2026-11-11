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
export declare const EMAIL_AUDIENCES: readonly ["riders", "drivers", "all", "specific"];
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
export declare function ensureEmailCampaignSchema(): Promise<void>;
export declare function emailUnsubToken(userId: string): string;
export declare function verifyEmailUnsubToken(userId: string, token: string): boolean;
export declare function createEmailCampaign(input: EmailCampaignInput): Promise<any>;
export declare function listEmailCampaigns(limit?: number): Promise<any[]>;
export declare function getEmailCampaign(id: string): Promise<any | null>;
export declare function queueEmailCampaign(id: string): Promise<any | null>;
export declare function countEmailRecipients(campaign: any): Promise<number>;
/** Queue an email for every recipient of the admin campaign that just pushed. */
export declare function queueAdminCampaignEmail(campaign: {
    title: string;
    body: string;
    audience: string;
    name?: string;
}, actorEmail: string): Promise<any | null>;
/**
 * A newly created/activated promo is also a marketing moment. This claims
 * `admin_promos.email_sent_at` atomically, so editing the same promo or two
 * admins clicking at once can never send the announcement twice.
 */
export declare function queuePromoEmail(promo: any, actorEmail: string): Promise<any | null>;
export declare function sendTestEmail(input: EmailCampaignInput, to: string): Promise<void>;
export declare function processEmailQueue(): Promise<void>;
export declare function startEmailCampaignWorker(intervalMs?: number): void;
//# sourceMappingURL=emailCampaigns.d.ts.map
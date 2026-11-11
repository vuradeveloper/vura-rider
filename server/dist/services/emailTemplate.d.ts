/**
 * Branded marketing email for admin broadcasts and promo announcements.
 *
 * Deliberately table-based with inline styles: Gmail, Outlook and Apple Mail
 * strip <style> blocks and flex/grid, so a modern-looking React/CSS email
 * collapses in the inbox. The images are served from our own API (logo and a
 * generated hero), so the design works without third-party tracking pixels.
 */
export declare function emailPublicBase(): string;
export declare function unsubscribeUrl(userId: string, token: string): string;
export interface MarketingEmailInput {
    heading: string;
    body: string;
    subject: string;
    audienceLabel: string;
    promoCode?: string | null;
    discountLabel?: string | null;
    expiresAt?: string | null;
    heroUrl?: string | null;
    ctaLabel?: string | null;
    ctaUrl?: string | null;
    unsubscribeUrl: string;
    recipientName?: string | null;
}
export declare function renderMarketingEmail(input: MarketingEmailInput): string;
//# sourceMappingURL=emailTemplate.d.ts.map
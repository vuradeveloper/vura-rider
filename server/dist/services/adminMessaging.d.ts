export declare const CAMPAIGN_AUDIENCES: readonly ["riders", "drivers", "all"];
export type CampaignAudience = (typeof CAMPAIGN_AUDIENCES)[number];
export declare function isCampaignAudience(v: unknown): v is CampaignAudience;
export declare function listCampaigns(limit?: number): Promise<any[]>;
export declare function getCampaign(id: string): Promise<any | null>;
export declare function createCampaign(input: {
    name: string;
    title: string;
    body: string;
    audience: CampaignAudience;
}, actorEmail: string): Promise<any>;
/**
 * Send once. The status flip is the lock: only one caller can move
 * draft → sending, so a double-click is a no-op (returns null).
 * Fan-out runs awaited in batches of 500 with 100ms pauses; per-push
 * failures are counted, never thrown (a dead token must not fail the
 * campaign). Returns the finished row, or null if it was already sent.
 */
export declare function sendCampaign(id: string, actorEmail: string): Promise<any | null>;
//# sourceMappingURL=adminMessaging.d.ts.map
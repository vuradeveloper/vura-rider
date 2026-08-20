export declare const REFERRAL_REWARD = 5;
export declare const REFERRAL_WINDOW_DAYS = 90;
export declare function ensureAffiliateTables(): Promise<void>;
export declare function normalizeCode(code: string): string;
export declare function getAffiliateByUser(dbUserId: string): Promise<any>;
export declare function getOrCreateAffiliate(dbUserId: string, name?: string | null): Promise<any>;
export declare function claimReferral(dbUserId: string, rawCode: string): Promise<{
    success: boolean;
    alreadyReferred: boolean;
} | {
    success: boolean;
    alreadyReferred?: undefined;
}>;
export declare function settleFirstRide(rideId: string): Promise<void>;
export declare function getAffiliateStats(dbUserId: string): Promise<any>;
export declare function listReferrals(dbUserId: string): Promise<any[]>;
export declare function listTransactions(dbUserId: string): Promise<any[]>;
export declare function useBalanceForRide(dbUserId: string, rideId: string): Promise<{
    success: boolean;
    balance: number;
}>;
export declare function listPayouts(status?: string): Promise<any[]>;
export declare function approvePayout(payoutId: string, adminUid: string): Promise<{
    success: boolean;
}>;
//# sourceMappingURL=AffiliateService.d.ts.map
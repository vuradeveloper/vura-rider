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
/** Pure: how much credit may come off this fare — min(balance, fare), never negative. */
export declare function inviteCreditForFare(balance: number, fare: number): number;
/** Read-only pre-check at booking: how much MAY come off. Never throws. */
export declare function inviteCreditAvailable(dbUserId: string, fare: number): Promise<number>;
/**
 * Spend the credit the booking chose: debit the balance and record the spend
 * in ONE transaction, guarded so the balance can never go negative and
 * unique per ride so a re-fire can never double-spend. Returns false when the
 * money did NOT move (caller must put the fare back — nothing is free without
 * the balance actually moving).
 */
export declare function spendInviteCredit(dbUserId: string, rideId: string, discount: number): Promise<boolean>;
export declare function listPayouts(status?: string): Promise<any[]>;
export declare function approvePayout(payoutId: string, adminUid: string): Promise<{
    success: boolean;
}>;
//# sourceMappingURL=AffiliateService.d.ts.map
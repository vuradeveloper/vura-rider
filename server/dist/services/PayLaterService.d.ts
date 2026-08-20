import * as iVerve from "./iVerveService";
export declare const PAY_LATER: {
    readonly MIN_COMPLETED_RIDES: 10;
    readonly BASE_LIMIT: 100;
    readonly LIMIT_STEP: 50;
    readonly RIDES_PER_STEP: 10;
    readonly CAP: 1000;
    readonly COLLECTION_ATTEMPTS_BEFORE_OVERDUE: 3;
};
export declare function computeCreditLimit(completedRides: number): number;
export declare function ensurePayLaterTables(): Promise<void>;
export declare function countCompletedRides(dbUserId: string): Promise<number>;
export interface EnrollInput {
    accountHolder: string;
    bankCode: string;
    accountNumber: string;
    cardToken?: string;
    identityFingerprint?: string;
}
export declare function enrollPayLater(dbUserId: string, input: EnrollInput): Promise<{
    account: any;
    mandate: {
        token: string;
        bankVerified: boolean;
    };
    card: {
        verified: true;
        holdReference: string;
    };
    completed_rides: number;
    mode: iVerve.PaymentsMode;
}>;
export declare function getPayLaterStatus(dbUserId: string): Promise<{
    enrolled: boolean;
    mode: iVerve.PaymentsMode;
    account?: undefined;
    completed_rides?: undefined;
    rides?: undefined;
} | {
    enrolled: boolean;
    mode: iVerve.PaymentsMode;
    account: {
        id: any;
        status: any;
        credit_limit: number;
        outstanding: number;
        available: number;
        account_number_masked: any;
        bank_code: any;
        mandate_token: any;
        card_token: any;
    };
    completed_rides: number;
    rides: any[];
}>;
export declare function refreshPayLaterLimit(dbUserId: string): Promise<{
    account: any;
    completed_rides: number;
}>;
export declare function payRideWithPayLater(dbUserId: string, rideId: string): Promise<{
    success: boolean;
    alreadyPaid: boolean;
    amount_paid?: undefined;
    account?: undefined;
} | {
    success: boolean;
    amount_paid: number;
    account: {
        credit_limit: number;
        outstanding: number;
        available: number;
    };
    alreadyPaid?: undefined;
}>;
export interface CollectionSummary {
    attempted: number;
    succeeded: number;
    failed: number;
    overdue: number;
    details: {
        rideId: string;
        attempt: number;
        result: string;
        overdue: boolean;
    }[];
}
export declare function runMonthlyCollection(): Promise<CollectionSummary>;
export declare function simulatePayLaterRide(dbUserId: string, rideId: string): Promise<{
    rideId: any;
    due_at: string;
    account: {
        credit_limit: number;
        outstanding: number;
        available: number;
    };
}>;
//# sourceMappingURL=PayLaterService.d.ts.map
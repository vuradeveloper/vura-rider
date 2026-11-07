export declare const MIN_SPLIT_RIDERS = 2;
export declare const MAX_SPLIT_RIDERS = 4;
export declare class SplitError extends Error {
    code: string;
    httpStatus: number;
    constructor(code: string, message: string, httpStatus?: number);
}
export interface SplitRow {
    id: string;
    ride_id: string;
    inviter_id: string;
    invitee_id: string | null;
    invitee_email: string;
    amount: number | string;
    status: string;
    share_count: number;
    reference: string | null;
    last_error: string | null;
    paid_at: string | null;
    refunded_at: string | null;
    created_at: string;
}
/** Idempotent schema: the original table existed, the payment columns did not. */
export declare function ensureSplitFareTable(): Promise<void>;
/** Equal share, rounded to cents. Exported so the arithmetic is unit-tested. */
export declare function splitShareRands(fareRands: number, shareCount: number): number;
/** What the booking rider still owes after co-riders' paid shares. */
export declare function primaryRemainderRands(fareRands: number, paidSharesRands: number): number;
export declare function isValidShareCount(value: unknown): boolean;
/**
 * Create one invite. `shareCount` is the TOTAL number of riders including the
 * booking rider (2–4). The share is fixed here as fare ÷ shareCount so every
 * co-rider sees the same amount, even if the estimate later moves.
 */
export declare function createSplitInvite(input: {
    firebaseUid: string;
    rideId: string;
    inviteeEmail: string;
    shareCount: number;
}): Promise<{
    id: string;
    rideId: string;
    inviteeEmail: string;
    amount: number;
    shareCount: number;
    status: string;
}>;
/** Pending split invites for the signed-in rider (Home banner). */
export declare function listPendingInvites(firebaseUid: string): Promise<any[]>;
/** Every split on a ride, for the booking rider's ride screen. */
export declare function listRideSplits(firebaseUid: string, rideId: string): Promise<any[]>;
/**
 * Pay a share. The invitee must be signed in with the same email that was
 * invited. Status is claimed ('paying') before Paystack is called so two taps
 * cannot create two charges.
 */
export declare function paySplit(input: {
    firebaseUid: string;
    splitId: string;
}): Promise<{
    success: true;
    status: "paid";
    amount: number;
    duplicate?: boolean;
}>;
export declare function declineSplit(input: {
    firebaseUid: string;
    splitId: string;
}): Promise<{
    success: true;
    status: "declined";
}>;
/** Sum of co-rider shares already collected for this ride, in rands. */
export declare function paidSplitTotalRands(rideId: string): Promise<number>;
/**
 * A share that is mid-charge is neither payable nor refundable yet. Before the
 * booking rider's hold is captured, wait for those charges to resolve so a
 * share can never be collected twice (once from the co-rider, once from the
 * hold). Returns the number still 'paying' after the timeout.
 */
export declare function waitForPayingSplits(rideId: string, timeoutMs?: number): Promise<number>;
/**
 * Refund every paid share when a ride dies before completion. Idempotent:
 * rows are marked 'refunded' only after Paystack accepts the refund, and
 * already-refunded rows are skipped.
 */
export declare function refundRideSplits(rideId: string): Promise<number>;
//# sourceMappingURL=splitFareService.d.ts.map
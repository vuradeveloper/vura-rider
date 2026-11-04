interface PendingRow {
    ride_id: string;
    driver_id: string;
    amount_cents: number;
    created_at: string;
    ride_status: string | null;
    payment_status: string | null;
    preauth_reference: string | null;
}
type Action = "post" | "capture_then_post" | "void_cancelled" | "void_no_hold" | "void_abandoned" | "skip";
/** Decide what should happen to one pending credit. Pure and testable. */
export declare function decideAction(row: PendingRow, nowMs: number): Action;
export declare function reconcileOnce(): Promise<{
    scanned: number;
    posted: number;
    captured: number;
    voided: number;
    skipped: number;
    failed: number;
}>;
export declare function startCreditReconciler(): void;
export {};
//# sourceMappingURL=creditReconciler.d.ts.map
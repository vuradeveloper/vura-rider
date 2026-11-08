/**
 * Admin support queue: disputes, refund requests and lost-item reports.
 *
 * Riders and drivers already write these rows (routes/disputes.ts), but until
 * now nothing in the admin console could read them. This service is deliberately
 * read/triage-only: it can record a decision and a Paystack reference, but it
 * never moves money. Refund execution stays an operator/Paystack action.
 */
export declare const DISPUTE_STATUSES: readonly ["open", "in_review", "resolved", "declined"];
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];
export declare const LOST_ITEM_STATUSES: readonly ["reported", "in_review", "resolved", "closed"];
export type LostItemStatus = (typeof LOST_ITEM_STATUSES)[number];
export declare const REFUND_STATUSES: readonly ["pending", "approved", "declined", "refunded"];
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export declare class ReportError extends Error {
    statusCode: number;
    constructor(message: string, statusCode?: number);
}
export declare function isReportId(id: string): boolean;
export declare function ensureReportSchema(): Promise<void>;
export interface DisputeFilters {
    status?: string;
    search?: string;
    type?: string;
    excludeType?: string;
}
export interface DisputeListResult {
    disputes: any[];
    total: number;
    counts: Record<string, number>;
}
export declare function listDisputes(filters: DisputeFilters, opts?: {
    limit?: unknown;
    offset?: unknown;
}): Promise<DisputeListResult>;
export declare function getDispute(id: string): Promise<any | null>;
export interface DisputePatch {
    status?: string;
    resolution?: string | null;
    admin_note?: string | null;
    assigned_to?: string | null;
    refund_status?: string | null;
    refund_reference?: string | null;
    refund_amount?: number | string | null;
}
export declare function updateDispute(id: string, patch: DisputePatch, opts?: {
    requireRefund?: boolean;
}): Promise<any | null>;
export interface LostItemFilters {
    status?: string;
    search?: string;
}
export declare function listLostItems(filters: LostItemFilters, opts?: {
    limit?: unknown;
    offset?: unknown;
}): Promise<{
    reports: any[];
    total: number;
    counts: Record<string, number>;
}>;
export declare function getLostItem(id: string): Promise<any | null>;
export interface LostItemPatch {
    status?: string;
    resolution?: string | null;
    admin_note?: string | null;
    assigned_to?: string | null;
    driver_contacted?: boolean;
}
export declare function updateLostItem(id: string, patch: LostItemPatch): Promise<any | null>;
//# sourceMappingURL=adminReports.d.ts.map
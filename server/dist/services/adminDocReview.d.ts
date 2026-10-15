/** Static fallback; the live list is the active admin_required_docs (settings). */
export declare const REQUIRED_DOC_TYPES: string[];
/**
 * Which required documents a driver is still missing — the DRIVER APP's gate.
 *
 * A brand-new driver whose list is not fully approved opens on the documents &
 * vehicle screen ONLY; a fully approved driver goes straight to driver home.
 * Same source as allRequiredApproved: the active admin_required_docs settings,
 * with REQUIRED_DOC_TYPES as the pre-005 fallback (requiredTypes()).
 */
export declare function requiredDocsStatus(driverId: string): Promise<{
    approved: boolean;
    missing: string[];
    required: string[];
}>;
/** True when the driver has EVERY active required document approved. */
export declare function allRequiredApproved(driverId: string): Promise<boolean>;
/**
 * Review ONE document. Returns null when the document does not exist.
 * When an approval COMPLETES the driver's set (was incomplete → now
 * complete), the driver gets the single "all verified" push.
 */
export declare function reviewDocument(id: string, status: "approved" | "rejected" | "pending_review", note: string | null, actorLabel: string): Promise<{
    document: any;
    allApproved: boolean;
} | null>;
//# sourceMappingURL=adminDocReview.d.ts.map
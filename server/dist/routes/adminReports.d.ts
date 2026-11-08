/**
 * Admin support queue.
 *
 *   GET   /api/admin/v2/disputes            disputes (refund requests excluded)
 *   GET   /api/admin/v2/disputes/:id        one dispute
 *   PATCH /api/admin/v2/disputes/:id        triage / resolution
 *   GET   /api/admin/v2/refunds             refund requests (type='refund')
 *   PATCH /api/admin/v2/refunds/:id         refund decision + Paystack reference
 *   GET   /api/admin/v2/lost-items          lost-item reports
 *   GET   /api/admin/v2/lost-items/:id      one lost-item report
 *   PATCH /api/admin/v2/lost-items/:id      triage / resolution
 *
 * No money moves here. A refund decision records the operator's approval and
 * the Paystack reference so finance can reconcile it; the actual refund stays a
 * Paystack dashboard action.
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=adminReports.d.ts.map
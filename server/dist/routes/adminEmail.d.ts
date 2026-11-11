/**
 * Admin email centre.
 *
 * Mounted at /api/admin/v2/email. A campaign is composed as a draft, previewed,
 * optionally test-sent, then queued. The background worker in
 * services/emailCampaigns.ts does the fan-out so the console request never
 * hangs on thousands of Resend calls.
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=adminEmail.d.ts.map
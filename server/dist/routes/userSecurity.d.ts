/**
 * Account security for riders and drivers.
 *
 * Mounted at /api/users/security. Every route except `status` and
 * `2fa/verify` is behind the normal auth middleware AND, when 2FA is on, the
 * step-up gate in middleware/auth.ts. `verify` has to be reachable BEFORE the
 * gate passes — that is the whole point of it.
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=userSecurity.d.ts.map
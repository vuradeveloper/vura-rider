/**
 * Admin TOTP 2FA endpoints.
 *
 * These routes use Firebase auth + admin-role resolution, but deliberately do
 * NOT use requireAdmin(): that middleware itself requires a valid MFA token, so
 * using it here would make enrollment impossible. The reset route is the one
 * exception – it is a governance action and requires a fully authenticated
 * admin (including their own MFA token).
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=adminMfa.d.ts.map
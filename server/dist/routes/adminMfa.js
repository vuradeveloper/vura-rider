"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const firebase_1 = require("../config/firebase");
const adminAuth_1 = require("../services/adminAuth");
const adminMfa_1 = require("../services/adminMfa");
/**
 * Admin TOTP 2FA endpoints.
 *
 * These routes use Firebase auth + admin-role resolution, but deliberately do
 * NOT use requireAdmin(): that middleware itself requires a valid MFA token, so
 * using it here would make enrollment impossible. The reset route is the one
 * exception – it is a governance action and requires a fully authenticated
 * admin (including their own MFA token).
 */
const router = (0, express_1.Router)();
async function mfaAdmin(req) {
    const uid = req.userId;
    const email = String(req.user?.email || "").trim().toLowerCase();
    if (!uid)
        return null;
    const role = await (0, adminAuth_1.resolveAdminRole)(email);
    if (role)
        return { uid, email };
    // Legacy admin accounts: users.role='admin'. Admin V2 is the normal path, but
    // the MFA screen must still be reachable during the transition.
    try {
        const user = await (0, database_1.queryOne)("SELECT role FROM users WHERE firebase_uid = $1", [uid]);
        if (String(user?.role || "").toLowerCase() === "admin")
            return { uid, email };
    }
    catch {
        /* table/permission issue — the caller stays unauthenticated */
    }
    return null;
}
function fail(res, err, fallback) {
    const status = err instanceof adminMfa_1.AdminMfaError ? err.statusCode : Number(err?.statusCode) || 500;
    if (status >= 500)
        console.error(`[admin-mfa] ${fallback}:`, err?.message || err);
    res.status(status).json({
        error: err?.message || fallback,
        code: err instanceof adminMfa_1.AdminMfaError ? err.code : "mfa_error",
    });
}
// GET /api/admin/v2/mfa/status — is this admin enrolled/locked?
router.get("/status", auth_1.requireAuth, async (req, res) => {
    try {
        const admin = await mfaAdmin(req);
        if (!admin) {
            res.status(403).json({ error: "Admin only", code: "admin_only" });
            return;
        }
        res.json(await (0, adminMfa_1.getAdminMfaStatus)(admin.uid));
    }
    catch (err) {
        fail(res, err, "Could not read the 2FA status");
    }
});
// POST /api/admin/v2/mfa/setup — create a pending secret + otpauth URI
router.post("/setup", auth_1.requireAuth, async (req, res) => {
    try {
        const admin = await mfaAdmin(req);
        if (!admin) {
            res.status(403).json({ error: "Admin only", code: "admin_only" });
            return;
        }
        const setup = await (0, adminMfa_1.startAdminMfaSetup)(admin.uid, admin.email);
        res.json(setup);
    }
    catch (err) {
        fail(res, err, "Could not start 2FA setup");
    }
});
// POST /api/admin/v2/mfa/enable — verify the first code and return recovery codes
router.post("/enable", auth_1.requireAuth, async (req, res) => {
    try {
        const admin = await mfaAdmin(req);
        if (!admin) {
            res.status(403).json({ error: "Admin only", code: "admin_only" });
            return;
        }
        const code = String(req.body?.code || "").trim();
        if (!code) {
            res.status(400).json({ error: "Enter the code from your authenticator app." });
            return;
        }
        const result = await (0, adminMfa_1.enableAdminMfa)(admin.uid, code);
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (actor) {
            await (0, adminAuth_1.writeAudit)(actor, {
                action: "admin.mfa.enable",
                entityType: "admin_user",
                entityId: admin.uid,
                newValue: { enabled: true },
            });
        }
        res.json(result);
    }
    catch (err) {
        fail(res, err, "Could not enable 2FA");
    }
});
// POST /api/admin/v2/mfa/verify — TOTP or one-time recovery code -> session token
router.post("/verify", auth_1.requireAuth, async (req, res) => {
    try {
        const admin = await mfaAdmin(req);
        if (!admin) {
            res.status(403).json({ error: "Admin only", code: "admin_only" });
            return;
        }
        const code = String(req.body?.code || "").trim();
        if (!code) {
            res.status(400).json({ error: "Enter your authenticator code." });
            return;
        }
        res.json(await (0, adminMfa_1.verifyAdminMfa)(admin.uid, code));
    }
    catch (err) {
        fail(res, err, "Could not verify the 2FA code");
    }
});
// POST /api/admin/v2/mfa/disable — require a current code
router.post("/disable", auth_1.requireAuth, async (req, res) => {
    try {
        const admin = await mfaAdmin(req);
        if (!admin) {
            res.status(403).json({ error: "Admin only", code: "admin_only" });
            return;
        }
        const code = String(req.body?.code || "").trim();
        if (!code) {
            res.status(400).json({ error: "Enter a current authenticator code." });
            return;
        }
        await (0, adminMfa_1.disableAdminMfa)(admin.uid, code);
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (actor) {
            await (0, adminAuth_1.writeAudit)(actor, {
                action: "admin.mfa.disable",
                entityType: "admin_user",
                entityId: admin.uid,
                newValue: { enabled: false },
            });
        }
        res.json({ success: true });
    }
    catch (err) {
        fail(res, err, "Could not disable 2FA");
    }
});
// POST /api/admin/v2/mfa/reset — governance-only lockout recovery.
// Requires a fully authenticated governance admin (including their own MFA).
router.post("/reset", (0, adminAuth_1.requireAdmin)("admins.manage"), async (req, res) => {
    try {
        let uid = String(req.body?.uid || "").trim();
        const email = String(req.body?.email || "").trim().toLowerCase();
        if (!uid && email) {
            const account = await (0, firebase_1.getAuth)().getUserByEmail(email).catch(() => null);
            uid = account?.uid || "";
        }
        if (!uid) {
            res.status(404).json({ error: "Admin account not found" });
            return;
        }
        await (0, adminMfa_1.resetAdminMfa)(uid);
        const actor = await (0, adminAuth_1.resolveAdminActor)(req);
        if (actor) {
            await (0, adminAuth_1.writeAudit)(actor, {
                action: "admin.mfa.reset",
                entityType: "admin_user",
                entityId: uid,
                newValue: { enabled: false, email: email || null },
            });
        }
        res.json({ success: true });
    }
    catch (err) {
        fail(res, err, "Could not reset 2FA");
    }
});
exports.default = router;
//# sourceMappingURL=adminMfa.js.map
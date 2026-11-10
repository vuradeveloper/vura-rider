"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.optionalAuth = optionalAuth;
const firebase_1 = require("../config/firebase");
const database_1 = require("../config/database");
const featureFlags_1 = require("../services/featureFlags");
// The DB role is only needed while a maintenance lock / revoke epoch is in
// play. Cached briefly so a locked platform does not add one SELECT per request.
const roleCache = new Map();
const ROLE_CACHE_MS = 60_000;
async function dbRoleFor(uid) {
    const hit = roleCache.get(uid);
    if (hit && Date.now() - hit.at < ROLE_CACHE_MS)
        return hit.role;
    const row = await (0, database_1.queryOne)("SELECT role FROM users WHERE firebase_uid = $1", [uid]).catch(() => null);
    const role = row?.role ?? null;
    roleCache.set(uid, { role, at: Date.now() });
    return role;
}
/** Firebase auth_time/iat are Unix seconds. */
function tokenAuthTime(decoded) {
    const n = Number(decoded?.auth_time ?? decoded?.iat ?? 0);
    return Number.isFinite(n) ? n : 0;
}
/**
 * The backend kill switch. While a side is locked, every authenticated call
 * from that side is rejected with 401 (the apps cannot get data or book), and
 * any token issued before `revoke_before` is rejected even after unlock. The
 * Firebase sign-in call itself is client-side; this is the server-side logout.
 */
async function maintenanceBlock(decoded) {
    const maint = await (0, featureFlags_1.readMaintenanceStatus)();
    const riderOn = maint.rider.enabled || Boolean(maint.rider.revokeBefore);
    const driverOn = maint.driver.enabled || Boolean(maint.driver.revokeBefore);
    if (!riderOn && !driverOn)
        return null;
    const role = await dbRoleFor(String(decoded.uid || ""));
    if (!role)
        return null; // brand-new Firebase user — /api/users/sync decides
    const side = role === "driver"
        ? maint.driver
        : role === "passenger" || role === "rider"
            ? maint.rider
            : null;
    if (!side)
        return null;
    if (side.enabled) {
        return { code: "maintenance", message: side.message };
    }
    if (side.revokeBefore) {
        const cutoff = Math.floor(new Date(side.revokeBefore).getTime() / 1000);
        if (Number.isFinite(cutoff) && tokenAuthTime(decoded) < cutoff) {
            return {
                code: "session_revoked",
                message: "Your session was ended by Vura. Please sign in again.",
            };
        }
    }
    return null;
}
/**
 * Middleware: Verifies Firebase ID token from Authorization header.
 * Attaches userId and user info to the request object.
 */
async function requireAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            res.status(401).json({ error: "Missing or invalid Authorization header" });
            return;
        }
        const token = authHeader.split("Bearer ")[1];
        if (!token) {
            res.status(401).json({ error: "Missing token" });
            return;
        }
        const decoded = await (0, firebase_1.getAuth)().verifyIdToken(token);
        // Maintenance / forced-logout gate (rider or driver side).
        const blocked = await maintenanceBlock(decoded);
        if (blocked) {
            res.status(401).json({ error: blocked.message, code: blocked.code });
            return;
        }
        req.userId = decoded.uid;
        req.user = {
            uid: decoded.uid,
            email: decoded.email,
            phone_number: decoded.phone_number,
            name: decoded.name,
            picture: decoded.picture,
        };
        next();
    }
    catch (error) {
        console.error("Auth verification failed:", error.code || error.message);
        if (error.code === "auth/id-token-expired") {
            res.status(401).json({ error: "Token expired. Please sign in again." });
        }
        else {
            res.status(401).json({ error: "Authentication failed" });
        }
    }
}
/**
 * Optional auth: attaches user info if token is present, but doesn't block.
 */
async function optionalAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            const token = authHeader.split("Bearer ")[1];
            if (token) {
                const decoded = await (0, firebase_1.getAuth)().verifyIdToken(token);
                req.userId = decoded.uid;
                req.user = {
                    uid: decoded.uid,
                    email: decoded.email,
                    phone_number: decoded.phone_number,
                    name: decoded.name,
                    picture: decoded.picture,
                };
            }
        }
    }
    catch {
        // Ignore — auth is optional
    }
    next();
}
//# sourceMappingURL=auth.js.map
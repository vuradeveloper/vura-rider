"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserSecurityError = void 0;
exports.ensureUserSecuritySchema = ensureUserSecuritySchema;
exports.issueUserStepUpToken = issueUserStepUpToken;
exports.verifyUserStepUpToken = verifyUserStepUpToken;
exports.invalidateUserSecurityCache = invalidateUserSecurityCache;
exports.getUserSecurityGate = getUserSecurityGate;
exports.twoFactorSatisfied = twoFactorSatisfied;
exports.invalidateDeviceCache = invalidateDeviceCache;
exports.isDeviceRevoked = isDeviceRevoked;
exports.logSecurityEvent = logSecurityEvent;
exports.getSecurityStatus = getSecurityStatus;
exports.startTwoFactorSetup = startTwoFactorSetup;
exports.enableTwoFactor = enableTwoFactor;
exports.verifyTwoFactor = verifyTwoFactor;
exports.disableTwoFactor = disableTwoFactor;
exports.regenerateRecoveryCodes = regenerateRecoveryCodes;
exports.resetUserSecurity = resetUserSecurity;
exports.startSession = startSession;
exports.heartbeatSession = heartbeatSession;
exports.listSessions = listSessions;
exports.revokeSession = revokeSession;
exports.revokeAllSessions = revokeAllSessions;
exports.listSecurityActivity = listSecurityActivity;
const crypto_1 = require("crypto");
const database_1 = require("../config/database");
const firebase_1 = require("../config/firebase");
const adminMfa_1 = require("./adminMfa");
const adminInvite_1 = require("./adminInvite");
/**
 * Rider/driver account security.
 *
 * Plain Firebase Auth has no account MFA in this project, so this service
 * implements the same standard TOTP flow as the admin console:
 *
 *   • authenticator-app 2FA (Google Authenticator / Authy / Microsoft)
 *   • 8 one-time recovery codes, stored only as SHA-256 hashes
 *   • five wrong codes lock the account for 15 minutes
 *   • a short-lived HMAC "step-up" token proves the second factor per device
 *   • device/session registry with last-seen, remote sign-out and a hard
 *     per-user token cutoff (`users.sessions_valid_after`)
 *
 * The step-up token is deliberately NOT a Firebase custom claim: claims live
 * for the life of the account, so a claim would make every future sign-in look
 * verified. This token is stored by the app, sent as `X-Vura-2FA`, and can be
 * killed server-side by bumping the security epoch.
 */
const TOKEN_DAYS = 30;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const GATE_CACHE_MS = 30_000;
const DEVICE_CACHE_MS = 30_000;
class UserSecurityError extends Error {
    statusCode;
    code;
    constructor(message, statusCode = 400, code = "security_error") {
        super(message);
        this.name = "UserSecurityError";
        this.statusCode = statusCode;
        this.code = code;
    }
}
exports.UserSecurityError = UserSecurityError;
let schemaPromise = null;
function ensureUserSecuritySchema() {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            await (0, database_1.execute)(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_after TIMESTAMPTZ`);
            await (0, database_1.execute)(`
        CREATE TABLE IF NOT EXISTS user_security (
          user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          secret_enc TEXT,
          enabled BOOLEAN NOT NULL DEFAULT FALSE,
          epoch INTEGER NOT NULL DEFAULT 0,
          recovery_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
          failed_attempts INTEGER NOT NULL DEFAULT 0,
          locked_until TIMESTAMPTZ,
          confirmed_at TIMESTAMPTZ,
          last_used_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
            await (0, database_1.execute)(`
        CREATE TABLE IF NOT EXISTS user_sessions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          device_id TEXT NOT NULL,
          platform TEXT,
          app TEXT,
          app_version TEXT,
          device_name TEXT,
          ip_hash TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          revoked_at TIMESTAMPTZ,
          UNIQUE (user_id, device_id)
        )
      `);
            await (0, database_1.execute)(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_seen ON user_sessions (user_id, last_seen_at DESC)`);
            await (0, database_1.execute)(`
        CREATE TABLE IF NOT EXISTS user_security_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          event TEXT NOT NULL,
          detail JSONB NOT NULL DEFAULT '{}'::jsonb,
          ip_hash TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
            await (0, database_1.execute)(`CREATE INDEX IF NOT EXISTS idx_user_security_events_user ON user_security_events (user_id, created_at DESC)`);
        })().catch((err) => {
            schemaPromise = null;
            throw err;
        });
    }
    return schemaPromise;
}
function asStringArray(value) {
    if (Array.isArray(value))
        return value.map(String);
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed.map(String) : [];
        }
        catch {
            return [];
        }
    }
    return [];
}
async function userRow(uid) {
    return (0, database_1.queryOne)(`SELECT id, email FROM users WHERE firebase_uid = $1`, [uid]);
}
function hashIp(ip) {
    const clean = String(ip || "").trim();
    if (!clean)
        return null;
    try {
        return (0, crypto_1.createHash)("sha256")
            .update(`${(0, adminMfa_1.securityKeyMaterial)()}:ip:${clean}`)
            .digest("hex")
            .slice(0, 32);
    }
    catch {
        return null;
    }
}
// ── Step-up token ────────────────────────────────────────────────────────────
function tokenKey() {
    return (0, crypto_1.createHash)("sha256").update(`${(0, adminMfa_1.securityKeyMaterial)()}:user-security-token`).digest();
}
function issueUserStepUpToken(uid, epoch) {
    const payload = Buffer.from(JSON.stringify({ sub: uid, epoch, exp: Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000 })).toString("base64url");
    const sig = (0, crypto_1.createHmac)("sha256", tokenKey()).update(payload).digest("base64url");
    return `${payload}.${sig}`;
}
function verifyUserStepUpToken(uid, token, epoch) {
    if (!token)
        return false;
    const [payload, sig] = String(token).split(".");
    if (!payload || !sig)
        return false;
    const expected = (0, crypto_1.createHmac)("sha256", tokenKey()).update(payload).digest("base64url");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !(0, crypto_1.timingSafeEqual)(a, b))
        return false;
    try {
        const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        return (data?.sub === uid &&
            Number(data?.epoch) === Number(epoch) &&
            Number(data?.exp) > Date.now());
    }
    catch {
        return false;
    }
}
const gateCache = new Map();
function invalidateUserSecurityCache(uid) {
    gateCache.delete(uid);
}
async function getUserSecurityGate(uid) {
    const cached = gateCache.get(uid);
    if (cached && cached.expires > Date.now()) {
        const { expires: _expires, ...gate } = cached;
        return gate;
    }
    let gate = { enabled: false, epoch: 0, sessionsValidAfter: 0 };
    try {
        const row = await (0, database_1.queryOne)(`SELECT u.sessions_valid_after, s.enabled, s.epoch
         FROM users u
         LEFT JOIN user_security s ON s.user_id = u.id
        WHERE u.firebase_uid = $1`, [uid]);
        if (row) {
            gate = {
                enabled: row.enabled === true,
                epoch: Number(row.epoch || 0),
                sessionsValidAfter: row.sessions_valid_after
                    ? Math.floor(new Date(row.sessions_valid_after).getTime() / 1000)
                    : 0,
            };
        }
    }
    catch (err) {
        // Feature tables may not exist yet on the very first request after a
        // deploy. Do not lock every account out of the platform for that.
        console.warn("[user-security] gate read failed:", err?.message || err);
        try {
            const row = await (0, database_1.queryOne)(`SELECT sessions_valid_after FROM users WHERE firebase_uid = $1`, [uid]);
            if (row?.sessions_valid_after) {
                gate.sessionsValidAfter = Math.floor(new Date(row.sessions_valid_after).getTime() / 1000);
            }
        }
        catch {
            /* fail open on infrastructure failure */
        }
    }
    gateCache.set(uid, { ...gate, expires: Date.now() + GATE_CACHE_MS });
    return gate;
}
/** True when this request carries a valid second-factor proof. */
async function twoFactorSatisfied(uid, header) {
    const gate = await getUserSecurityGate(uid);
    if (!gate.enabled)
        return true;
    return verifyUserStepUpToken(uid, String(header || ""), gate.epoch);
}
// ── Device revocation cache ──────────────────────────────────────────────────
const deviceCache = new Map();
function invalidateDeviceCache(uid, deviceId) {
    deviceCache.delete(`${uid}:${deviceId}`);
}
async function isDeviceRevoked(uid, deviceId) {
    const key = `${uid}:${deviceId}`;
    const cached = deviceCache.get(key);
    if (cached && cached.expires > Date.now())
        return cached.revoked;
    let revoked = false;
    try {
        const row = await (0, database_1.queryOne)(`SELECT s.revoked_at
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE u.firebase_uid = $1 AND s.device_id = $2`, [uid, deviceId]);
        revoked = Boolean(row?.revoked_at);
    }
    catch {
        revoked = false;
    }
    deviceCache.set(key, { revoked, expires: Date.now() + DEVICE_CACHE_MS });
    return revoked;
}
// ── Activity log + alerts ────────────────────────────────────────────────────
async function logSecurityEvent(uid, event, detail = {}, ip) {
    try {
        const user = await userRow(uid);
        if (!user)
            return;
        await (0, database_1.execute)(`INSERT INTO user_security_events (user_id, event, detail, ip_hash)
       VALUES ($1, $2, $3::jsonb, $4)`, [user.id, event, JSON.stringify(detail), hashIp(ip)]);
    }
    catch (err) {
        console.warn("[user-security] event log failed:", err?.message || err);
    }
}
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
async function sendNewDeviceAlert(email, input) {
    if (!email)
        return;
    const device = escapeHtml(input.deviceName || "Unknown device");
    const app = escapeHtml(input.app || "Vura");
    const when = new Date().toUTCString();
    await (0, adminInvite_1.sendResendEmail)({
        to: email,
        subject: "New sign-in to your Vura account",
        html: `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1A1A1A">
        <h2 style="margin:0 0 12px">New sign-in to your Vura account</h2>
        <p>We noticed a sign-in from a device we have not seen before:</p>
        <table style="border-collapse:collapse;margin:14px 0">
          <tr><td style="padding:4px 14px 4px 0;color:#888">Device</td><td>${device}</td></tr>
          <tr><td style="padding:4px 14px 4px 0;color:#888">App</td><td>${app}</td></tr>
          <tr><td style="padding:4px 14px 4px 0;color:#888">Time (UTC)</td><td>${when}</td></tr>
        </table>
        <p><b>If this was you, no action is needed.</b></p>
        <p>If it was not you, open the Vura app → Account → Settings → Security &amp; devices and tap
        <b>Sign out of all devices</b>, then change your password. If you cannot sign in, reply to this
        email or contact support.</p>
        <p style="color:#888;font-size:12px">Vura will never ask for your password or authenticator code by email.</p>
      </div>`,
    }).catch(() => undefined);
}
// ── 2FA setup / verify / disable ────────────────────────────────────────────
function otpauthUrl(email, secret) {
    const label = encodeURIComponent(`Vura:${email || "account"}`);
    const params = new URLSearchParams({
        secret,
        issuer: "Vura",
        algorithm: "SHA1",
        digits: "6",
        period: "30",
    });
    return `otpauth://totp/${label}?${params.toString()}`;
}
async function securityRow(userId) {
    await ensureUserSecuritySchema();
    return (0, database_1.queryOne)(`SELECT * FROM user_security WHERE user_id = $1`, [userId]);
}
function assertNotLocked(row) {
    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
        throw new UserSecurityError("Too many incorrect codes. Try again in a few minutes.", 429, "security_locked");
    }
}
async function recordFailure(userId, row) {
    const attempts = Number(row.failed_attempts || 0) + 1;
    if (attempts >= MAX_FAILED_ATTEMPTS) {
        const until = new Date(Date.now() + LOCK_MINUTES * 60_000);
        await (0, database_1.execute)(`UPDATE user_security
          SET failed_attempts = 0, locked_until = $2, updated_at = NOW()
        WHERE user_id = $1`, [userId, until]).catch(() => { });
        throw new UserSecurityError(`Too many incorrect codes. Try again in ${LOCK_MINUTES} minutes.`, 429, "security_locked");
    }
    await (0, database_1.execute)(`UPDATE user_security SET failed_attempts = $2, updated_at = NOW() WHERE user_id = $1`, [userId, attempts]).catch(() => { });
    throw new UserSecurityError("That code is not valid. Open your authenticator app and use the current 6-digit code.", 400, "security_invalid_code");
}
async function getSecurityStatus(uid) {
    const user = await userRow(uid);
    if (!user)
        throw new UserSecurityError("User not found", 404, "user_not_found");
    const row = await securityRow(user.id);
    return {
        two_factor_enabled: row?.enabled === true && !!row.secret_enc,
        configured: !!row?.secret_enc,
        recovery_codes_left: asStringArray(row?.recovery_hashes ?? null).length,
        locked_until: row?.locked_until ? new Date(row.locked_until).toISOString() : null,
        last_used_at: row?.last_used_at ? new Date(row.last_used_at).toISOString() : null,
    };
}
async function startTwoFactorSetup(uid, emailHint) {
    const user = await userRow(uid);
    if (!user)
        throw new UserSecurityError("User not found", 404, "user_not_found");
    const existing = await securityRow(user.id);
    if (existing?.enabled) {
        throw new UserSecurityError("Two-factor authentication is already on. Turn it off first to set up a new device.", 409, "security_already_enabled");
    }
    const secret = (0, adminMfa_1.generateTotpSecret)();
    await (0, database_1.execute)(`INSERT INTO user_security
       (user_id, secret_enc, enabled, epoch, recovery_hashes, failed_attempts, updated_at)
     VALUES ($1, $2, FALSE, 0, '[]'::jsonb, 0, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET secret_enc = EXCLUDED.secret_enc, enabled = FALSE,
           recovery_hashes = '[]'::jsonb, failed_attempts = 0,
           locked_until = NULL, confirmed_at = NULL, updated_at = NOW()`, [user.id, (0, adminMfa_1.sealSecret)(secret)]);
    invalidateUserSecurityCache(uid);
    return {
        secret,
        otpauth_uri: otpauthUrl(String(emailHint || user.email || ""), secret),
    };
}
async function enableTwoFactor(uid, code) {
    const user = await userRow(uid);
    if (!user)
        throw new UserSecurityError("User not found", 404, "user_not_found");
    const row = await securityRow(user.id);
    if (!row)
        throw new UserSecurityError("Start the authenticator setup first.", 400, "security_setup_missing");
    if (row.enabled)
        throw new UserSecurityError("Two-factor authentication is already on.", 409, "security_already_enabled");
    assertNotLocked(row);
    const secret = (0, adminMfa_1.openSecret)(row.secret_enc);
    if (!secret)
        throw new UserSecurityError("Start the authenticator setup first.", 400, "security_setup_missing");
    if (!(0, adminMfa_1.verifyTotp)(secret, code))
        return recordFailure(user.id, row);
    const recovery = (0, adminMfa_1.generateRecoveryCodeSet)();
    const epoch = Number(row.epoch || 0) + 1;
    await (0, database_1.execute)(`UPDATE user_security
        SET enabled = TRUE, epoch = $2, recovery_hashes = $3::jsonb,
            failed_attempts = 0, locked_until = NULL, confirmed_at = NOW(), updated_at = NOW()
      WHERE user_id = $1`, [user.id, epoch, JSON.stringify(recovery.hashes)]);
    invalidateUserSecurityCache(uid);
    await logSecurityEvent(uid, "2fa_enabled");
    // Existing sockets authenticated before 2FA was switched on must not keep
    // receiving ride events. Delay long enough for THIS request's response to
    // reach the app and store its step-up token, otherwise the enabling device
    // would reconnect without a proof and bounce itself to the challenge screen.
    const timer = setTimeout(() => disconnectDeviceSockets(uid, undefined, "security:2fa-enabled"), 3000);
    timer.unref?.();
    return { recovery_codes: recovery.plain, token: issueUserStepUpToken(uid, epoch) };
}
async function verifyTwoFactor(uid, code) {
    const user = await userRow(uid);
    if (!user)
        throw new UserSecurityError("User not found", 404, "user_not_found");
    const row = await securityRow(user.id);
    if (!row?.enabled || !row.secret_enc) {
        throw new UserSecurityError("Two-factor authentication is not on.", 400, "security_not_enabled");
    }
    assertNotLocked(row);
    const secret = (0, adminMfa_1.openSecret)(row.secret_enc);
    if (!secret) {
        throw new UserSecurityError("The authenticator secret could not be read. Contact support to reset 2FA.", 500, "security_secret_unreadable");
    }
    let usedRecoveryHash = null;
    let ok = (0, adminMfa_1.verifyTotp)(secret, code);
    if (!ok) {
        const supplied = (0, adminMfa_1.hashRecoveryCode)(code);
        const hashes = asStringArray(row.recovery_hashes);
        if (hashes.some((hash) => (0, adminMfa_1.constantTimeEqual)(String(hash), supplied))) {
            ok = true;
            usedRecoveryHash = supplied;
        }
    }
    if (!ok)
        return recordFailure(user.id, row);
    const epoch = Number(row.epoch || 0);
    if (usedRecoveryHash) {
        const remaining = asStringArray(row.recovery_hashes).filter((hash) => !(0, adminMfa_1.constantTimeEqual)(String(hash), usedRecoveryHash));
        await (0, database_1.execute)(`UPDATE user_security
          SET recovery_hashes = $2::jsonb, failed_attempts = 0, locked_until = NULL,
              last_used_at = NOW(), updated_at = NOW()
        WHERE user_id = $1`, [user.id, JSON.stringify(remaining)]);
        await logSecurityEvent(uid, "2fa_recovery_code_used", {
            remaining: remaining.length,
        });
    }
    else {
        await (0, database_1.execute)(`UPDATE user_security
          SET failed_attempts = 0, locked_until = NULL, last_used_at = NOW(), updated_at = NOW()
        WHERE user_id = $1`, [user.id]);
    }
    invalidateUserSecurityCache(uid);
    return { token: issueUserStepUpToken(uid, epoch), used_recovery: !!usedRecoveryHash };
}
async function disableTwoFactor(uid, code) {
    const user = await userRow(uid);
    if (!user)
        throw new UserSecurityError("User not found", 404, "user_not_found");
    const row = await securityRow(user.id);
    if (!row?.enabled || !row.secret_enc) {
        throw new UserSecurityError("Two-factor authentication is not on.", 400, "security_not_enabled");
    }
    assertNotLocked(row);
    const secret = (0, adminMfa_1.openSecret)(row.secret_enc);
    if (!secret || !(0, adminMfa_1.verifyTotp)(secret, code)) {
        if (!secret) {
            throw new UserSecurityError("The authenticator secret could not be read.", 500, "security_secret_unreadable");
        }
        return recordFailure(user.id, row);
    }
    await (0, database_1.execute)(`UPDATE user_security
        SET enabled = FALSE, secret_enc = NULL, recovery_hashes = '[]'::jsonb,
            epoch = epoch + 1, failed_attempts = 0, locked_until = NULL, updated_at = NOW()
      WHERE user_id = $1`, [user.id]);
    invalidateUserSecurityCache(uid);
    await logSecurityEvent(uid, "2fa_disabled");
}
async function regenerateRecoveryCodes(uid, code) {
    const user = await userRow(uid);
    if (!user)
        throw new UserSecurityError("User not found", 404, "user_not_found");
    const row = await securityRow(user.id);
    if (!row?.enabled || !row.secret_enc) {
        throw new UserSecurityError("Two-factor authentication is not on.", 400, "security_not_enabled");
    }
    assertNotLocked(row);
    const secret = (0, adminMfa_1.openSecret)(row.secret_enc);
    if (!secret || !(0, adminMfa_1.verifyTotp)(secret, code)) {
        if (!secret) {
            throw new UserSecurityError("The authenticator secret could not be read.", 500, "security_secret_unreadable");
        }
        return recordFailure(user.id, row);
    }
    const recovery = (0, adminMfa_1.generateRecoveryCodeSet)();
    await (0, database_1.execute)(`UPDATE user_security
        SET recovery_hashes = $2::jsonb, failed_attempts = 0, locked_until = NULL,
            last_used_at = NOW(), updated_at = NOW()
      WHERE user_id = $1`, [user.id, JSON.stringify(recovery.hashes)]);
    await logSecurityEvent(uid, "2fa_recovery_codes_regenerated", {
        count: recovery.plain.length,
    });
    return { recovery_codes: recovery.plain };
}
/**
 * Support recovery: reset 2FA after the human has verified the account owner.
 * Also kills every session, so a stolen phone cannot keep using the old token.
 */
async function resetUserSecurity(uid, actor) {
    const user = await userRow(uid);
    if (!user)
        throw new UserSecurityError("User not found", 404, "user_not_found");
    await (0, database_1.execute)(`INSERT INTO user_security (user_id, enabled, epoch, recovery_hashes, updated_at)
     VALUES ($1, FALSE, 1, '[]'::jsonb, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET secret_enc = NULL, enabled = FALSE, recovery_hashes = '[]'::jsonb,
           epoch = user_security.epoch + 1, failed_attempts = 0,
           locked_until = NULL, updated_at = NOW()`, [user.id]);
    const revoked = await revokeAllSessions(uid, null, "2fa_reset");
    invalidateUserSecurityCache(uid);
    await logSecurityEvent(uid, "2fa_reset_by_support", { actor });
    return { sessions_revoked: revoked.revoked };
}
// ── Sessions / devices ──────────────────────────────────────────────────────
const DEVICE_RE = /^[A-Za-z0-9._:-]{8,128}$/;
function normaliseInput(input) {
    return {
        deviceId: String(input.deviceId || "").trim(),
        platform: ["android", "ios", "web"].includes(String(input.platform || "").toLowerCase())
            ? String(input.platform).toLowerCase()
            : "unknown",
        app: ["rider", "driver"].includes(String(input.app || "").toLowerCase())
            ? String(input.app).toLowerCase()
            : "unknown",
        appVersion: String(input.appVersion || "").trim().slice(0, 24) || null,
        deviceName: String(input.deviceName || "").trim().slice(0, 80) || null,
        ip: input.ip,
        authTime: Number(input.authTime || 0),
    };
}
async function startSession(uid, raw) {
    const input = normaliseInput(raw);
    if (!DEVICE_RE.test(input.deviceId)) {
        throw new UserSecurityError("Invalid device identifier.", 400, "invalid_device");
    }
    const user = await userRow(uid);
    if (!user)
        throw new UserSecurityError("User not found", 404, "user_not_found");
    await ensureUserSecuritySchema();
    const existing = await (0, database_1.queryOne)(`SELECT id, revoked_at FROM user_sessions WHERE user_id = $1 AND device_id = $2`, [user.id, input.deviceId]);
    // Do not email the whole user base on the first launch after this feature
    // ships. The FIRST device is not a suspicious sign-in; later ones are.
    const hadAnyDevice = existing
        ? true
        : Boolean(await (0, database_1.queryOne)(`SELECT id FROM user_sessions WHERE user_id = $1 LIMIT 1`, [user.id]));
    // A remotely signed-out device must not re-register itself just by relaunching
    // the app with the old token. Only a fresh password sign-in (Firebase
    // auth_time within 10 minutes) may clear the revoke.
    if (existing?.revoked_at) {
        const authAge = Math.floor(Date.now() / 1000) - Number(input.authTime || 0);
        if (!input.authTime || authAge > 600) {
            throw new UserSecurityError("This device was signed out from another device. Sign in again.", 401, "session_revoked");
        }
    }
    const session = await (0, database_1.queryOne)(`INSERT INTO user_sessions
       (user_id, device_id, platform, app, app_version, device_name, ip_hash, last_seen_at, revoked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL)
     ON CONFLICT (user_id, device_id) DO UPDATE
       SET platform = EXCLUDED.platform, app = EXCLUDED.app,
           app_version = EXCLUDED.app_version, device_name = EXCLUDED.device_name,
           ip_hash = EXCLUDED.ip_hash, last_seen_at = NOW(), revoked_at = NULL
     RETURNING id, device_id, platform, app, app_version, device_name, created_at, last_seen_at`, [
        user.id,
        input.deviceId,
        input.platform,
        input.app,
        input.appVersion,
        input.deviceName,
        hashIp(input.ip),
    ]);
    invalidateDeviceCache(uid, input.deviceId);
    if (!existing) {
        await logSecurityEvent(uid, "new_device_sign_in", {
            device: input.deviceName,
            platform: input.platform,
            app: input.app,
        }, input.ip);
        if (hadAnyDevice)
            void sendNewDeviceAlert(user.email, input);
    }
    if (!session)
        throw new UserSecurityError("Could not record this device.", 500, "session_write_failed");
    return { session, new_device: !existing };
}
async function heartbeatSession(uid, deviceId, appVersion) {
    const clean = String(deviceId || "").trim();
    if (!DEVICE_RE.test(clean)) {
        throw new UserSecurityError("Invalid device identifier.", 400, "invalid_device");
    }
    const user = await userRow(uid);
    if (!user)
        throw new UserSecurityError("User not found", 404, "user_not_found");
    const row = await (0, database_1.queryOne)(`SELECT revoked_at FROM user_sessions WHERE user_id = $1 AND device_id = $2`, [user.id, clean]);
    if (!row) {
        throw new UserSecurityError("This device is not registered. Sign in again.", 401, "session_unknown");
    }
    if (row.revoked_at) {
        throw new UserSecurityError("This device was signed out from another device. Sign in again.", 401, "session_revoked");
    }
    await (0, database_1.execute)(`UPDATE user_sessions
        SET last_seen_at = NOW(), app_version = COALESCE($3, app_version)
      WHERE user_id = $1 AND device_id = $2`, [user.id, clean, String(appVersion || "").trim().slice(0, 24) || null]);
}
async function listSessions(uid, currentDeviceId) {
    const user = await userRow(uid);
    if (!user)
        throw new UserSecurityError("User not found", 404, "user_not_found");
    await ensureUserSecuritySchema();
    const rows = await (0, database_1.query)(`SELECT id, device_id, platform, app, app_version, device_name, created_at, last_seen_at
       FROM user_sessions
      WHERE user_id = $1 AND revoked_at IS NULL
        AND last_seen_at > NOW() - INTERVAL '90 days'
      ORDER BY last_seen_at DESC
      LIMIT 20`, [user.id]);
    return rows.map((row) => ({
        ...row,
        current: !!currentDeviceId && row.device_id === currentDeviceId,
    }));
}
/**
 * An open Socket.IO connection authenticated before the revoke would otherwise
 * keep receiving events. Drop it now; the handshake gate will refuse a retry
 * until the device has a fresh login (and a 2FA proof when enabled).
 */
function disconnectDeviceSockets(uid, deviceId, event = "session:revoked") {
    try {
        const io = global.__vuraIo;
        if (!io)
            return;
        const room = deviceId ? `device:${uid}:${deviceId}` : `user:${uid}`;
        io.to(room).emit(event, {});
        io.in(room).disconnectSockets(true);
    }
    catch {
        /* sockets are best-effort; the REST gate is authoritative */
    }
}
async function revokeSession(uid, sessionId, currentDeviceId) {
    const user = await userRow(uid);
    if (!user)
        throw new UserSecurityError("User not found", 404, "user_not_found");
    const row = await (0, database_1.queryOne)(`UPDATE user_sessions
        SET revoked_at = NOW()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING device_id`, [sessionId, user.id]);
    if (!row)
        throw new UserSecurityError("Device not found.", 404, "session_not_found");
    invalidateDeviceCache(uid, row.device_id);
    disconnectDeviceSockets(uid, row.device_id);
    await logSecurityEvent(uid, "device_signed_out", {
        device_id: row.device_id.slice(0, 12),
        current: row.device_id === currentDeviceId,
    });
    return {
        revoked: true,
        current: !!currentDeviceId && row.device_id === currentDeviceId,
        device_id: row.device_id,
    };
}
async function revokeAllSessions(uid, currentDeviceId, reason = "user_request") {
    const user = await userRow(uid);
    if (!user)
        throw new UserSecurityError("User not found", 404, "user_not_found");
    const res = await (0, database_1.execute)(`UPDATE user_sessions SET revoked_at = NOW()
      WHERE user_id = $1 AND revoked_at IS NULL`, [user.id]);
    await (0, database_1.execute)(`UPDATE users SET sessions_valid_after = NOW(), updated_at = NOW()
      WHERE id = $1`, [user.id]);
    invalidateUserSecurityCache(uid);
    if (currentDeviceId)
        invalidateDeviceCache(uid, currentDeviceId);
    try {
        await (0, firebase_1.getAuth)().revokeRefreshTokens(uid);
    }
    catch (err) {
        console.warn("[user-security] refresh revoke failed:", err?.code || err?.message || err);
    }
    disconnectDeviceSockets(uid);
    await logSecurityEvent(uid, "all_sessions_revoked", {
        reason,
        count: Number(res?.rowCount || 0),
    });
    return { revoked: Number(res?.rowCount || 0) };
}
async function listSecurityActivity(uid, limit = 20) {
    const user = await userRow(uid);
    if (!user)
        throw new UserSecurityError("User not found", 404, "user_not_found");
    await ensureUserSecuritySchema();
    const rows = await (0, database_1.query)(`SELECT id, event, detail, created_at
       FROM user_security_events
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`, [user.id, Math.max(1, Math.min(50, Number(limit) || 20))]);
    return rows.map((row) => ({
        ...row,
        created_at: new Date(row.created_at).toISOString(),
    }));
}
//# sourceMappingURL=userSecurity.js.map
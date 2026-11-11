import { createHash, createHmac, timingSafeEqual } from "crypto";
import { execute, query, queryOne } from "../config/database";
import { getAuth } from "../config/firebase";
import {
  constantTimeEqual,
  generateRecoveryCodeSet,
  generateTotpSecret,
  hashRecoveryCode,
  openSecret,
  securityKeyMaterial,
  sealSecret,
  verifyTotp,
} from "./adminMfa";
import { sendResendEmail } from "./adminInvite";

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

export class UserSecurityError extends Error {
  statusCode: number;
  code: string;
  constructor(message: string, statusCode = 400, code = "security_error") {
    super(message);
    this.name = "UserSecurityError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface UserSecurityRow {
  user_id: string;
  secret_enc: string | null;
  enabled: boolean;
  epoch: number;
  recovery_hashes: string[] | string | null;
  failed_attempts: number;
  locked_until: string | Date | null;
  confirmed_at: string | Date | null;
  last_used_at: string | Date | null;
}

export interface SessionInput {
  deviceId: string;
  platform?: string;
  app?: string;
  appVersion?: string | null;
  deviceName?: string | null;
  ip?: string;
  /** Firebase auth_time (seconds). Proof that this is a fresh password login. */
  authTime?: number;
}

export interface UserSessionRow {
  id: string;
  device_id: string;
  platform: string | null;
  app: string | null;
  app_version: string | null;
  device_name: string | null;
  created_at: string | Date;
  last_seen_at: string | Date;
}

let schemaPromise: Promise<void> | null = null;

export function ensureUserSecuritySchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sessions_valid_after TIMESTAMPTZ`);
      await execute(`
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
      await execute(`
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
      await execute(`CREATE INDEX IF NOT EXISTS idx_user_sessions_user_seen ON user_sessions (user_id, last_seen_at DESC)`);
      await execute(`
        CREATE TABLE IF NOT EXISTS user_security_events (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          event TEXT NOT NULL,
          detail JSONB NOT NULL DEFAULT '{}'::jsonb,
          ip_hash TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await execute(`CREATE INDEX IF NOT EXISTS idx_user_security_events_user ON user_security_events (user_id, created_at DESC)`);
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

function asStringArray(value: string[] | string | null): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function userRow(uid: string): Promise<{ id: string; email: string | null } | null> {
  return queryOne<{ id: string; email: string | null }>(
    `SELECT id, email FROM users WHERE firebase_uid = $1`,
    [uid]
  );
}

function hashIp(ip: string | undefined): string | null {
  const clean = String(ip || "").trim();
  if (!clean) return null;
  try {
    return createHash("sha256")
      .update(`${securityKeyMaterial()}:ip:${clean}`)
      .digest("hex")
      .slice(0, 32);
  } catch {
    return null;
  }
}

// ── Step-up token ────────────────────────────────────────────────────────────

function tokenKey(): Buffer {
  return createHash("sha256").update(`${securityKeyMaterial()}:user-security-token`).digest();
}

export function issueUserStepUpToken(uid: string, epoch: number): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: uid, epoch, exp: Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000 })
  ).toString("base64url");
  const sig = createHmac("sha256", tokenKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyUserStepUpToken(uid: string, token: string, epoch: number): boolean {
  if (!token) return false;
  const [payload, sig] = String(token).split(".");
  if (!payload || !sig) return false;
  const expected = createHmac("sha256", tokenKey()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return (
      data?.sub === uid &&
      Number(data?.epoch) === Number(epoch) &&
      Number(data?.exp) > Date.now()
    );
  } catch {
    return false;
  }
}

// ── Gate cache ───────────────────────────────────────────────────────────────

export interface UserAuthGate {
  enabled: boolean;
  epoch: number;
  /** Unix seconds. Tokens issued before this are dead. 0 = no cutoff. */
  sessionsValidAfter: number;
}

const gateCache = new Map<string, UserAuthGate & { expires: number }>();

export function invalidateUserSecurityCache(uid: string): void {
  gateCache.delete(uid);
}

export async function getUserSecurityGate(uid: string): Promise<UserAuthGate> {
  const cached = gateCache.get(uid);
  if (cached && cached.expires > Date.now()) {
    const { expires: _expires, ...gate } = cached;
    return gate;
  }

  let gate: UserAuthGate = { enabled: false, epoch: 0, sessionsValidAfter: 0 };
  try {
    const row = await queryOne<{
      sessions_valid_after: string | Date | null;
      enabled: boolean | null;
      epoch: number | null;
    }>(
      `SELECT u.sessions_valid_after, s.enabled, s.epoch
         FROM users u
         LEFT JOIN user_security s ON s.user_id = u.id
        WHERE u.firebase_uid = $1`,
      [uid]
    );
    if (row) {
      gate = {
        enabled: row.enabled === true,
        epoch: Number(row.epoch || 0),
        sessionsValidAfter: row.sessions_valid_after
          ? Math.floor(new Date(row.sessions_valid_after).getTime() / 1000)
          : 0,
      };
    }
  } catch (err: any) {
    // Feature tables may not exist yet on the very first request after a
    // deploy. Do not lock every account out of the platform for that.
    console.warn("[user-security] gate read failed:", err?.message || err);
    try {
      const row = await queryOne<{ sessions_valid_after: string | Date | null }>(
        `SELECT sessions_valid_after FROM users WHERE firebase_uid = $1`,
        [uid]
      );
      if (row?.sessions_valid_after) {
        gate.sessionsValidAfter = Math.floor(new Date(row.sessions_valid_after).getTime() / 1000);
      }
    } catch {
      /* fail open on infrastructure failure */
    }
  }

  gateCache.set(uid, { ...gate, expires: Date.now() + GATE_CACHE_MS });
  return gate;
}

/** True when this request carries a valid second-factor proof. */
export async function twoFactorSatisfied(uid: string, header: string | undefined): Promise<boolean> {
  const gate = await getUserSecurityGate(uid);
  if (!gate.enabled) return true;
  return verifyUserStepUpToken(uid, String(header || ""), gate.epoch);
}

// ── Device revocation cache ──────────────────────────────────────────────────

const deviceCache = new Map<string, { revoked: boolean; expires: number }>();

export function invalidateDeviceCache(uid: string, deviceId: string): void {
  deviceCache.delete(`${uid}:${deviceId}`);
}

export async function isDeviceRevoked(uid: string, deviceId: string): Promise<boolean> {
  const key = `${uid}:${deviceId}`;
  const cached = deviceCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.revoked;

  let revoked = false;
  try {
    const row = await queryOne<{ revoked_at: string | Date | null }>(
      `SELECT s.revoked_at
         FROM user_sessions s
         JOIN users u ON u.id = s.user_id
        WHERE u.firebase_uid = $1 AND s.device_id = $2`,
      [uid, deviceId]
    );
    revoked = Boolean(row?.revoked_at);
  } catch {
    revoked = false;
  }
  deviceCache.set(key, { revoked, expires: Date.now() + DEVICE_CACHE_MS });
  return revoked;
}

// ── Activity log + alerts ────────────────────────────────────────────────────

export async function logSecurityEvent(
  uid: string,
  event: string,
  detail: Record<string, unknown> = {},
  ip?: string
): Promise<void> {
  try {
    const user = await userRow(uid);
    if (!user) return;
    await execute(
      `INSERT INTO user_security_events (user_id, event, detail, ip_hash)
       VALUES ($1, $2, $3::jsonb, $4)`,
      [user.id, event, JSON.stringify(detail), hashIp(ip)]
    );
  } catch (err: any) {
    console.warn("[user-security] event log failed:", err?.message || err);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendNewDeviceAlert(
  email: string | null,
  input: SessionInput
): Promise<void> {
  if (!email) return;
  const device = escapeHtml(input.deviceName || "Unknown device");
  const app = escapeHtml(input.app || "Vura");
  const when = new Date().toUTCString();
  await sendResendEmail({
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

function otpauthUrl(email: string, secret: string): string {
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

async function securityRow(userId: string): Promise<UserSecurityRow | null> {
  await ensureUserSecuritySchema();
  return queryOne<UserSecurityRow>(`SELECT * FROM user_security WHERE user_id = $1`, [userId]);
}

function assertNotLocked(row: UserSecurityRow): void {
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    throw new UserSecurityError(
      "Too many incorrect codes. Try again in a few minutes.",
      429,
      "security_locked"
    );
  }
}

async function recordFailure(userId: string, row: UserSecurityRow): Promise<never> {
  const attempts = Number(row.failed_attempts || 0) + 1;
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    const until = new Date(Date.now() + LOCK_MINUTES * 60_000);
    await execute(
      `UPDATE user_security
          SET failed_attempts = 0, locked_until = $2, updated_at = NOW()
        WHERE user_id = $1`,
      [userId, until]
    ).catch(() => {});
    throw new UserSecurityError(
      `Too many incorrect codes. Try again in ${LOCK_MINUTES} minutes.`,
      429,
      "security_locked"
    );
  }
  await execute(
    `UPDATE user_security SET failed_attempts = $2, updated_at = NOW() WHERE user_id = $1`,
    [userId, attempts]
  ).catch(() => {});
  throw new UserSecurityError(
    "That code is not valid. Open your authenticator app and use the current 6-digit code.",
    400,
    "security_invalid_code"
  );
}

export async function getSecurityStatus(uid: string): Promise<{
  two_factor_enabled: boolean;
  configured: boolean;
  recovery_codes_left: number;
  locked_until: string | null;
  last_used_at: string | null;
}> {
  const user = await userRow(uid);
  if (!user) throw new UserSecurityError("User not found", 404, "user_not_found");
  const row = await securityRow(user.id);
  return {
    two_factor_enabled: row?.enabled === true && !!row.secret_enc,
    configured: !!row?.secret_enc,
    recovery_codes_left: asStringArray(row?.recovery_hashes ?? null).length,
    locked_until: row?.locked_until ? new Date(row.locked_until).toISOString() : null,
    last_used_at: row?.last_used_at ? new Date(row.last_used_at).toISOString() : null,
  };
}

export async function startTwoFactorSetup(
  uid: string,
  emailHint?: string
): Promise<{ secret: string; otpauth_uri: string }> {
  const user = await userRow(uid);
  if (!user) throw new UserSecurityError("User not found", 404, "user_not_found");
  const existing = await securityRow(user.id);
  if (existing?.enabled) {
    throw new UserSecurityError(
      "Two-factor authentication is already on. Turn it off first to set up a new device.",
      409,
      "security_already_enabled"
    );
  }

  const secret = generateTotpSecret();
  await execute(
    `INSERT INTO user_security
       (user_id, secret_enc, enabled, epoch, recovery_hashes, failed_attempts, updated_at)
     VALUES ($1, $2, FALSE, 0, '[]'::jsonb, 0, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET secret_enc = EXCLUDED.secret_enc, enabled = FALSE,
           recovery_hashes = '[]'::jsonb, failed_attempts = 0,
           locked_until = NULL, confirmed_at = NULL, updated_at = NOW()`,
    [user.id, sealSecret(secret)]
  );
  invalidateUserSecurityCache(uid);
  return {
    secret,
    otpauth_uri: otpauthUrl(String(emailHint || user.email || ""), secret),
  };
}

export async function enableTwoFactor(
  uid: string,
  code: string
): Promise<{ recovery_codes: string[]; token: string }> {
  const user = await userRow(uid);
  if (!user) throw new UserSecurityError("User not found", 404, "user_not_found");
  const row = await securityRow(user.id);
  if (!row) throw new UserSecurityError("Start the authenticator setup first.", 400, "security_setup_missing");
  if (row.enabled) throw new UserSecurityError("Two-factor authentication is already on.", 409, "security_already_enabled");
  assertNotLocked(row);

  const secret = openSecret(row.secret_enc);
  if (!secret) throw new UserSecurityError("Start the authenticator setup first.", 400, "security_setup_missing");
  if (!verifyTotp(secret, code)) return recordFailure(user.id, row);

  const recovery = generateRecoveryCodeSet();
  const epoch = Number(row.epoch || 0) + 1;
  await execute(
    `UPDATE user_security
        SET enabled = TRUE, epoch = $2, recovery_hashes = $3::jsonb,
            failed_attempts = 0, locked_until = NULL, confirmed_at = NOW(), updated_at = NOW()
      WHERE user_id = $1`,
    [user.id, epoch, JSON.stringify(recovery.hashes)]
  );
  invalidateUserSecurityCache(uid);
  await logSecurityEvent(uid, "2fa_enabled");
  // Existing sockets authenticated before 2FA was switched on must not keep
  // receiving ride events. They can reconnect with the step-up token the app
  // just received (or with a code on any other device).
  disconnectDeviceSockets(uid);
  return { recovery_codes: recovery.plain, token: issueUserStepUpToken(uid, epoch) };
}

export async function verifyTwoFactor(
  uid: string,
  code: string
): Promise<{ token: string; used_recovery: boolean }> {
  const user = await userRow(uid);
  if (!user) throw new UserSecurityError("User not found", 404, "user_not_found");
  const row = await securityRow(user.id);
  if (!row?.enabled || !row.secret_enc) {
    throw new UserSecurityError("Two-factor authentication is not on.", 400, "security_not_enabled");
  }
  assertNotLocked(row);

  const secret = openSecret(row.secret_enc);
  if (!secret) {
    throw new UserSecurityError(
      "The authenticator secret could not be read. Contact support to reset 2FA.",
      500,
      "security_secret_unreadable"
    );
  }

  let usedRecoveryHash: string | null = null;
  let ok = verifyTotp(secret, code);
  if (!ok) {
    const supplied = hashRecoveryCode(code);
    const hashes = asStringArray(row.recovery_hashes);
    if (hashes.some((hash) => constantTimeEqual(String(hash), supplied))) {
      ok = true;
      usedRecoveryHash = supplied;
    }
  }
  if (!ok) return recordFailure(user.id, row);

  const epoch = Number(row.epoch || 0);
  if (usedRecoveryHash) {
    const remaining = asStringArray(row.recovery_hashes).filter(
      (hash) => !constantTimeEqual(String(hash), usedRecoveryHash!)
    );
    await execute(
      `UPDATE user_security
          SET recovery_hashes = $2::jsonb, failed_attempts = 0, locked_until = NULL,
              last_used_at = NOW(), updated_at = NOW()
        WHERE user_id = $1`,
      [user.id, JSON.stringify(remaining)]
    );
    await logSecurityEvent(uid, "2fa_recovery_code_used", {
      remaining: remaining.length,
    });
  } else {
    await execute(
      `UPDATE user_security
          SET failed_attempts = 0, locked_until = NULL, last_used_at = NOW(), updated_at = NOW()
        WHERE user_id = $1`,
      [user.id]
    );
  }
  invalidateUserSecurityCache(uid);
  return { token: issueUserStepUpToken(uid, epoch), used_recovery: !!usedRecoveryHash };
}

export async function disableTwoFactor(uid: string, code: string): Promise<void> {
  const user = await userRow(uid);
  if (!user) throw new UserSecurityError("User not found", 404, "user_not_found");
  const row = await securityRow(user.id);
  if (!row?.enabled || !row.secret_enc) {
    throw new UserSecurityError("Two-factor authentication is not on.", 400, "security_not_enabled");
  }
  assertNotLocked(row);
  const secret = openSecret(row.secret_enc);
  if (!secret || !verifyTotp(secret, code)) {
    if (!secret) {
      throw new UserSecurityError("The authenticator secret could not be read.", 500, "security_secret_unreadable");
    }
    return recordFailure(user.id, row);
  }
  await execute(
    `UPDATE user_security
        SET enabled = FALSE, secret_enc = NULL, recovery_hashes = '[]'::jsonb,
            epoch = epoch + 1, failed_attempts = 0, locked_until = NULL, updated_at = NOW()
      WHERE user_id = $1`,
    [user.id]
  );
  invalidateUserSecurityCache(uid);
  await logSecurityEvent(uid, "2fa_disabled");
}

export async function regenerateRecoveryCodes(
  uid: string,
  code: string
): Promise<{ recovery_codes: string[] }> {
  const user = await userRow(uid);
  if (!user) throw new UserSecurityError("User not found", 404, "user_not_found");
  const row = await securityRow(user.id);
  if (!row?.enabled || !row.secret_enc) {
    throw new UserSecurityError("Two-factor authentication is not on.", 400, "security_not_enabled");
  }
  assertNotLocked(row);
  const secret = openSecret(row.secret_enc);
  if (!secret || !verifyTotp(secret, code)) {
    if (!secret) {
      throw new UserSecurityError("The authenticator secret could not be read.", 500, "security_secret_unreadable");
    }
    return recordFailure(user.id, row);
  }
  const recovery = generateRecoveryCodeSet();
  await execute(
    `UPDATE user_security
        SET recovery_hashes = $2::jsonb, failed_attempts = 0, locked_until = NULL,
            last_used_at = NOW(), updated_at = NOW()
      WHERE user_id = $1`,
    [user.id, JSON.stringify(recovery.hashes)]
  );
  await logSecurityEvent(uid, "2fa_recovery_codes_regenerated", {
    count: recovery.plain.length,
  });
  return { recovery_codes: recovery.plain };
}

/**
 * Support recovery: reset 2FA after the human has verified the account owner.
 * Also kills every session, so a stolen phone cannot keep using the old token.
 */
export async function resetUserSecurity(
  uid: string,
  actor: string
): Promise<{ sessions_revoked: number }> {
  const user = await userRow(uid);
  if (!user) throw new UserSecurityError("User not found", 404, "user_not_found");

  await execute(
    `INSERT INTO user_security (user_id, enabled, epoch, recovery_hashes, updated_at)
     VALUES ($1, FALSE, 1, '[]'::jsonb, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET secret_enc = NULL, enabled = FALSE, recovery_hashes = '[]'::jsonb,
           epoch = user_security.epoch + 1, failed_attempts = 0,
           locked_until = NULL, updated_at = NOW()`,
    [user.id]
  );
  const revoked = await revokeAllSessions(uid, null, "2fa_reset");
  invalidateUserSecurityCache(uid);
  await logSecurityEvent(uid, "2fa_reset_by_support", { actor });
  return { sessions_revoked: revoked.revoked };
}

// ── Sessions / devices ──────────────────────────────────────────────────────

const DEVICE_RE = /^[A-Za-z0-9._:-]{8,128}$/;

function normaliseInput(input: SessionInput): SessionInput {
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

export async function startSession(
  uid: string,
  raw: SessionInput
): Promise<{ session: UserSessionRow; new_device: boolean }> {
  const input = normaliseInput(raw);
  if (!DEVICE_RE.test(input.deviceId)) {
    throw new UserSecurityError("Invalid device identifier.", 400, "invalid_device");
  }
  const user = await userRow(uid);
  if (!user) throw new UserSecurityError("User not found", 404, "user_not_found");

  await ensureUserSecuritySchema();
  const existing = await queryOne<{ id: string; revoked_at: string | Date | null }>(
    `SELECT id, revoked_at FROM user_sessions WHERE user_id = $1 AND device_id = $2`,
    [user.id, input.deviceId]
  );

  // A remotely signed-out device must not re-register itself just by relaunching
  // the app with the old token. Only a fresh password sign-in (Firebase
  // auth_time within 10 minutes) may clear the revoke.
  if (existing?.revoked_at) {
    const authAge = Math.floor(Date.now() / 1000) - Number(input.authTime || 0);
    if (!input.authTime || authAge > 600) {
      throw new UserSecurityError(
        "This device was signed out from another device. Sign in again.",
        401,
        "session_revoked"
      );
    }
  }

  const session = await queryOne<UserSessionRow>(
    `INSERT INTO user_sessions
       (user_id, device_id, platform, app, app_version, device_name, ip_hash, last_seen_at, revoked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NULL)
     ON CONFLICT (user_id, device_id) DO UPDATE
       SET platform = EXCLUDED.platform, app = EXCLUDED.app,
           app_version = EXCLUDED.app_version, device_name = EXCLUDED.device_name,
           ip_hash = EXCLUDED.ip_hash, last_seen_at = NOW(), revoked_at = NULL
     RETURNING id, device_id, platform, app, app_version, device_name, created_at, last_seen_at`,
    [
      user.id,
      input.deviceId,
      input.platform,
      input.app,
      input.appVersion,
      input.deviceName,
      hashIp(input.ip),
    ]
  );

  invalidateDeviceCache(uid, input.deviceId);

  if (!existing) {
    await logSecurityEvent(uid, "new_device_sign_in", {
      device: input.deviceName,
      platform: input.platform,
      app: input.app,
    }, input.ip);
    void sendNewDeviceAlert(user.email, input);
  }

  if (!session) throw new UserSecurityError("Could not record this device.", 500, "session_write_failed");
  return { session, new_device: !existing };
}

export async function heartbeatSession(
  uid: string,
  deviceId: string,
  appVersion?: string
): Promise<void> {
  const clean = String(deviceId || "").trim();
  if (!DEVICE_RE.test(clean)) {
    throw new UserSecurityError("Invalid device identifier.", 400, "invalid_device");
  }
  const user = await userRow(uid);
  if (!user) throw new UserSecurityError("User not found", 404, "user_not_found");

  const row = await queryOne<{ revoked_at: string | Date | null }>(
    `SELECT revoked_at FROM user_sessions WHERE user_id = $1 AND device_id = $2`,
    [user.id, clean]
  );
  if (!row) {
    throw new UserSecurityError(
      "This device is not registered. Sign in again.",
      401,
      "session_unknown"
    );
  }
  if (row.revoked_at) {
    throw new UserSecurityError(
      "This device was signed out from another device. Sign in again.",
      401,
      "session_revoked"
    );
  }
  await execute(
    `UPDATE user_sessions
        SET last_seen_at = NOW(), app_version = COALESCE($3, app_version)
      WHERE user_id = $1 AND device_id = $2`,
    [user.id, clean, String(appVersion || "").trim().slice(0, 24) || null]
  );
}

export async function listSessions(
  uid: string,
  currentDeviceId?: string
): Promise<Array<UserSessionRow & { current: boolean }>> {
  const user = await userRow(uid);
  if (!user) throw new UserSecurityError("User not found", 404, "user_not_found");
  await ensureUserSecuritySchema();
  const rows = await query<UserSessionRow>(
    `SELECT id, device_id, platform, app, app_version, device_name, created_at, last_seen_at
       FROM user_sessions
      WHERE user_id = $1 AND revoked_at IS NULL
        AND last_seen_at > NOW() - INTERVAL '90 days'
      ORDER BY last_seen_at DESC
      LIMIT 20`,
    [user.id]
  );
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
function disconnectDeviceSockets(uid: string, deviceId?: string): void {
  try {
    const io = (global as any).__vuraIo;
    if (!io) return;
    const room = deviceId ? `device:${uid}:${deviceId}` : `user:${uid}`;
    io.to(room).emit("session:revoked", {});
    io.in(room).disconnectSockets(true);
  } catch {
    /* sockets are best-effort; the REST gate is authoritative */
  }
}

export async function revokeSession(
  uid: string,
  sessionId: string,
  currentDeviceId?: string
): Promise<{ revoked: boolean; current: boolean; device_id: string }> {
  const user = await userRow(uid);
  if (!user) throw new UserSecurityError("User not found", 404, "user_not_found");
  const row = await queryOne<{ device_id: string }>(
    `UPDATE user_sessions
        SET revoked_at = NOW()
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
      RETURNING device_id`,
    [sessionId, user.id]
  );
  if (!row) throw new UserSecurityError("Device not found.", 404, "session_not_found");

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

export async function revokeAllSessions(
  uid: string,
  currentDeviceId?: string | null,
  reason = "user_request"
): Promise<{ revoked: number }> {
  const user = await userRow(uid);
  if (!user) throw new UserSecurityError("User not found", 404, "user_not_found");

  const res = await execute(
    `UPDATE user_sessions SET revoked_at = NOW()
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [user.id]
  );
  await execute(
    `UPDATE users SET sessions_valid_after = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [user.id]
  );

  invalidateUserSecurityCache(uid);
  if (currentDeviceId) invalidateDeviceCache(uid, currentDeviceId);

  try {
    await getAuth().revokeRefreshTokens(uid);
  } catch (err: any) {
    console.warn("[user-security] refresh revoke failed:", err?.code || err?.message || err);
  }
  disconnectDeviceSockets(uid);

  await logSecurityEvent(uid, "all_sessions_revoked", {
    reason,
    count: Number(res?.rowCount || 0),
  });
  return { revoked: Number(res?.rowCount || 0) };
}

export async function listSecurityActivity(
  uid: string,
  limit = 20
): Promise<Array<{ id: string; event: string; detail: any; created_at: string }>> {
  const user = await userRow(uid);
  if (!user) throw new UserSecurityError("User not found", 404, "user_not_found");
  await ensureUserSecuritySchema();
  const rows = await query<{
    id: string;
    event: string;
    detail: any;
    created_at: string | Date;
  }>(
    `SELECT id, event, detail, created_at
       FROM user_security_events
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [user.id, Math.max(1, Math.min(50, Number(limit) || 20))]
  );
  return rows.map((row) => ({
    ...row,
    created_at: new Date(row.created_at).toISOString(),
  }));
}

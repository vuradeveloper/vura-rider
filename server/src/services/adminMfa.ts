import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import { readFileSync } from "fs";
import { execute, queryOne } from "../config/database";

/**
 * Admin TOTP 2FA.
 *
 * The Firebase project is plain Firebase Auth (not Identity Platform), so its
 * native MFA cannot be enabled ("OPERATION_NOT_ALLOWED"). This service
 * implements the same standard TOTP flow (Google Authenticator-compatible)
 * without depending on that upgrade:
 *
 *   • the secret is generated server-side and stored AES-256-GCM encrypted
 *   • 6-digit codes are SHA-1 TOTP, 30 s step, ±1 window
 *   • 8 one-time recovery codes are stored only as SHA-256 hashes
 *   • five failed codes lock the account for 15 minutes
 *   • a successful code issues a short-lived HMAC session token which the
 *     administator UI sends as X-Admin-MFA on every admin API request
 *
 * No secret ever goes to the client except the one being enrolled.
 */

const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;
const TOTP_WINDOW = 1;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const TOKEN_HOURS = 8;
const RECOVERY_CODE_COUNT = 8;
let fallbackWarned = false;

export class AdminMfaError extends Error {
  statusCode: number;
  code: string;
  constructor(message: string, statusCode = 400, code = "mfa_error") {
    super(message);
    this.name = "AdminMfaError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface AdminMfaRow {
  admin_uid: string;
  email: string | null;
  secret_enc: string | null;
  enabled: boolean;
  epoch: number;
  recovery_hashes: string[] | null;
  failed_attempts: number;
  locked_until: string | Date | null;
  confirmed_at: string | Date | null;
  last_used_at: string | Date | null;
}

let schemaPromise: Promise<void> | null = null;

export function ensureAdminMfaSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await execute(`
        CREATE TABLE IF NOT EXISTS admin_mfa (
          admin_uid TEXT PRIMARY KEY,
          email TEXT,
          secret_enc TEXT,
          enabled BOOLEAN NOT NULL DEFAULT FALSE,
          epoch INTEGER NOT NULL DEFAULT 0,
          recovery_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
          failed_attempts INTEGER NOT NULL DEFAULT 0,
          locked_until TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          confirmed_at TIMESTAMPTZ,
          last_used_at TIMESTAMPTZ
        )
      `);
      await execute(`CREATE INDEX IF NOT EXISTS idx_admin_mfa_enabled ON admin_mfa (enabled)`);
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

function baseSecret(): string {
  const dedicated = (process.env.ADMIN_2FA_KEY || "").trim();
  if (dedicated) return dedicated;
  const firebaseKey = (process.env.FIREBASE_PRIVATE_KEY || "").trim();
  if (firebaseKey) {
    if (!fallbackWarned) {
      fallbackWarned = true;
      console.warn(
        "[admin-mfa] ADMIN_2FA_KEY is not set; deriving the key from FIREBASE_PRIVATE_KEY. Set ADMIN_2FA_KEY before rotating Firebase credentials."
      );
    }
    return firebaseKey;
  }
  const credentialsPath = (process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (credentialsPath) {
    try {
      const json = JSON.parse(readFileSync(credentialsPath, "utf8"));
      if (json?.private_key) {
        if (!fallbackWarned) {
          fallbackWarned = true;
          console.warn(
            "[admin-mfa] ADMIN_2FA_KEY is not set; deriving the key from the Firebase service-account file. Set ADMIN_2FA_KEY before rotating credentials."
          );
        }
        return String(json.private_key);
      }
    } catch {
      /* fall through to the explicit error */
    }
  }
  throw new AdminMfaError("Admin 2FA is not configured on this server.", 503, "mfa_unconfigured");
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(baseSecret()).digest();
}

function tokenKey(): Buffer {
  return createHash("sha256").update(`${baseSecret()}:admin-mfa-token`).digest();
}

function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${data.toString("base64url")}`;
}

function decryptSecret(value: string | null): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const data = Buffer.from(parts[3], "base64url");
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ── Base32 + TOTP ────────────────────────────────────────────────────────────

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input: string): Buffer {
  const clean = input.replace(/[^A-Z2-7]/gi, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const idx = BASE32.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCode(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

export function verifyTotp(secret: string, code: string): boolean {
  const clean = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const counter = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
  const supplied = Buffer.from(clean);
  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset++) {
    const expected = Buffer.from(totpCode(secret, counter + offset));
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return true;
  }
  return false;
}

export function otpauthUrl(email: string, secret: string): string {
  const label = encodeURIComponent(`Vura BackOffice:${email || "admin"}`);
  const params = new URLSearchParams({
    secret,
    issuer: "Vura BackOffice",
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── Recovery codes + session token ───────────────────────────────────────────

function hashCode(code: string): string {
  return createHash("sha256").update(code.replace(/[^A-Z2-7]/gi, "").toUpperCase()).digest("hex");
}

function generateRecoveryCodes(): { plain: string[]; hashes: string[] } {
  const plain: string[] = [];
  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    const raw = base32Encode(randomBytes(5)).slice(0, 8);
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    plain.push(code);
  }
  return { plain, hashes: plain.map(hashCode) };
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function issueAdminMfaToken(uid: string, epoch: number): string {
  const payload = Buffer.from(
    JSON.stringify({ sub: uid, epoch, exp: Date.now() + TOKEN_HOURS * 60 * 60 * 1000 })
  ).toString("base64url");
  const sig = createHmac("sha256", tokenKey()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyAdminMfaToken(uid: string, token: string, epoch: number): boolean {
  if (!token) return false;
  const [payload, sig] = String(token).split(".");
  if (!payload || !sig) return false;
  const expected = createHmac("sha256", tokenKey()).update(payload).digest("base64url");
  if (!safeEqual(sig, expected)) return false;
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

// ── Gate cache + DB operations ───────────────────────────────────────────────

interface Gate {
  enabled: boolean;
  epoch: number;
}
const gateCache = new Map<string, Gate & { expires: number }>();

export function invalidateAdminMfaCache(uid: string): void {
  gateCache.delete(uid);
}

async function rowFor(uid: string): Promise<AdminMfaRow | null> {
  await ensureAdminMfaSchema();
  return queryOne<AdminMfaRow>("SELECT * FROM admin_mfa WHERE admin_uid = $1", [uid]);
}

export async function getAdminMfaGate(uid: string): Promise<Gate> {
  const cached = gateCache.get(uid);
  if (cached && cached.expires > Date.now()) {
    return { enabled: cached.enabled, epoch: cached.epoch };
  }
  const row = await rowFor(uid);
  const gate = { enabled: row?.enabled === true && !!row.secret_enc, epoch: Number(row?.epoch || 0) };
  gateCache.set(uid, { ...gate, expires: Date.now() + 30_000 });
  return gate;
}

export async function getAdminMfaStatus(uid: string): Promise<{
  enabled: boolean;
  configured: boolean;
  locked_until: string | null;
}> {
  const row = await rowFor(uid);
  return {
    enabled: row?.enabled === true && !!row.secret_enc,
    configured: !!row?.secret_enc,
    locked_until: row?.locked_until ? new Date(row.locked_until).toISOString() : null,
  };
}

export async function startAdminMfaSetup(
  uid: string,
  email: string
): Promise<{ secret: string; otpauth_uri: string }> {
  const existing = await rowFor(uid);
  if (existing?.enabled) {
    throw new AdminMfaError("Two-factor authentication is already enabled.", 409, "mfa_already_enabled");
  }
  const secret = generateTotpSecret();
  const enc = encryptSecret(secret);
  await execute(
    `INSERT INTO admin_mfa (admin_uid, email, secret_enc, enabled, epoch, recovery_hashes, failed_attempts, updated_at)
     VALUES ($1, $2, $3, FALSE, 0, '[]'::jsonb, 0, NOW())
     ON CONFLICT (admin_uid) DO UPDATE
       SET email = EXCLUDED.email, secret_enc = EXCLUDED.secret_enc, enabled = FALSE,
           recovery_hashes = '[]'::jsonb, failed_attempts = 0, locked_until = NULL,
           confirmed_at = NULL, updated_at = NOW()`,
    [uid, email, enc]
  );
  invalidateAdminMfaCache(uid);
  return { secret, otpauth_uri: otpauthUrl(email, secret) };
}

async function recordFailure(uid: string, row: AdminMfaRow): Promise<never> {
  const attempts = Number(row.failed_attempts || 0) + 1;
  if (attempts >= MAX_FAILED_ATTEMPTS) {
    const until = new Date(Date.now() + LOCK_MINUTES * 60_000);
    await execute(
      `UPDATE admin_mfa SET failed_attempts = 0, locked_until = $2, updated_at = NOW() WHERE admin_uid = $1`,
      [uid, until]
    ).catch(() => {});
    throw new AdminMfaError(
      `Too many incorrect codes. Try again in ${LOCK_MINUTES} minutes.`,
      429,
      "mfa_locked"
    );
  }
  await execute(
    `UPDATE admin_mfa SET failed_attempts = $2, updated_at = NOW() WHERE admin_uid = $1`,
    [uid, attempts]
  ).catch(() => {});
  throw new AdminMfaError("That code is not valid. Try the current 6-digit code.", 400, "mfa_invalid_code");
}

export async function enableAdminMfa(
  uid: string,
  code: string
): Promise<{ recovery_codes: string[]; token: string }> {
  const row = await rowFor(uid);
  if (!row) throw new AdminMfaError("Start the authenticator setup first.", 400, "mfa_setup_missing");
  if (row.enabled) throw new AdminMfaError("Two-factor authentication is already enabled.", 409, "mfa_already_enabled");
  const secret = decryptSecret(row.secret_enc);
  if (!secret) throw new AdminMfaError("Start the authenticator setup first.", 400, "mfa_setup_missing");
  if (!verifyTotp(secret, code)) return recordFailure(uid, row);

  const recovery = generateRecoveryCodes();
  const epoch = Number(row.epoch || 0) + 1;
  await execute(
    `UPDATE admin_mfa
        SET enabled = TRUE, epoch = $2, recovery_hashes = $3::jsonb,
            failed_attempts = 0, locked_until = NULL, confirmed_at = NOW(), updated_at = NOW()
      WHERE admin_uid = $1`,
    [uid, epoch, JSON.stringify(recovery.hashes)]
  );
  invalidateAdminMfaCache(uid);
  return { recovery_codes: recovery.plain, token: issueAdminMfaToken(uid, epoch) };
}

export async function verifyAdminMfa(
  uid: string,
  code: string
): Promise<{ token: string }> {
  const row = await rowFor(uid);
  if (!row?.enabled || !row.secret_enc) {
    throw new AdminMfaError("Two-factor authentication is not enabled.", 400, "mfa_not_enabled");
  }
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
    throw new AdminMfaError("Too many incorrect codes. Try again later.", 429, "mfa_locked");
  }
  const secret = decryptSecret(row.secret_enc);
  if (!secret) {
    throw new AdminMfaError("The authenticator secret could not be read. Ask governance to reset 2FA.", 500, "mfa_secret_unreadable");
  }

  let usedRecoveryHash: string | null = null;
  let ok = verifyTotp(secret, code);
  if (!ok) {
    const suppliedHash = hashCode(code);
    const hashes = Array.isArray(row.recovery_hashes) ? row.recovery_hashes : [];
    if (hashes.some((hash) => safeEqual(String(hash), suppliedHash))) {
      ok = true;
      usedRecoveryHash = suppliedHash;
    }
  }
  if (!ok) return recordFailure(uid, row);

  const epoch = Number(row.epoch || 0);
  if (usedRecoveryHash) {
    const hashes = (row.recovery_hashes || []).filter((hash) => !safeEqual(String(hash), usedRecoveryHash!));
    await execute(
      `UPDATE admin_mfa
          SET recovery_hashes = $2::jsonb, failed_attempts = 0, locked_until = NULL,
              last_used_at = NOW(), updated_at = NOW()
        WHERE admin_uid = $1`,
      [uid, JSON.stringify(hashes)]
    );
  } else {
    await execute(
      `UPDATE admin_mfa
          SET failed_attempts = 0, locked_until = NULL, last_used_at = NOW(), updated_at = NOW()
        WHERE admin_uid = $1`,
      [uid]
    );
  }
  invalidateAdminMfaCache(uid);
  return { token: issueAdminMfaToken(uid, epoch) };
}

export async function disableAdminMfa(uid: string, code: string): Promise<void> {
  const row = await rowFor(uid);
  if (!row?.enabled || !row.secret_enc) {
    throw new AdminMfaError("Two-factor authentication is not enabled.", 400, "mfa_not_enabled");
  }
  const secret = decryptSecret(row.secret_enc);
  if (!secret || !verifyTotp(secret, code)) return recordFailure(uid, row);
  await execute(
    `UPDATE admin_mfa
        SET enabled = FALSE, secret_enc = NULL, recovery_hashes = '[]'::jsonb,
            epoch = epoch + 1, failed_attempts = 0, locked_until = NULL, updated_at = NOW()
      WHERE admin_uid = $1`,
    [uid]
  );
  invalidateAdminMfaCache(uid);
}

export async function resetAdminMfa(uid: string): Promise<void> {
  await execute(
    `INSERT INTO admin_mfa (admin_uid, enabled, epoch, recovery_hashes, updated_at)
     VALUES ($1, FALSE, 1, '[]'::jsonb, NOW())
     ON CONFLICT (admin_uid) DO UPDATE
       SET enabled = FALSE, secret_enc = NULL, recovery_hashes = '[]'::jsonb,
           epoch = admin_mfa.epoch + 1, failed_attempts = 0, locked_until = NULL, updated_at = NOW()`,
    [uid]
  );
  invalidateAdminMfaCache(uid);
}

/** True when the request carries a valid token for the current MFA epoch. */
export async function adminMfaTokenValid(uid: string, token: string): Promise<boolean> {
  const gate = await getAdminMfaGate(uid);
  if (!gate.enabled) return false;
  return verifyAdminMfaToken(uid, token, gate.epoch);
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  queryOne: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(async () => ({ rowCount: 1, rows: [] })),
}));

vi.mock("../config/database", () => db);
vi.mock("../config/firebase", () => ({
  getAuth: () => ({ revokeRefreshTokens: vi.fn(async () => undefined) }),
}));
vi.mock("./adminInvite", () => ({
  sendResendEmail: vi.fn(async () => ({ ok: true })),
}));

import {
  disableTwoFactor,
  enableTwoFactor,
  getUserSecurityGate,
  invalidateUserSecurityCache,
  issueUserStepUpToken,
  startSession,
  startTwoFactorSetup,
  verifyTwoFactor,
  verifyUserStepUpToken,
} from "./userSecurity";
import { hashRecoveryCode, sealSecret, totpCode } from "./adminMfa";

const UID = "firebase-rider-1";
const USER_ID = "11111111-1111-4111-8111-111111111111";
let secret = "";
let row: any = null;

function currentCode(s = secret): string {
  return totpCode(s, Math.floor(Date.now() / 1000 / 30));
}

beforeEach(() => {
  process.env.ADMIN_2FA_KEY = "test-only-account-security-key-32-bytes";
  secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  row = null;
  db.queryOne.mockReset();
  db.query.mockReset();
  db.execute.mockClear();

  db.queryOne.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM users u") && sql.includes("user_security")) {
      return {
        sessions_valid_after: null,
        enabled: row?.enabled === true,
        epoch: row?.epoch ?? 0,
      };
    }
    if (sql.includes("FROM users")) return { id: USER_ID, email: "rider@example.com" };
    if (sql.includes("FROM user_security")) return row;
    return null;
  });
});

afterEach(() => {
  invalidateUserSecurityCache(UID);
  delete process.env.ADMIN_2FA_KEY;
});

describe("account 2FA", () => {
  it("starts setup with an authenticator URI and a secret", async () => {
    const setup = await startTwoFactorSetup(UID, "rider@example.com");
    expect(setup.secret).toMatch(/^[A-Z2-7]{32,}$/);
    expect(setup.otpauth_uri).toContain("otpauth://totp/Vura%3Arider%40example.com");
    expect(setup.otpauth_uri).toContain(`secret=${setup.secret}`);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO user_security"),
      [USER_ID, expect.any(String)]
    );
  });

  it("enables 2FA with a current code and returns recovery codes + a step-up token", async () => {
    const sealed = sealSecret(secret);
    row = {
      user_id: USER_ID,
      secret_enc: sealed,
      enabled: false,
      epoch: 0,
      recovery_hashes: [],
      failed_attempts: 0,
      locked_until: null,
    };

    const result = await enableTwoFactor(UID, currentCode());
    expect(result.recovery_codes).toHaveLength(8);
    expect(result.recovery_codes[0]).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(verifyUserStepUpToken(UID, result.token, 1)).toBe(true);
    expect(verifyUserStepUpToken(UID, result.token, 0)).toBe(false);
    expect(verifyUserStepUpToken("someone-else", result.token, 1)).toBe(false);
  });

  it("accepts a one-time recovery code and consumes it", async () => {
    const recovery = "ABCD-EFGH";
    row = {
      user_id: USER_ID,
      secret_enc: sealSecret(secret),
      enabled: true,
      epoch: 3,
      recovery_hashes: [hashRecoveryCode(recovery)],
      failed_attempts: 0,
      locked_until: null,
    };

    const result = await verifyTwoFactor(UID, recovery);
    expect(result.used_recovery).toBe(true);
    expect(verifyUserStepUpToken(UID, result.token, 3)).toBe(true);
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("recovery_hashes = $2::jsonb"),
      [USER_ID, "[]"]
    );

    // Same code cannot be replayed.
    row.recovery_hashes = [];
    await expect(verifyTwoFactor(UID, recovery)).rejects.toMatchObject({
      code: "security_invalid_code",
    });
  });

  it("rejects a wrong code and does not issue a token", async () => {
    row = {
      user_id: USER_ID,
      secret_enc: sealSecret(secret),
      enabled: true,
      epoch: 1,
      recovery_hashes: [],
      failed_attempts: 0,
      locked_until: null,
    };
    await expect(verifyTwoFactor(UID, "000000")).rejects.toMatchObject({
      statusCode: 400,
      code: "security_invalid_code",
    });
  });

  it("turn-off requires a current authenticator code", async () => {
    row = {
      user_id: USER_ID,
      secret_enc: sealSecret(secret),
      enabled: true,
      epoch: 1,
      recovery_hashes: [],
      failed_attempts: 0,
      locked_until: null,
    };
    await expect(disableTwoFactor(UID, "000000")).rejects.toMatchObject({
      code: "security_invalid_code",
    });
    await disableTwoFactor(UID, currentCode());
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining("enabled = FALSE, secret_enc = NULL"),
      [USER_ID]
    );
  });
});

describe("step-up token", () => {
  it("round-trips and rejects tampering", () => {
    const token = issueUserStepUpToken(UID, 7);
    expect(verifyUserStepUpToken(UID, token, 7)).toBe(true);
    const [payload, sig] = token.split(".");
    expect(verifyUserStepUpToken(UID, `${payload}.${sig.slice(0, -2)}xx`, 7)).toBe(false);
    expect(verifyUserStepUpToken(UID, "not-a-token", 7)).toBe(false);
  });
});

describe("remote device sign-out", () => {
  it("refuses to re-register a revoked device with an old token", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) return { id: USER_ID, email: "rider@example.com" };
      if (sql.includes("SELECT id, revoked_at FROM user_sessions")) {
        return { id: "session-1", revoked_at: new Date() };
      }
      return null;
    });
    await expect(
      startSession(UID, {
        deviceId: "device-12345678",
        authTime: Math.floor(Date.now() / 1000) - 3600,
      })
    ).rejects.toMatchObject({ statusCode: 401, code: "session_revoked" });
  });

  it("allows a fresh password login to re-register the device", async () => {
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users")) return { id: USER_ID, email: "rider@example.com" };
      if (sql.includes("SELECT id, revoked_at FROM user_sessions")) {
        return { id: "session-1", revoked_at: new Date() };
      }
      if (sql.includes("INSERT INTO user_sessions")) {
        return {
          id: "session-1",
          device_id: "device-12345678",
          platform: "android",
          app: "rider",
          app_version: "1.5.22",
          device_name: "Pixel",
          created_at: new Date(),
          last_seen_at: new Date(),
        };
      }
      return null;
    });
    const result = await startSession(UID, {
      deviceId: "device-12345678",
      authTime: Math.floor(Date.now() / 1000) - 30,
    });
    expect(result.session.device_id).toBe("device-12345678");
  });
});

describe("session cutoff gate", () => {
  it("reads the per-user token cutoff without a user_security row", async () => {
    const cutoff = new Date(Date.now() - 60_000);
    db.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM users u")) {
        return { sessions_valid_after: cutoff, enabled: null, epoch: null };
      }
      return null;
    });
    invalidateUserSecurityCache(UID);
    const gate = await getUserSecurityGate(UID);
    expect(gate.sessionsValidAfter).toBe(Math.floor(cutoff.getTime() / 1000));
    expect(gate.enabled).toBe(false);
  });
});

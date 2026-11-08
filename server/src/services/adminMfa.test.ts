import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  generateTotpSecret,
  issueAdminMfaToken,
  otpauthUrl,
  totpCode,
  verifyAdminMfaToken,
} from "./adminMfa";

describe("admin TOTP primitives", () => {
  const previousKey = process.env.ADMIN_2FA_KEY;

  beforeAll(() => {
    process.env.ADMIN_2FA_KEY = "unit-test-admin-mfa-key";
  });

  afterAll(() => {
    if (previousKey === undefined) delete process.env.ADMIN_2FA_KEY;
    else process.env.ADMIN_2FA_KEY = previousKey;
  });

  it("matches the RFC 6238 SHA-1 test vector (time 59s -> 287082)", () => {
    // Base32 of the RFC's ASCII secret "12345678901234567890".
    expect(totpCode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 1)).toBe("287082");
  });

  it("generates a base32 secret long enough for RFC 4226", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThanOrEqual(32);
    expect(secret).not.toBe(generateTotpSecret());
  });

  it("turns the secret into a scannable otpauth URI", () => {
    const uri = otpauthUrl("ops@vura.test", "JBSWY3DPEHPK3PXP");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=Vura+BackOffice");
  });

  it("signs a session token for one uid + epoch and rejects others", () => {
    const token = issueAdminMfaToken("admin-uid", 3);
    expect(verifyAdminMfaToken("admin-uid", token, 3)).toBe(true);
    expect(verifyAdminMfaToken("other-uid", token, 3)).toBe(false);
    expect(verifyAdminMfaToken("admin-uid", token, 4)).toBe(false);
    expect(verifyAdminMfaToken("admin-uid", `${token}x`, 3)).toBe(false);
  });
});

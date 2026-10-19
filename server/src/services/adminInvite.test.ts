// ── adminInvite unit tests — the pieces "Invite an admin" depends on ─────────
// (pure builders only; firebase + Resend are covered by the e2e test plan.)
import { describe, expect, it, vi } from "vitest";
import {
  humanizeRole,
  randomTempPassword,
  renderInviteEmail,
  renderResetEmail,
  sendAdminInviteEmail,
} from "./adminInvite";

describe("randomTempPassword", () => {
  it("is 12 chars with every class, no confusable 0/1/I/O/l", () => {
    for (let i = 0; i < 40; i++) {
      const p = randomTempPassword();
      expect(p).toHaveLength(12);
      expect(p).toMatch(/[A-HJ-NP-Z]/); // upper minus I/O
      expect(p).toMatch(/[a-hj-np-z]/); // lower minus l
      expect(p).toMatch(/[2-9]/);
      expect(p).toMatch(/[!@#$%^&*]/);
      expect(p).not.toMatch(/[01OIol]/);
    }
  });

  it("varies between calls", () => {
    const seen = new Set(Array.from({ length: 10 }, () => randomTempPassword()));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("renderInviteEmail", () => {
  it("existing account → set-password link, no password inside", () => {
    const { subject, html } = renderInviteEmail({
      email: "sam@vura.co.za",
      role: "support_agent",
      resetLink: "https://identity.example/reset?o=abc",
    });
    expect(subject).toMatch(/invited/i);
    expect(html).toContain("https://identity.example/reset?o=abc");
    expect(html).toContain("sam@vura.co.za");
    expect(html).toContain("Support Agent");
    expect(html).toContain("vura-admin-backoffice.pages.dev");
    expect(html).not.toMatch(/temporary password/i);
  });

  it("new account → temporary password shown prominently", () => {
    const { html } = renderInviteEmail({
      email: "new@vura.co.za",
      role: "super_admin",
      tempPassword: "Kx9!mQr7Wp2Z",
    });
    expect(html).toContain("Kx9!mQr7Wp2Z");
    expect(html).toContain("Super Admin");
    expect(html).toContain("temporary password");
  });
});

describe("renderResetEmail", () => {
  it("carries the link and the ignore-if-unexpected line", () => {
    const { subject, html } = renderResetEmail("https://identity.example/rst?x=1");
    expect(subject).toMatch(/reset/i);
    expect(html).toContain("https://identity.example/rst?x=1");
    expect(html).toMatch(/didn't request/i);
  });
});

describe("humanizeRole", () => {
  it("turns snake_case into label case", () => {
    expect(humanizeRole("super_admin")).toBe("Super Admin");
    expect(humanizeRole("support_agent")).toBe("Support Agent");
  });
});

describe("sendAdminInviteEmail — no key fails LOUD, never silently", () => {
  it("returns ok:false with a reason when RESEND_API_KEY is missing", async () => {
    const original = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    const out = await sendAdminInviteEmail({ email: "x@y.co", role: "support_agent", tempPassword: "Aa1!aaaa" });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/RESEND_API_KEY/);
    if (original !== undefined) process.env.RESEND_API_KEY = original;
    vi.restoreAllMocks();
  });
});

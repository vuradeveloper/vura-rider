"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONSOLE_URL = void 0;
exports.randomTempPassword = randomTempPassword;
exports.humanizeRole = humanizeRole;
exports.renderInviteEmail = renderInviteEmail;
exports.renderResetEmail = renderResetEmail;
exports.sendResendEmail = sendResendEmail;
exports.sendAdminInviteEmail = sendAdminInviteEmail;
exports.sendPasswordResetEmail = sendPasswordResetEmail;
// ─────────────────────────────────────────────────────────────────────────────
// ADMIN INVITE — makes "Invite an admin" actually deliver. The route upserts
// the admin_users row; THIS file makes sure a Firebase Auth account exists
// (created with a temporary password when it doesn't) and emails the details:
//   • existing account  → a Firebase "set your password" link (own password)
//   • new account       → a temporary password for first sign-in
// If RESEND_API_KEY is missing or the API fails, callers get `ok:false` and
// the route surfaces the temp password to the INVITER so the invitation never
// dies silently. Passwords/keys are read per call so tests can toggle them.
// ─────────────────────────────────────────────────────────────────────────────
const crypto_1 = require("crypto");
const FROM_EMAIL = () => process.env.RESEND_FROM_EMAIL || "onboarding@ridevura.com";
/** Where the invitee signs in (Cloudflare Pages console). */
exports.CONSOLE_URL = process.env.CONSOLE_URL || "https://vura-admin-backoffice.pages.dev";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I/O — read-aloud friendly
const LOWER = "abcdefghjkmnpqrstuvwxyz"; // no i/l/o
const DIGIT = "23456789"; // no 0/1
const SYMBOL = "!@#$%^&*";
/** 12 characters, at least one of each class — friendly to Firebase's policy. */
function randomTempPassword() {
    const pick = (set) => set[(0, crypto_1.randomInt)(0, set.length)];
    const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
    const all = UPPER + LOWER + DIGIT + SYMBOL;
    while (chars.length < 12)
        chars.push(pick(all));
    for (let i = chars.length - 1; i > 0; i--) {
        const j = (0, crypto_1.randomInt)(0, i + 1);
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join("");
}
/** "super_admin" → "Super admin" for humans reading the email. */
function humanizeRole(role) {
    return role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
/** The invitation email (pure — unit-tested). */
function renderInviteEmail(m) {
    const subject = "You've been invited to the Vura BackOffice";
    const action = m.tempPassword
        ? `<p>Your temporary password:</p>
       <p style="font:700 22px/1.4 monospace;background:#f5f5f5;padding:12px 16px;border-radius:8px;display:inline-block">${m.tempPassword}</p>
       <p>Sign in with your email and this password, then change it straight away.</p>`
        : m.resetLink
            ? `<p><a href="${m.resetLink}" style="display:inline-block;background:#1A1A1A;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">Set your password &amp; sign in</a></p>
         <p>This link expires — use it soon. If you didn't expect this, ignore this email.</p>`
            : `<p>We could not prepare sign-in details automatically — contact the person who invited you.</p>`;
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1A1A1A;max-width:520px;margin:0 auto">
  <h2 style="margin-bottom:8px">You're a Vura BackOffice admin</h2>
  <p>You were added as <strong>${humanizeRole(m.role)}</strong> with this address:</p>
  <p style="font-weight:700">${m.email}</p>
  ${action}
  <p style="margin-top:24px"><a href="${exports.CONSOLE_URL}">${exports.CONSOLE_URL}</a></p>
  <p style="color:#888;font-size:12px">Your role decides what you can see and change. Every action you take is recorded in the audit log.</p>
</div>`;
    return { subject, html };
}
/** The console's "Forgot password" email (pure — unit-tested). */
function renderResetEmail(resetLink) {
    return {
        subject: "Reset your Vura BackOffice password",
        html: `<div style="font-family:Arial,Helvetica,sans-serif;color:#1A1A1A;max-width:520px;margin:0 auto">
  <h2>Reset your password</h2>
  <p><a href="${resetLink}" style="display:inline-block;background:#1A1A1A;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">Choose a new password</a></p>
  <p style="color:#888;font-size:12px">If you didn't request this, ignore this email — nothing changes.</p>
</div>`,
    };
}
/** POST to Resend. `ok:false` carries a human-readable reason. */
async function sendResendEmail(input) {
    const key = process.env.RESEND_API_KEY || "";
    if (!key)
        return { ok: false, error: "Email service not configured (RESEND_API_KEY)" };
    try {
        const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({ from: FROM_EMAIL(), to: input.to, subject: input.subject, html: input.html }),
        });
        if (r.ok)
            return { ok: true };
        const data = await r.json().catch(() => ({}));
        return { ok: false, error: data?.message || `Resend failed (${r.status})` };
    }
    catch (e) {
        return { ok: false, error: e?.message || "Email send failed" };
    }
}
/** Deliver the invitation (link for existing accounts, temp password for new). */
async function sendAdminInviteEmail(m) {
    const { subject, html } = renderInviteEmail(m);
    return sendResendEmail({ to: m.email, subject, html });
}
/** Deliver a password-reset link (console "Forgot password?"). */
async function sendPasswordResetEmail(email, resetLink) {
    const { subject, html } = renderResetEmail(resetLink);
    return sendResendEmail({ to: email, subject, html });
}
//# sourceMappingURL=adminInvite.js.map
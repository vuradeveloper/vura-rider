/** Where the invitee signs in (Cloudflare Pages console). */
export declare const CONSOLE_URL: string;
/** 12 characters, at least one of each class — friendly to Firebase's policy. */
export declare function randomTempPassword(): string;
/** "super_admin" → "Super admin" for humans reading the email. */
export declare function humanizeRole(role: string): string;
export interface InviteMail {
    email: string;
    role: string;
    /** Present only for a freshly created account. */
    tempPassword?: string | null;
    /** Present only for an existing account (Firebase set-password link). */
    resetLink?: string | null;
}
/** The invitation email (pure — unit-tested). */
export declare function renderInviteEmail(m: InviteMail): {
    subject: string;
    html: string;
};
/** The console's "Forgot password" email (pure — unit-tested). */
export declare function renderResetEmail(resetLink: string): {
    subject: string;
    html: string;
};
/** POST to Resend. `ok:false` carries a human-readable reason. */
export declare function sendResendEmail(input: {
    to: string;
    subject: string;
    html: string;
}): Promise<{
    ok: boolean;
    error?: string;
}>;
/** Deliver the invitation (link for existing accounts, temp password for new). */
export declare function sendAdminInviteEmail(m: InviteMail): Promise<{
    ok: boolean;
    error?: string;
}>;
/** Deliver a password-reset link (console "Forgot password?"). */
export declare function sendPasswordResetEmail(email: string, resetLink: string): Promise<{
    ok: boolean;
    error?: string;
}>;
//# sourceMappingURL=adminInvite.d.ts.map
import { i as createServerFn } from "./esm-Dova13aH.js";
import { t as createServerRpc } from "./createServerRpc-WJgk8O8C.js";
//#region src/lib/email.ts?tss-serverfn-split
/**
* Server Function to send verification email securely via Resend API on the backend.
* Bypasses CORS and keeps the API key hidden from the client browser.
*/
var sendVerificationEmail_createServerFn_handler = createServerRpc({
	id: "bca51df22d8a6c730017c7cb2bde4f7305bbdd712ae27a692c6015c21629e22c",
	name: "sendVerificationEmail",
	filename: "src/lib/email.ts"
}, (opts) => sendVerificationEmail.__executeServer(opts));
var sendVerificationEmail = createServerFn({ method: "POST" }).validator((data) => data).handler(sendVerificationEmail_createServerFn_handler, async ({ data: { email, code } }) => {
	const apiKey = process.env.VITE_RESEND_API_KEY || "";
	const fromEmail = process.env.VITE_RESEND_FROM_EMAIL || "onboarding@resend.dev";
	if (!apiKey) {
		console.error("VITE_RESEND_API_KEY is not set on the server.");
		return {
			success: false,
			error: "Server configuration missing: VITE_RESEND_API_KEY is not set."
		};
	}
	try {
		const response = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`
			},
			body: JSON.stringify({
				from: `Vura Verification <${fromEmail}>`,
				to: email,
				subject: `${code} is your Vura verification code`,
				html: `
            <div style="font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 32px 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
              <div style="text-align: center; margin-bottom: 24px;">
                <span style="font-size: 28px; font-weight: 800; color: #1a1a1a; letter-spacing: -0.5px;">VURA</span>
              </div>
              <h2 style="font-size: 20px; font-weight: 700; color: #1a1a1a; margin: 0 0 12px 0;">Verify your email address</h2>
              <p style="font-size: 14px; line-height: 20px; color: #4a5568; margin: 0 0 24px 0;">
                Thank you for signing up. Please enter the verification code below to complete your registration.
              </p>
              <div style="text-align: center; background-color: #f7fafc; border: 1px solid #edf2f7; border-radius: 12px; padding: 16px; margin-bottom: 24px;">
                <span style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #000000; font-family: monospace;">${code}</span>
              </div>
              <p style="font-size: 12px; line-height: 16px; color: #718096; margin: 0; text-align: center;">
                This code will expire in 10 minutes. If you did not request this code, you can safely ignore this email.
              </p>
            </div>
          `
			})
		});
		if (response.ok) return { success: true };
		else return {
			success: false,
			error: (await response.json())?.message || "Failed to send email."
		};
	} catch (err) {
		return {
			success: false,
			error: err?.message || "Network error on email server."
		};
	}
});
//#endregion
export { sendVerificationEmail_createServerFn_handler };

import { createServerFn } from "@tanstack/react-start";

/**
 * Server Function to send verification email securely via Resend API on the backend.
 * Bypasses CORS and keeps the API key hidden from the client browser.
 */
export const sendVerificationEmail = createServerFn({ method: "POST" })
  .validator((data: { email: string; code: string }) => data)
  .handler(async ({ data: { email, code } }) => {
    // Server environment variables
    const apiKey = process.env.RESEND_API_KEY || "";
    const fromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";

    if (!apiKey) {
      console.error("RESEND_API_KEY is not set on the server.");
      return {
        success: false,
        error: "Server configuration missing: RESEND_API_KEY is not set.",
      };
    }

    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
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
          `,
        }),
      });

      if (response.ok) {
        return { success: true };
      } else {
        const data = await response.json();
        return { success: false, error: data?.message || "Failed to send email." };
      }
    } catch (err: any) {
      return { success: false, error: err?.message || "Network error on email server." };
    }
  });

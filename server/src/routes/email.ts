import { Router, Request, Response } from "express";

const router = Router();

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "onboarding@ridevura.com";

// POST /api/email/send-verification — Send a verification code email.
// Runs server-side so the Resend API key never reaches the browser (Resend
// rejects direct browser calls via CORS).
router.post("/send-verification", async (req: Request, res: Response) => {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) {
      res.status(400).json({ success: false, error: "Missing email or code" });
      return;
    }
    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY not set on server");
      res.status(500).json({ success: false, error: "Email service not configured" });
      return;
    }

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: email,
        subject: "Your Vura verification code",
        html: `<p>Your verification code is: <strong>${code}</strong></p><p>This code expires in 10 minutes.</p>`,
      }),
    });
    const data: any = await r.json();
    res.status(r.ok ? 200 : 502).json(
      r.ok
        ? { success: true }
        : { success: false, error: data?.message || "Failed to send email" }
    );
  } catch (err: any) {
    console.error("Send verification email error:", err);
    res.status(500).json({ success: false, error: err?.message || "Network error" });
  }
});

export default router;

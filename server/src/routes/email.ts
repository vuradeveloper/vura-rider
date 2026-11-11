import { Router, Request, Response } from "express";
import path from "path";
import sharp from "sharp";
import { queryOne, execute } from "../config/database";
import {
  ensureEmailCampaignSchema,
  verifyEmailUnsubToken,
} from "../services/emailCampaigns";

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function xml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapWords(text: string, maxChars: number, maxLines: number): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.length ? lines : ["Vura"];
}

/** A branded 1200×520 hero generated on demand — no file storage needed. */
router.get("/hero/:id.png", async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || "");
    let campaign: any = null;
    if (UUID_RE.test(id)) {
      await ensureEmailCampaignSchema().catch(() => undefined);
      campaign = await queryOne(
        `SELECT heading, discount_label, promo_code FROM email_campaigns WHERE id = $1`,
        [id]
      ).catch(() => null);
    }
    const heading = campaign?.heading || "Ride more, pay less.";
    const discount = campaign?.discount_label || "";
    const code = campaign?.promo_code || "";
    const lines = wrapWords(heading, 27, 3);
    const lineSvg = lines
      .map(
        (line, i) =>
          `<text x="64" y="${238 + i * 62}" fill="#FFFFFF" font-family="Arial, Helvetica, sans-serif" font-size="54" font-weight="800">${xml(
            line
          )}</text>`
      )
      .join("");
    const badge = discount
      ? `<rect x="64" y="${238 + lines.length * 62 + 18}" width="${Math.min(
          520,
          34 + discount.length * 22
        )}" height="58" rx="29" fill="#EA4335"/>
         <text x="${64 + Math.min(520, 34 + discount.length * 22) / 2}" y="${
          238 + lines.length * 62 + 56
        }" text-anchor="middle" fill="#FFFFFF" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="700">${xml(
          discount
        )}</text>`
      : "";
    const codeLine = code
      ? `<text x="64" y="478" fill="#F6D7D3" font-family="'Courier New', Courier, monospace" font-size="20" letter-spacing="3">CODE ${xml(
          code
        )}</text>`
      : "";

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="520" viewBox="0 0 1200 520">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#141414"/>
          <stop offset="1" stop-color="#2B1513"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="520" fill="url(#bg)"/>
      <circle cx="1080" cy="40" r="290" fill="#EA4335" opacity="0.32"/>
      <circle cx="930" cy="470" r="250" fill="#F4B400" opacity="0.16"/>
      <circle cx="1120" cy="340" r="110" fill="none" stroke="#FFFFFF" stroke-opacity="0.12" stroke-width="22"/>
      <rect x="50" y="36" width="310" height="98" rx="22" fill="#FFFFFF"/>
      ${lineSvg}
      ${badge}
      ${codeLine}
      <text x="64" y="66" fill="#EA4335" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="700" letter-spacing="5">VURA</text>
      <text x="64" y="500" fill="#FFFFFF" opacity="0.55" font-family="Arial, Helvetica, sans-serif" font-size="16" letter-spacing="2">RIDE MORE, PAY LESS</text>
    </svg>`;

    let image = sharp(Buffer.from(svg)).png();
    try {
      const logoPath = path.join(__dirname, "..", "..", "assets", "vura-logo.png");
      const logo = await sharp(logoPath).resize({ width: 250, withoutEnlargement: true }).png().toBuffer();
      image = image.composite([{ input: logo, left: 80, top: 57 }]);
    } catch {
      /* the hero still works without the logo overlay */
    }
    const out = await image.png().toBuffer();
    res.set("Cache-Control", "public, max-age=3600");
    res.type("png").send(out);
  } catch (err: any) {
    console.warn("[email] hero render failed:", err?.message || err);
    res.status(500).end();
  }
});

function unsubscribePage(ok: boolean): string {
  const title = ok ? "You’re unsubscribed" : "That link is not valid";
  const body = ok
    ? "We’ve stopped sending promo and announcement emails to this address. You will still receive essential trip and account emails."
    : "This unsubscribe link is invalid or has expired. Open the Vura app → Account → Notifications to manage your preferences.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Vura</title></head>
  <body style="margin:0;background:#F3F1EE;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:560px;margin:60px auto;background:#fff;border-radius:24px;padding:36px;box-shadow:0 12px 40px rgba(20,20,20,.10)">
      <img src="https://api.ridevura.com/api/share/logo.png" alt="Vura" width="118" style="display:block;margin-bottom:26px">
      <h1 style="margin:0 0 14px;color:#141414;font-size:28px">${title}</h1>
      <p style="margin:0;color:#4A4A4A;font-size:16px;line-height:1.6">${body}</p>
      <p style="margin:26px 0 0;font-size:13px;color:#8A8A8A">Questions? Email support@ridevura.com.</p>
    </div>
  </body></html>`;
}

// GET /api/email/unsubscribe?u=<user>&t=<hmac> — public opt-out from marketing.
router.get("/unsubscribe", async (req: Request, res: Response) => {
  try {
    const userId = String(req.query.u || "");
    const token = String(req.query.t || "");
    if (!UUID_RE.test(userId) || !verifyEmailUnsubToken(userId, token)) {
      res.status(400).type("html").send(unsubscribePage(false));
      return;
    }
    await ensureEmailCampaignSchema();
    await execute(
      `UPDATE users SET email_opt_out = TRUE, email_opt_out_at = NOW() WHERE id = $1`,
      [userId]
    );
    res.type("html").send(unsubscribePage(true));
  } catch (err: any) {
    console.error("[email] unsubscribe failed:", err?.message || err);
    res.status(500).type("html").send(unsubscribePage(false));
  }
});

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

// POST /api/email/receipt — Email a ride receipt to the authenticated rider.
router.post("/receipt", async (req: Request, res: Response) => {
  try {
    const { rideId, userId } = req.body || {};
    if (!rideId || !userId) {
      res.status(400).json({ success: false, error: "Missing ride or user" });
      return;
    }
    if (!RESEND_API_KEY) {
      res.status(500).json({ success: false, error: "Email service not configured" });
      return;
    }
    const ride = await queryOne<any>(
      `SELECT r.id, r.pickup_address, r.destination_address, r.estimated_fare, r.actual_fare, r.status,
              u.email, u.full_name
       FROM rides r JOIN users u ON u.id = r.passenger_id
       WHERE r.id = $1 AND r.passenger_id = $2`,
      [rideId, userId]
    ).catch(() => null);
    if (!ride?.email) {
      res.status(404).json({ success: false, error: "Ride not found" });
      return;
    }
    const fare = Number(ride.actual_fare ?? ride.estimated_fare ?? 0);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: ride.email,
        subject: `Your Vura receipt (R ${fare.toFixed(2)})`,
        html: `<div style="font-family: Arial, sans-serif:max-width:480px;margin:auto">
                 <h2>Vura — ride receipt</h2>
                 <p><strong>${ride.full_name || "Rider"}</strong>, thanks for riding with Vura!</p>
                 <p>From: ${ride.pickup_address}<br/>To: ${ride.destination_address}</p>
                 <p style="font-size:20px"><strong>Fare: R ${fare.toFixed(2)}</strong></p>
                 <p style="color:#888;font-size:12px">Ride status: ${ride.status}</p>
               </div>`,
      }),
    });
    const data: any = await r.json();
    res.status(r.ok ? 200 : 502).json({ success: r.ok, error: data?.message });
  } catch (err: any) {
    console.error("Receipt email error:", err);
    res.status(500).json({ success: false, error: err?.message || "Network error" });
  }
});

export default router;

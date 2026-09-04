import { Router, Request, Response } from "express";
import { queryOne } from "../config/database";

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

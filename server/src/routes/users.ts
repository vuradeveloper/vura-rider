import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";
import { deleteAccountData } from "../services/accountDeletion";
import { claimReferral, ensureAffiliateTables } from "../services/AffiliateService";
import { getAuth } from "../config/firebase";
import { CONSOLE_URL, sendPasswordResetEmail } from "../services/adminInvite";

const router = Router();

// POST /api/users/forgot-password — the console's "Forgot password?".
// Emails a Firebase set-password link (delivered via Resend). ALWAYS answers
// success: the response must not reveal which addresses have accounts.
router.post("/forgot-password", async (req: AuthRequest, res: Response) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  try {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.json({ success: true });
      return;
    }
    let link: string;
    try {
      link = await getAuth().generatePasswordResetLink(email, { url: CONSOLE_URL });
    } catch {
      res.json({ success: true }); // no such account — stay silent
      return;
    }
    const sent = await sendPasswordResetEmail(email, link);
    console.log(
      `[admin-invite] password reset for ${email}: ${sent.ok ? "sent" : `FAILED — ${sent.error}`}`
    );
    res.json({ success: true });
  } catch (err: any) {
    console.warn("[admin-invite] forgot-password error:", err?.message || err);
    res.json({ success: true });
  }
});

// POST /api/users/sync — Create or update user from Firebase auth
router.post("/sync", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { role, phone, full_name, referralCode } = req.body;
    const firebaseUid = req.userId!;

    const existing = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );

    if (existing) {
      const updates: string[] = [];
      const params: any[] = [];
      let idx = 1;

      // A driver must never be downgraded to passenger just because the RIDER app
      // was used with the same account: both apps share one auth system, and the
      // rider app syncs `role: 'passenger'` on launch. That flip locks a real
      // driver out of their own documents (403 "Insufficient permissions") and out
      // of GET /api/rides/available, which is how rides reach them at all.
      // Added 27 Sep 2026 after exactly that was reported from the field.
      let effectiveRole = role;
      if (role === "passenger") {
        const current = await queryOne<{ role: string | null; has_profile: boolean }>(
          `SELECT u.role,
                  EXISTS (SELECT 1 FROM driver_profiles dp WHERE dp.user_id = u.id) AS has_profile
             FROM users u WHERE u.firebase_uid = $1`,
          [firebaseUid]
        );
        if (current?.role === "driver" || current?.has_profile) {
          effectiveRole = undefined;
        }
      }

      if (effectiveRole) { updates.push(`role = $${idx}`); params.push(effectiveRole); idx++; }
      if (phone) { updates.push(`phone = $${idx}`); params.push(phone); idx++; }
      if (full_name) { updates.push(`full_name = $${idx}`); params.push(full_name); idx++; }
      if (req.user?.email) { updates.push(`email = $${idx}`); params.push(req.user.email); idx++; }
      updates.push(`updated_at = NOW()`);

      if (updates.length > 0) {
        params.push(firebaseUid);
        await execute(
          `UPDATE users SET ${updates.join(", ")} WHERE firebase_uid = $${idx}`,
          params
        );
      }

      const user = await queryOne(
        "SELECT id, firebase_uid, full_name, email, phone, role, profile_photo_url, id_number, id_document_name, license_document_name, created_at FROM users WHERE firebase_uid = $1",
        [firebaseUid]
      );

      // Existing user may have picked up a referral code since their first login
      // (e.g. tapped an invite link after registering). Claim it now — the claim
      // is idempotent, so it's a safe no-op if they've already been referred.
      if (user?.id && referralCode) {
        try {
          await ensureAffiliateTables();
          await claimReferral(user.id, String(referralCode));
        } catch (err: any) {
          console.warn("Referral claim skipped:", err.message);
        }
      }

      res.json({ user });
    } else {
      const user = await queryOne(
        `INSERT INTO users (firebase_uid, full_name, email, phone, role, profile_photo_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, firebase_uid, full_name, email, phone, role, profile_photo_url, id_number, id_document_name, license_document_name, created_at`,
        [firebaseUid, full_name || req.user?.name || "Rider", req.user?.email || null, phone || null, role || "passenger", req.user?.picture || null]
      );

      if (user?.id && referralCode) {
        try {
          await ensureAffiliateTables();
          await claimReferral(user.id, String(referralCode));
        } catch (err: any) {
          console.warn("Referral claim skipped:", err.message);
        }
      }

      res.status(201).json({ user });
    }
  } catch (err: any) {
    console.error("User sync error:", err);
    res.status(500).json({ error: err.message || "Failed to sync user" });
  }
});

// PUT /api/users/profile — Update user profile
router.put("/profile", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { full_name, email, phone } = req.body;
    const firebaseUid = req.userId!;

    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (full_name !== undefined) { updates.push(`full_name = $${idx}`); params.push(full_name); idx++; }
    if (email !== undefined) { updates.push(`email = $${idx}`); params.push(email); idx++; }
    if (phone !== undefined) { updates.push(`phone = $${idx}`); params.push(phone); idx++; }
    updates.push(`updated_at = NOW()`);

    params.push(firebaseUid);
    await execute(
      `UPDATE users SET ${updates.join(", ")} WHERE firebase_uid = $${idx}`,
      params
    );

    const updated = await queryOne(
      "SELECT id, firebase_uid, full_name, email, phone, role, profile_photo_url, id_number, id_document_name, license_document_name FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    res.json({ user: updated });
  } catch (err: any) {
    console.error("Profile update error:", err);
    res.status(500).json({ error: err.message || "Failed to update profile" });
  }
});

// POST /api/users/photo — Upload profile photo
router.post("/photo", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const { photo } = req.body;

    if (!photo) {
      res.status(400).json({ error: "No photo provided" });
      return;
    }

    await execute(
      "UPDATE users SET profile_photo_url = $1, updated_at = NOW() WHERE firebase_uid = $2",
      [photo, firebaseUid]
    );

    res.json({ photoURL: photo });
  } catch (err: any) {
    console.error("Photo upload error:", err);
    res.status(500).json({ error: err.message || "Failed to upload photo" });
  }
});

// POST /api/users/delete — Delete user account and everything linked to it.
// The FK-safe ordering lives in services/accountDeletion.ts so it can be
// exercised against a real Postgres schema; this route only resolves the
// Firebase uid to a user row and reports the result.
router.post("/delete", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;

    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );

    // A Firebase login can exist without a Postgres row (signup abandoned
    // before the profile insert); there is simply no data to delete.
    if (user) {
      await deleteAccountData(user.id);
    }

    // Remove the Firebase identity too. The client cannot always do this:
    // accounts:delete needs a RECENT sign-in, and a driver logged in for months
    // gets CREDENTIAL_TOO_OLD_LOGIN_AGAIN. The Admin SDK has no such limit.
    // The DB rows are already gone, so a cleanup failure must not turn a
    // successful deletion into an error — log it for ops instead.
    try {
      await getAuth().deleteUser(firebaseUid);
    } catch (err: any) {
      if (err?.code !== "auth/user-not-found") {
        console.error(`[account-delete] Firebase cleanup failed for ${firebaseUid}:`, err);
      }
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("Account deletion error:", err);
    res.status(500).json({ error: err.message || "Failed to delete account" });
  }
});

export default router;
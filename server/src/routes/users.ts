import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";
import { deleteAccountData } from "../services/accountDeletion";
import { claimReferral, ensureAffiliateTables } from "../services/AffiliateService";
import { getAuth } from "../config/firebase";
import { sendPasswordResetEmail } from "../services/adminInvite";
import { findDuplicateMatches, markUserDuplicate } from "../services/duplicateDetection";
import { normaliseIdNumber, normalisePhone } from "../lib/identity";
import { readMaintenanceStatus } from "../services/featureFlags";

const router = Router();

// POST /api/users/forgot-password - rider, driver and console "Forgot password?".
// Emails a Firebase set-password link through Resend. ALWAYS answers success:
// the response must not reveal which addresses have accounts.
//
// IMPORTANT: do not pass a `url` continue target here. Only the Firebase auth
// domains are allowlisted for this project; passing the console URL made every
// reset fail with `auth/unauthorized-continue-uri`, and the catch returned
// success without sending anything. The default Firebase action page lets the
// user choose a new password, then they return to the app. `app` only selects
// the copy in the email.
const APP_LABELS: Record<string, string> = {
  rider: "Vura Ride",
  driver: "Vura Driver",
  admin: "Vura BackOffice",
};

router.post("/forgot-password", async (req: AuthRequest, res: Response) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const app = String(req.body?.app || "").trim().toLowerCase();
  const appName = APP_LABELS[app] || "Vura";
  try {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.json({ success: true });
      return;
    }
    let link: string;
    try {
      link = await getAuth().generatePasswordResetLink(email);
    } catch (err: any) {
      // No such account is expected; anything else is an operational failure
      // and must be visible in the logs even though the API stays neutral.
      if (err?.code !== "auth/user-not-found") {
        console.warn(
          `[password-reset] link generation failed for ${email}:`,
          err?.code || "",
          err?.message || err
        );
      }
      res.json({ success: true });
      return;
    }
    const sent = await sendPasswordResetEmail(email, link, appName);
    console.log(
      `[password-reset] ${app || "app"} link for ${email}: ${
        sent.ok ? "sent via Resend" : `FAILED - ${sent.error}`
      }`
    );
    res.json({ success: true });
  } catch (err: any) {
    console.warn("[password-reset] forgot-password error:", err?.message || err);
    res.json({ success: true });
  }
});

// POST /api/users/sync — Create or update user from Firebase auth
router.post("/sync", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { role, phone, full_name, id_number, referralCode } = req.body;
    const firebaseUid = req.userId!;

    // Maintenance lock: do not create or revive a rider/driver account while
    // that side is closed. This is the server-side stop for the app's
    // sign-in/sign-up flow (Firebase accepts the password, then this refuses).
    const requestedSide = role === "driver" ? "driver" : "rider";
    const maint = await readMaintenanceStatus();
    if (maint[requestedSide].enabled) {
      res.status(503).json({
        error: maint[requestedSide].message,
        code: "maintenance",
      });
      return;
    }

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
      if (id_number !== undefined) { updates.push(`id_number = $${idx}`); params.push(id_number); idx++; }
      if (req.user?.email) { updates.push(`email = $${idx}`); params.push(req.user.email); idx++; }
      updates.push(`updated_at = NOW()`);

      if (updates.length > 0) {
        params.push(firebaseUid);
        await execute(
          `UPDATE users SET ${updates.join(", ")} WHERE firebase_uid = $${idx}`,
          params
        );
      }

      const user = await queryOne<any>(
        "SELECT id, firebase_uid, full_name, email, phone, role, profile_photo_url, id_number, id_document_name, license_document_name, created_at FROM users WHERE firebase_uid = $1",
        [firebaseUid]
      );

      // Keep the searchable normalised columns current, then flag (but never
      // block) an existing account that now shares a phone/ID/email. A login
      // must always succeed; the admin decides what to do with the duplicate.
      let duplicateFlagged = false;
      if (user?.id) {
        await execute(
          `UPDATE users SET phone_normalized = $2, id_number_normalized = $3 WHERE id = $1`,
          [
            user.id,
            normalisePhone(user.phone) || null,
            normaliseIdNumber(user.id_number) || null,
          ]
        ).catch(() => {});
        const matches = await findDuplicateMatches({
          userId: user.id,
          phone: user.phone,
          idNumber: user.id_number,
          email: user.email,
        }).catch(() => []);
        if (matches.length > 0) {
          duplicateFlagged = await markUserDuplicate(user.id, matches[0]).catch(() => false);
        }
      }

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

      res.json({ user, duplicate_flagged: duplicateFlagged });
    } else {
      // A new account may not reuse a phone number or ID number. This is the
      // strong signal; an email typo alone is queued for review instead.
      const matches = await findDuplicateMatches({
        phone,
        idNumber: id_number,
        email: req.user?.email,
      }).catch(() => []);
      const strong = matches.find((m) => m.kind === "phone" || m.kind === "id");
      if (strong) {
        res.status(409).json({
          error:
            "This phone number or ID number is already linked to another Vura account. " +
            "Sign in with that account, or contact support if you no longer have access to it.",
          code: "DUPLICATE_ACCOUNT",
          duplicate_kind: strong.kind,
        });
        return;
      }

      const user = await queryOne<any>(
        `INSERT INTO users (firebase_uid, full_name, email, phone, id_number, role, profile_photo_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, firebase_uid, full_name, email, phone, role, profile_photo_url, id_number, id_document_name, license_document_name, created_at`,
        [
          firebaseUid,
          full_name || req.user?.name || "Rider",
          req.user?.email || null,
          phone || null,
          id_number || null,
          role || "passenger",
          req.user?.picture || null,
        ]
      );

      let duplicateFlagged = false;
      if (user?.id) {
        await execute(
          `UPDATE users SET phone_normalized = $2, id_number_normalized = $3 WHERE id = $1`,
          [
            user.id,
            normalisePhone(user.phone) || null,
            normaliseIdNumber(user.id_number) || null,
          ]
        ).catch(() => {});
        if (matches.length > 0) {
          duplicateFlagged = await markUserDuplicate(user.id, matches[0]).catch(() => false);
        }
      }

      if (user?.id && referralCode) {
        try {
          await ensureAffiliateTables();
          await claimReferral(user.id, String(referralCode));
        } catch (err: any) {
          console.warn("Referral claim skipped:", err.message);
        }
      }

      res.status(201).json({ user, duplicate_flagged: duplicateFlagged });
    }
  } catch (err: any) {
    console.error("User sync error:", err);
    res.status(500).json({ error: err.message || "Failed to sync user" });
  }
});

// PUT /api/users/profile — Update user profile
router.put("/profile", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { full_name, email, phone, id_number } = req.body;
    const firebaseUid = req.userId!;

    const updates: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (full_name !== undefined) { updates.push(`full_name = $${idx}`); params.push(full_name); idx++; }
    if (email !== undefined) { updates.push(`email = $${idx}`); params.push(email); idx++; }
    if (phone !== undefined) { updates.push(`phone = $${idx}`); params.push(phone); idx++; }
    if (id_number !== undefined) { updates.push(`id_number = $${idx}`); params.push(id_number); idx++; }
    updates.push(`updated_at = NOW()`);

    params.push(firebaseUid);
    await execute(
      `UPDATE users SET ${updates.join(", ")} WHERE firebase_uid = $${idx}`,
      params
    );

    const updated = await queryOne<any>(
      "SELECT id, firebase_uid, full_name, email, phone, role, profile_photo_url, id_number, id_document_name, license_document_name FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );

    let duplicateFlagged = false;
    if (updated?.id) {
      await execute(
        `UPDATE users SET phone_normalized = $2, id_number_normalized = $3 WHERE id = $1`,
        [
          updated.id,
          normalisePhone(updated.phone) || null,
          normaliseIdNumber(updated.id_number) || null,
        ]
      ).catch(() => {});
      const matches = await findDuplicateMatches({
        userId: updated.id,
        phone: updated.phone,
        idNumber: updated.id_number,
        email: updated.email,
      }).catch(() => []);
      if (matches.length > 0) {
        duplicateFlagged = await markUserDuplicate(updated.id, matches[0]).catch(() => false);
      }
    }

    res.json({ user: updated, duplicate_flagged: duplicateFlagged });
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
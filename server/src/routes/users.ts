import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";

const router = Router();

// POST /api/users/sync — Create or update user from Firebase auth
router.post("/sync", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { role, phone, full_name } = req.body;
    const firebaseUid = req.userId!;

    // Ensure columns exist on users table
    try {
      await execute(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS id_number VARCHAR(50),
        ADD COLUMN IF NOT EXISTS id_document_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS license_document_name VARCHAR(255)
      `);
    } catch { /* columns already exist or alter ignored */ }

    const existing = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );

    if (existing) {
      const updates: string[] = [];
      const params: any[] = [];
      let idx = 1;

      if (role) { updates.push(`role = $${idx}`); params.push(role); idx++; }
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
      res.json({ user });
    } else {
      const user = await queryOne(
        `INSERT INTO users (firebase_uid, full_name, email, phone, role, profile_photo_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, firebase_uid, full_name, email, phone, role, profile_photo_url, id_number, id_document_name, license_document_name, created_at`,
        [firebaseUid, full_name || req.user?.name || "Rider", req.user?.email || null, phone || null, role || "passenger", req.user?.picture || null]
      );
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

// POST /api/users/delete — Delete user account
router.post("/delete", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;

    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );

    if (user) {
      await execute("DELETE FROM rides WHERE passenger_id = $1 OR driver_id = $1", [user.id]);
      await execute("DELETE FROM driver_profiles WHERE user_id = $1", [user.id]);
      await execute("DELETE FROM driver_earnings WHERE driver_id = $1", [user.id]);
      await execute("DELETE FROM chat_messages WHERE sender_id = $1", [user.id]);
      await execute("DELETE FROM ratings WHERE passenger_id = $1 OR driver_id = $1", [user.id]);
      await execute("DELETE FROM users WHERE id = $1", [user.id]);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("Account deletion error:", err);
    res.status(500).json({ error: err.message || "Failed to delete account" });
  }
});

export default router;
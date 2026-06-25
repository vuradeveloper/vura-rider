import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { verifyToken } from "../config/firebase";
import { query, queryOne } from "../config/database";
import { User, UserWithDriver } from "../types";

const router = Router();

// ── Sync user (after Firebase login) ──
router.post("/sync", async (req: Request, res: Response) => {
  try {
    const { token, role, phone } = req.body;

    if (!token || !role) {
      res.status(400).json({ error: "token and role are required" });
      return;
    }

    if (role !== "driver" && role !== "passenger") {
      res.status(400).json({ error: 'role must be "driver" or "passenger"' });
      return;
    }

    const decoded = await verifyToken(token);

    let user = await queryOne<User>(
      `SELECT * FROM users WHERE firebase_uid = $1`,
      [decoded.uid]
    );

    if (user) {
      if (phone && phone !== user.phone) {
        user = await queryOne<User>(
          `UPDATE users SET phone = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
          [phone, user.id]
        );
      }
    } else {
      user = await queryOne<User>(
        `INSERT INTO users (firebase_uid, role, email, full_name, phone, profile_photo_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          decoded.uid,
          role,
          decoded.email ?? null,
          decoded.name ?? null,
          phone ?? null,
          decoded.picture ?? null,
        ]
      );

      if (role === "driver") {
        await query(
          `INSERT INTO driver_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
          [(user as User).id]
        );
      }
    }

    res.json({ user });
  } catch (err: any) {
    console.error("POST /api/users/sync error:", err.message);
    const status = err.code === "auth/id-token-expired" ? 401 : 500;
    res.status(status).json({ error: err.message || "Sync failed" });
  }
});

// ── Get current user ──
router.get("/me", authMiddleware, async (req: Request, res: Response) => {
  try {
    const uid = req.user?.firebase_uid;
    const user = await queryOne<UserWithDriver>(
      `SELECT u.*, dp.*
       FROM users u
       LEFT JOIN driver_profiles dp ON dp.user_id = u.id
       WHERE u.firebase_uid = $1`,
      [uid]
    );

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ user });
  } catch (err: any) {
    console.error("GET /api/users/me error:", err.message);
    res.status(500).json({ error: "Failed to get user" });
  }
});

// ── Update profile ──
router.patch("/me", authMiddleware, async (req: Request, res: Response) => {
  try {
    const u = req.user!.dbUser;
    const { full_name, phone, profile_photo_url } = req.body;

    const updated = await queryOne<User>(
      `UPDATE users
       SET full_name = COALESCE($1, full_name),
           phone = COALESCE($2, phone),
           profile_photo_url = COALESCE($3, profile_photo_url),
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [full_name ?? null, phone ?? null, profile_photo_url ?? null, u.id]
    );

    res.json({ user: updated });
  } catch (err: any) {
    console.error("PATCH /api/users/me error:", err.message);
    res.status(500).json({ error: "Failed to update user" });
  }
});

export default router;

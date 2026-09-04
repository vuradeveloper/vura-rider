"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const database_1 = require("../config/database");
const AffiliateService_1 = require("../services/AffiliateService");
const router = (0, express_1.Router)();
// POST /api/users/sync — Create or update user from Firebase auth
router.post("/sync", auth_1.requireAuth, async (req, res) => {
    try {
        const { role, phone, full_name, referralCode } = req.body;
        const firebaseUid = req.userId;
        const existing = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (existing) {
            const updates = [];
            const params = [];
            let idx = 1;
            if (role) {
                updates.push(`role = $${idx}`);
                params.push(role);
                idx++;
            }
            if (phone) {
                updates.push(`phone = $${idx}`);
                params.push(phone);
                idx++;
            }
            if (full_name) {
                updates.push(`full_name = $${idx}`);
                params.push(full_name);
                idx++;
            }
            if (req.user?.email) {
                updates.push(`email = $${idx}`);
                params.push(req.user.email);
                idx++;
            }
            updates.push(`updated_at = NOW()`);
            if (updates.length > 0) {
                params.push(firebaseUid);
                await (0, database_1.execute)(`UPDATE users SET ${updates.join(", ")} WHERE firebase_uid = $${idx}`, params);
            }
            const user = await (0, database_1.queryOne)("SELECT id, firebase_uid, full_name, email, phone, role, profile_photo_url, id_number, id_document_name, license_document_name, created_at FROM users WHERE firebase_uid = $1", [firebaseUid]);
            res.json({ user });
        }
        else {
            const user = await (0, database_1.queryOne)(`INSERT INTO users (firebase_uid, full_name, email, phone, role, profile_photo_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, firebase_uid, full_name, email, phone, role, profile_photo_url, id_number, id_document_name, license_document_name, created_at`, [firebaseUid, full_name || req.user?.name || "Rider", req.user?.email || null, phone || null, role || "passenger", req.user?.picture || null]);
            if (user?.id && referralCode) {
                try {
                    await (0, AffiliateService_1.ensureAffiliateTables)();
                    await (0, AffiliateService_1.claimReferral)(user.id, String(referralCode));
                }
                catch (err) {
                    console.warn("Referral claim skipped:", err.message);
                }
            }
            res.status(201).json({ user });
        }
    }
    catch (err) {
        console.error("User sync error:", err);
        res.status(500).json({ error: err.message || "Failed to sync user" });
    }
});
// PUT /api/users/profile — Update user profile
router.put("/profile", auth_1.requireAuth, async (req, res) => {
    try {
        const { full_name, email, phone } = req.body;
        const firebaseUid = req.userId;
        const updates = [];
        const params = [];
        let idx = 1;
        if (full_name !== undefined) {
            updates.push(`full_name = $${idx}`);
            params.push(full_name);
            idx++;
        }
        if (email !== undefined) {
            updates.push(`email = $${idx}`);
            params.push(email);
            idx++;
        }
        if (phone !== undefined) {
            updates.push(`phone = $${idx}`);
            params.push(phone);
            idx++;
        }
        updates.push(`updated_at = NOW()`);
        params.push(firebaseUid);
        await (0, database_1.execute)(`UPDATE users SET ${updates.join(", ")} WHERE firebase_uid = $${idx}`, params);
        const updated = await (0, database_1.queryOne)("SELECT id, firebase_uid, full_name, email, phone, role, profile_photo_url, id_number, id_document_name, license_document_name FROM users WHERE firebase_uid = $1", [firebaseUid]);
        res.json({ user: updated });
    }
    catch (err) {
        console.error("Profile update error:", err);
        res.status(500).json({ error: err.message || "Failed to update profile" });
    }
});
// POST /api/users/photo — Upload profile photo
router.post("/photo", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const { photo } = req.body;
        if (!photo) {
            res.status(400).json({ error: "No photo provided" });
            return;
        }
        await (0, database_1.execute)("UPDATE users SET profile_photo_url = $1, updated_at = NOW() WHERE firebase_uid = $2", [photo, firebaseUid]);
        res.json({ photoURL: photo });
    }
    catch (err) {
        console.error("Photo upload error:", err);
        res.status(500).json({ error: err.message || "Failed to upload photo" });
    }
});
// POST /api/users/delete — Delete user account
router.post("/delete", auth_1.requireAuth, async (req, res) => {
    try {
        const firebaseUid = req.userId;
        const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
        if (user) {
            await (0, database_1.execute)("DELETE FROM rides WHERE passenger_id = $1 OR driver_id = $1", [user.id]);
            await (0, database_1.execute)("DELETE FROM driver_profiles WHERE user_id = $1", [user.id]);
            await (0, database_1.execute)("DELETE FROM driver_earnings WHERE driver_id = $1", [user.id]);
            await (0, database_1.execute)("DELETE FROM chat_messages WHERE sender_id = $1", [user.id]);
            await (0, database_1.execute)("DELETE FROM ratings WHERE passenger_id = $1 OR driver_id = $1", [user.id]);
            await (0, database_1.execute)("DELETE FROM users WHERE id = $1", [user.id]);
        }
        res.json({ success: true });
    }
    catch (err) {
        console.error("Account deletion error:", err);
        res.status(500).json({ error: err.message || "Failed to delete account" });
    }
});
exports.default = router;
//# sourceMappingURL=users.js.map
"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// Unified push sender.
//
// WHY THIS EXISTS: the old path (services/push.ts) only ever sent to
// ExponentPushToken[...] — the legacy Expo app mints those, but a Capacitor APK
// can never mint one. The figma-ui apps (the ones actually being shipped) have no
// push plugin installed and no token registered, so a backgrounded or closed app
// received NOTHING: no socket, no notification. That is the "driver never gets the
// ride" bug as soon as the app is not in the foreground.
//
// This module adds the native path:
//   device_tokens (FCM registration tokens, one row per device, is_active flag)
//     -> firebase-admin messaging: Android priority HIGH + a dedicated
//        high-importance channel (full-screen intent is declared by the app),
//        iOS alert + sound + interruption-level "time-sensitive".
//   push_tokens (unchanged) -> Expo, for the legacy React Native app.
//
// Payload rule (dispatch spec): data carries IDs ONLY (ride_id, offer_id, type).
// The app fetches the real trip from the server after tapping, so a notification
// can never show stale trip data.
//
// Every send is recorded in notifications_log (product-facing) and push_sends
// (the plumbing log that predates it).
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.OFFER_CHANNEL_ID = void 0;
exports.sendPushToUsers = sendPushToUsers;
exports.sendPushToUser = sendPushToUser;
const firebase_1 = require("../config/firebase");
const database_1 = require("../config/database");
const push_1 = require("./push");
exports.OFFER_CHANNEL_ID = "vura_ride_offers";
// Tokens FCM reports as unusable — flip is_active so we stop retrying them.
const DEAD_TOKEN_CODES = new Set([
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
    "messaging/invalid-argument",
    "messaging/mismatched-credential",
]);
async function logNotification(userId, type, rideId, title, body, deliveryStatus, error, provider) {
    try {
        await (0, database_1.execute)(`INSERT INTO notifications_log (user_id, type, ride_id, title, body, sent_at, delivery_status, error, provider)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)`, [userId, type, rideId, title, body, deliveryStatus, error, provider]);
    }
    catch (err) {
        console.warn("[notify] notifications_log write failed:", err?.message);
    }
}
async function logPushSend(userId, reference, result, detail) {
    try {
        await (0, database_1.execute)(`INSERT INTO push_sends (user_id, reference, result, detail) VALUES ($1, $2, $3, $4)`, [userId, reference, result, detail ?? null]);
    }
    catch {
        /* plumbing log only */
    }
}
/**
 * Send one notification to every device of the given user ids.
 *
 * Both transports run: FCM (native/Capacitor apps) and Expo (legacy RN app), so a
 * user signed into either build is reachable. Never throws — a push failure must
 * not break a ride.
 */
async function sendPushToUsers(userIds, msg) {
    const ids = (userIds || []).filter(Boolean);
    if (ids.length === 0)
        return 0;
    const data = {
        type: String(msg.type),
        ...(msg.rideId ? { ride_id: String(msg.rideId) } : {}),
        ...(msg.offerId ? { offer_id: String(msg.offerId) } : {}),
        ...(msg.data || {}),
    };
    let sent = 0;
    let error = null;
    try {
        // ── 1. Native (FCM) ──────────────────────────────────────────────────────
        const users = await (0, database_1.query)(`SELECT id, firebase_uid FROM users WHERE id = ANY($1::uuid[])`, [ids]).catch(() => []);
        const tokens = await (0, database_1.query)(`SELECT id, user_id, push_token, platform FROM device_tokens
        WHERE user_id = ANY($1::uuid[]) AND is_active = TRUE`, [ids]).catch(() => []);
        if (tokens.length > 0) {
            const app = (0, firebase_1.getFirebaseApp)();
            const res = await app.messaging().sendEachForMulticast({
                tokens: tokens.map((t) => t.push_token),
                notification: { title: msg.title, body: msg.body },
                data,
                android: {
                    priority: msg.highPriority ? "high" : "normal",
                    ttl: 60_000,
                    notification: {
                        channelId: msg.channelId || (msg.highPriority ? exports.OFFER_CHANNEL_ID : "default"),
                        sound: "default",
                    },
                },
                apns: {
                    headers: {
                        "apns-priority": msg.highPriority ? "10" : "5",
                        "apns-push-type": "alert",
                    },
                    payload: {
                        aps: {
                            sound: "default",
                            "interruption-level": msg.highPriority ? "time-sensitive" : "active",
                        },
                    },
                },
            });
            sent += res.successCount;
            const dead = [];
            res.responses.forEach((r, i) => {
                const code = r.error?.code;
                if (!r.success && code && DEAD_TOKEN_CODES.has(code))
                    dead.push(tokens[i].push_token);
            });
            if (dead.length > 0) {
                await (0, database_1.execute)(`UPDATE device_tokens SET is_active = FALSE, invalidated_at = NOW()
            WHERE push_token = ANY($1::text[])`, [dead]).catch(() => undefined);
            }
            if (res.failureCount > 0)
                error = `${res.failureCount}/${tokens.length} FCM failures`;
        }
        // ── 2. Expo (legacy RN app) ──────────────────────────────────────────────
        for (const u of users) {
            if (!u.firebase_uid)
                continue;
            const n = await (0, push_1.sendPushToUser)(u.firebase_uid, {
                title: msg.title,
                body: msg.body,
                data: { ...data, rideId: msg.rideId ?? undefined },
            }).catch(() => 0);
            sent += n;
        }
        await logNotification(ids[0], String(msg.type), msg.rideId ?? null, msg.title, msg.body, sent > 0 ? (error ? "partial" : "sent") : "skipped", error, tokens.length > 0 ? "fcm" : "expo");
        await logPushSend(ids[0], msg.rideId ?? "", sent > 0 ? "sent" : "none", error ?? `${sent} device(s)`);
    }
    catch (err) {
        error = err?.message || String(err);
        console.warn("[notify] push failed:", error);
        await logNotification(ids[0], String(msg.type), msg.rideId ?? null, msg.title, msg.body, "error", error, "fcm");
    }
    return sent;
}
/** Convenience: one user (driver offer, rider milestones). */
function sendPushToUser(userId, msg) {
    return sendPushToUsers([userId], msg);
}
//# sourceMappingURL=notify.js.map
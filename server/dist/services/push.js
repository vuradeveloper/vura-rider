"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// Expo push notification sender.
//
// Reads push_tokens (registered by the apps via POST /api/notifications/register)
// and sends Expo push notifications through the Expo Push API. Uses a blocking
// HTTP call (the apps' tokens are Expo push tokens, not FCM), so no extra SDK
// dependency is required — the Expo push endpoint accepts a JSON payload.
//
// NOTE: In mock/local dev with no real Expo tokens this is a no-op.
// ─────────────────────────────────────────────────────────────────────────────
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.isExpoPushToken = isExpoPushToken;
exports.sendPushToUser = sendPushToUser;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
function isExpoPushToken(token) {
    return /^ExponentPushToken\[[a-zA-Z0-9-]+\]$/.test(token.trim());
}
/**
 * Records a push in the push_tokens/notifications tables so we can trace sends.
 * Best-effort — never should block a ride event.
 */
async function logPush(reference, userId, result, detail) {
    try {
        const { execute } = await Promise.resolve().then(() => __importStar(require("../config/database")));
        await execute(`CREATE TABLE IF NOT EXISTS push_sends (
         id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
         user_id VARCHAR(255),
         reference VARCHAR(100),
         result VARCHAR(20),
         detail TEXT,
         created_at TIMESTAMPTZ DEFAULT NOW()
       )`).catch(() => undefined);
        await execute(`INSERT INTO push_sends (user_id, reference, result, detail)
       VALUES ($1, $2, $3, $4)`, [userId, reference, result, detail ?? null]).catch((err) => console.warn("Push log error:", err.message));
    }
    catch {
        /* ignore */
    }
}
/**
 * Sends an Expo push notification to every registered device token for the
 * given firebase user id. Uses a blocking fetch in this request cycle (safe for
 * low-volume ride events). Returns the number of messages dispatched.
 */
async function sendPushToUser(firebaseUid, notification) {
    let dispatched = 0;
    try {
        const { query } = await Promise.resolve().then(() => __importStar(require("../config/database")));
        const tokens = await query("SELECT token FROM push_tokens WHERE user_id = $1", [firebaseUid]).catch(() => []);
        const validTokens = (tokens || [])
            .map((t) => t.token)
            .filter((t) => t && isExpoPushToken(t));
        if (validTokens.length === 0) {
            await logPush(notification.data?.ride_id ?? "", firebaseUid, "none");
            return 0;
        }
        const messages = validTokens.map((token) => ({
            to: token,
            sound: "default",
            title: notification.title,
            body: notification.body,
            data: notification.data || {},
        }));
        const res = await fetch(EXPO_PUSH_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(messages),
        });
        const json = (await res.json().catch(() => ({})));
        const errors = (json?.data || []).filter((m) => m && m.status === "error");
        if (res.ok && errors.length === 0) {
            dispatched = validTokens.length;
            await logPush(notification.data?.ride_id ?? "", firebaseUid, "sent");
        }
        else if (errors.length > 0) {
            // Some tokens are stale (device uninstalled). Prune them so future sends
            // stop failing. Best-effort.
            const { execute } = await Promise.resolve().then(() => __importStar(require("../config/database")));
            for (const err of errors) {
                const badToken = err?.details?.error ?? "";
                if (badToken && validTokens.includes(badToken)) {
                    await execute("DELETE FROM push_tokens WHERE user_id = $1 AND token = $2", [firebaseUid, badToken]).catch(() => undefined);
                }
            }
            dispatched = validTokens.length - errors.length;
            await logPush(notification.data?.ride_id ?? "", firebaseUid, "sent", `${errors.length} stale`);
        }
    }
    catch (err) {
        console.warn("Push send error:", err?.message);
        await logPush(notification.data?.ride_id ?? "", firebaseUid, "error", err?.message);
    }
    return dispatched;
}
//# sourceMappingURL=push.js.map
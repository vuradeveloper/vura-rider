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

import { getFirebaseApp } from "../config/firebase";
import { query, execute } from "../config/database";
import { sendPushToUser as sendExpoPush } from "./push";

export type PushType =
  | "ride_offer"
  | "ride_accepted"
  | "driver_arrived"
  | "trip_started"
  | "trip_completed"
  | "no_drivers"
  | "ride_cancelled"
  | "offer_expired"
  | "test"
  | (string & {});

export interface RidePush {
  type: PushType;
  title: string;
  body: string;
  rideId?: string | null;
  offerId?: string | null;
  /** Android: FCM priority high + notification channel (wakes a locked phone). */
  highPriority?: boolean;
  /** Android channel id; the driver app creates vura_ride_offers as IMPORTANCE_HIGH. */
  channelId?: string;
  data?: Record<string, string>;
}

export const OFFER_CHANNEL_ID = "vura_ride_offers";

// Tokens FCM reports as unusable — flip is_active so we stop retrying them.
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
  "messaging/mismatched-credential",
]);

async function logNotification(
  userId: string | null,
  type: string,
  rideId: string | null,
  title: string,
  body: string,
  deliveryStatus: "sent" | "partial" | "skipped" | "error",
  error: string | null,
  provider: string
): Promise<void> {
  try {
    await execute(
      `INSERT INTO notifications_log (user_id, type, ride_id, title, body, sent_at, delivery_status, error, provider)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)`,
      [userId, type, rideId, title, body, deliveryStatus, error, provider]
    );
  } catch (err: any) {
    console.warn("[notify] notifications_log write failed:", err?.message);
  }
}

async function logPushSend(userId: string, reference: string, result: string, detail?: string) {
  try {
    await execute(
      `INSERT INTO push_sends (user_id, reference, result, detail) VALUES ($1, $2, $3, $4)`,
      [userId, reference, result, detail ?? null]
    );
  } catch {
    /* plumbing log only */
  }
}

/**
 * Send one notification to every device of the given user ids.
 *
 * Both transports run: FCM (native/Capacitor apps) and Expo (legacy RN app), so a
 * user signed into either build is reachable. Never throws — a push failure must
 * not break a ride.
 *
 * HONEST RETURN CONTRACT (offer-dispatch skip safety depends on it):
 *  - `N > 0`  — PROVEN: N device(s) accepted the push.
 *  - `0`      — PROVEN nothing exists/accepted: the token lookups succeeded and
 *               every reachable transport answered "0 delivered". An empty
 *               token set is exactly this case, and dispatch is allowed to
 *               skip an undeliverable offer on it.
 *  - `null`   — UNKNOWN: a lookup or transport failed so the answer cannot be
 *               trusted. Callers must never coerce this to 0 — a ride offer
 *               may only be skipped on a PROVEN 0.
 */
export async function sendPushToUsers(userIds: string[], msg: RidePush): Promise<number | null> {
  const ids = (userIds || []).filter(Boolean);
  if (ids.length === 0) return 0;

  const data: Record<string, string> = {
    type: String(msg.type),
    ...(msg.rideId ? { ride_id: String(msg.rideId) } : {}),
    ...(msg.offerId ? { offer_id: String(msg.offerId) } : {}),
    ...(msg.data || {}),
  };

  let sent = 0;
  let unknown = false;
  let error: string | null = null;

  try {
    // ── 1. Native (FCM) ──────────────────────────────────────────────────────
    // No .catch(() => []): a FAILED lookup must surface as null (unknown), not
    // masquerade as a proven "this user has no tokens" zero.
    const users = await query<{ id: string; firebase_uid: string | null }>(
      `SELECT id, firebase_uid FROM users WHERE id = ANY($1::uuid[])`,
      [ids]
    );

    const tokens = await query<{ id: string; user_id: string; push_token: string; platform: string }>(
      `SELECT id, user_id, push_token, platform FROM device_tokens
        WHERE user_id = ANY($1::uuid[]) AND is_active = TRUE`,
      [ids]
    );

    if (tokens.length > 0) {
      const app = getFirebaseApp();
      const res = await app.messaging().sendEachForMulticast({
        tokens: tokens.map((t) => t.push_token),
        notification: { title: msg.title, body: msg.body },
        data,
        android: {
          priority: msg.highPriority ? "high" : "normal",
          ttl: 60_000,
          notification: {
            channelId: msg.channelId || (msg.highPriority ? OFFER_CHANNEL_ID : "default"),
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
      const dead: string[] = [];
      res.responses.forEach((r, i) => {
        const code = (r.error as any)?.code as string | undefined;
        if (!r.success && code && DEAD_TOKEN_CODES.has(code)) dead.push(tokens[i].push_token);
      });
      if (dead.length > 0) {
        await execute(
          `UPDATE device_tokens SET is_active = FALSE, invalidated_at = NOW()
            WHERE push_token = ANY($1::text[])`,
          [dead]
        ).catch(() => undefined);
      }
      if (res.failureCount > 0) error = `${res.failureCount}/${tokens.length} FCM failures`;
    }

    // ── 2. Expo (legacy RN app) ──────────────────────────────────────────────
    // Only for users WITHOUT an active FCM token: both transports running for
    // the same user delivered a double notification (and made the `provider`
    // label meaningless). The native path owns anyone with a live token row.
    const fcmUserIds = new Set(tokens.map((t) => t.user_id));
    for (const u of users) {
      if (!u.firebase_uid) continue;
      if (fcmUserIds.has(u.id)) continue;
      const n = await sendExpoPush(u.firebase_uid, {
        title: msg.title,
        body: msg.body,
        data: { ...data, rideId: msg.rideId ?? undefined },
      }).catch((err) => {
        // Transport-level failure: this half of the answer is UNKNOWN.
        unknown = true;
        error = err?.message || String(err);
        return 0;
      });
      sent += n;
    }

    // Provider = the transport that ACTUALLY spoke for the logged user
    // (ids[0]): FCM only if that user had an active token row, Expo only if
    // the Expo leg actually ran for them, "none" otherwise. The old label
    // ("any FCM token in the batch?") lied whenever both/neither applied.
    const fcmForFirst = tokens.some((t) => t.user_id === ids[0]);
    const expoForFirst =
      !fcmForFirst && users.some((u) => u.id === ids[0] && !!u.firebase_uid);
    const provider = fcmForFirst ? "fcm" : expoForFirst ? "expo" : "none";

    // Logging must never flip a proven answer (or a proven zero) into unknown,
    // so both sinks are fire-and-forget here.
    await logNotification(
      ids[0],
      String(msg.type),
      msg.rideId ?? null,
      msg.title,
      msg.body,
      sent > 0 ? (error ? "partial" : "sent") : "skipped",
      error,
      provider
    ).catch(() => undefined);
    await logPushSend(
      ids[0],
      msg.rideId ?? "",
      sent > 0 ? "sent" : "none",
      error ?? `${sent} device(s)`
    ).catch(() => undefined);
  } catch (err: any) {
    // A lookup or the FCM transport failed before any proof arrived: UNKNOWN.
    unknown = true;
    error = err?.message || String(err);
    console.warn("[notify] push failed:", error);
    await logNotification(
      ids[0],
      String(msg.type),
      msg.rideId ?? null,
      msg.title,
      msg.body,
      "error",
      error,
      "unknown"
    ).catch(() => undefined);
  }

  if (sent > 0) return sent;
  return unknown ? null : 0;
}

/** Convenience: one user (driver offer, rider milestones). */
export function sendPushToUser(userId: string, msg: RidePush): Promise<number | null> {
  return sendPushToUsers([userId], msg);
}

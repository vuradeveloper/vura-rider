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

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export interface PushNotification {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export function isExpoPushToken(token: string): boolean {
  return /^ExponentPushToken\[[a-zA-Z0-9-]+\]$/.test(token.trim());
}

/**
 * Records a push in the push_tokens/notifications tables so we can trace sends.
 * Best-effort — never should block a ride event.
 */
async function logPush(
  reference: string,
  userId: string,
  result: "sent" | "none" | "error",
  detail?: string
): Promise<void> {
  try {
    const { execute } = await import("../config/database");
    await execute(
      `CREATE TABLE IF NOT EXISTS push_sends (
         id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
         user_id VARCHAR(255),
         reference VARCHAR(100),
         result VARCHAR(20),
         detail TEXT,
         created_at TIMESTAMPTZ DEFAULT NOW()
       )`
    ).catch(() => undefined);
    await execute(
      `INSERT INTO push_sends (user_id, reference, result, detail)
       VALUES ($1, $2, $3, $4)`,
      [userId, reference, result, detail ?? null]
    ).catch((err) => console.warn("Push log error:", err.message));
  } catch {
    /* ignore */
  }
}

/**
 * Sends an Expo push notification to every registered device token for the
 * given firebase user id. Uses a blocking fetch in this request cycle (safe for
 * low-volume ride events). Returns the number of messages dispatched.
 */
export async function sendPushToUser(
  firebaseUid: string,
  notification: PushNotification
): Promise<number> {
  let dispatched = 0;
  try {
    const { query } = await import("../config/database");
    const tokens = await query<{ token: string }>(
      "SELECT token FROM push_tokens WHERE user_id = $1",
      [firebaseUid]
    ).catch(() => []);

    const validTokens = (tokens || [])
      .map((t) => t.token)
      .filter((t) => t && isExpoPushToken(t));

    if (validTokens.length === 0) {
      await logPush(notification.data?.ride_id as string ?? "", firebaseUid, "none");
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

    const json = (await res.json().catch(() => ({}))) as any;
    const errors = (json?.data || []).filter((m: any) => m && m.status === "error");

    if (res.ok && errors.length === 0) {
      dispatched = validTokens.length;
      await logPush(notification.data?.ride_id as string ?? "", firebaseUid, "sent");
    } else if (errors.length > 0) {
      // Some tokens are stale (device uninstalled). Prune them so future sends
      // stop failing. Best-effort.
      const { execute } = await import("../config/database");
      for (const err of errors) {
        const badToken = err?.details?.error ?? "";
        if (badToken && validTokens.includes(badToken)) {
          await execute(
            "DELETE FROM push_tokens WHERE user_id = $1 AND token = $2",
            [firebaseUid, badToken]
          ).catch(() => undefined);
        }
      }
      dispatched = validTokens.length - errors.length;
      await logPush(notification.data?.ride_id as string ?? "", firebaseUid, "sent", `${errors.length} stale`);
    }
  } catch (err: any) {
    console.warn("Push send error:", err?.message);
    await logPush(notification.data?.ride_id as string ?? "", firebaseUid, "error", err?.message);
  }
  return dispatched;
}
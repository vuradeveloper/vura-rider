export type PushType = "ride_offer" | "ride_accepted" | "driver_arrived" | "trip_started" | "trip_completed" | "no_drivers" | "ride_cancelled" | "offer_expired" | "test" | (string & {});
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
export declare const OFFER_CHANNEL_ID = "vura_ride_offers";
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
export declare function sendPushToUsers(userIds: string[], msg: RidePush): Promise<number | null>;
/** Convenience: one user (driver offer, rider milestones). */
export declare function sendPushToUser(userId: string, msg: RidePush): Promise<number | null>;
//# sourceMappingURL=notify.d.ts.map
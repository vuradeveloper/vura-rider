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
 */
export declare function sendPushToUsers(userIds: string[], msg: RidePush): Promise<number>;
/** Convenience: one user (driver offer, rider milestones). */
export declare function sendPushToUser(userId: string, msg: RidePush): Promise<number>;
//# sourceMappingURL=notify.d.ts.map
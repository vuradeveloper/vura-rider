export interface PushNotification {
    title: string;
    body: string;
    data?: Record<string, unknown>;
}
export declare function isExpoPushToken(token: string): boolean;
/**
 * Sends an Expo push notification to every registered device token for the
 * given firebase user id. Uses a blocking fetch in this request cycle (safe for
 * low-volume ride events). Returns the number of messages dispatched.
 */
export declare function sendPushToUser(firebaseUid: string, notification: PushNotification): Promise<number>;
//# sourceMappingURL=push.d.ts.map
export interface SosInput {
    rideId?: string | null;
    byUserId: string;
    byRole: "rider" | "driver";
    /** Optional fresh fix from the phone's own GPS (better than last ping). */
    location?: {
        lat: number;
        lng: number;
    } | null;
}
export interface SosResult {
    id: string;
    message: string;
    ride_id: string | null;
    share_url: string | null;
    contacts_notified: number;
    safety_team_notified: boolean;
    duplicate: boolean;
}
export declare function publicBaseUrl(): string;
/** Reuse the ride's existing live-trip token, or mint one for this SOS. */
export declare function ensureShareToken(rideId: string): Promise<string | null>;
export declare function triggerSos(input: SosInput): Promise<SosResult>;
//# sourceMappingURL=sosService.d.ts.map
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
}
export declare function triggerSos(input: SosInput): Promise<SosResult>;
//# sourceMappingURL=sosService.d.ts.map
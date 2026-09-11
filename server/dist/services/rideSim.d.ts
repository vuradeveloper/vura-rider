/** The driver app just reported a live position for this ride — sim should back off. */
export declare function markDriverLivePing(rideId: string): void;
/**
 * Snap the sim cursor to the driver's live position (nearest route vertex). Called
 * on every live ping so the sim resumes exactly where the driver left off when the
 * app goes quiet. No-op if the route isn't known or the position is off-route.
 */
export declare function syncSimToDriver(rideId: string, lat: number, lng: number): void;
/** Stop the sim for a ride immediately (ride completed/cancelled/expired). */
export declare function stopServerRideSim(rideId: string): void;
export declare function startServerRideSim(rideId: string, route: {
    latitude: number;
    longitude: number;
}[]): void;
//# sourceMappingURL=rideSim.d.ts.map
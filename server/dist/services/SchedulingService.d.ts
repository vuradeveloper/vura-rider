import type { Server as SocketIOServer } from "socket.io";
export declare function processDueScheduledRides(io: SocketIOServer): Promise<number>;
export declare function startScheduler(io: SocketIOServer): NodeJS.Timeout;
export declare function stopScheduler(): void;
/**
 * A reserved ride activates 15 minutes before pickup: only then does it become
 * an active trip and the driver go on_trip. Before that the driver stays
 * available for normal rides. If the driver is offline or already on a trip,
 * releaseOfflineReservations() returns the ride to matching instead.
 */
export declare function activateDueReservations(io: SocketIOServer): Promise<number>;
/** Reminds the assigned driver once, ~REMINDER_MINUTES before pickup. */
export declare function remindAssignedDrivers(io: SocketIOServer): Promise<number>;
/**
 * Releases a reservation back to 'searching' when its pre-accepted driver is
 * still offline within RELEASE_MINUTES of pickup, then notifies the rider.
 * Uses an atomic UPDATE ... WHERE status='accepted' so it can never fire twice.
 */
export declare function releaseOfflineReservations(io: SocketIOServer): Promise<number>;
//# sourceMappingURL=SchedulingService.d.ts.map
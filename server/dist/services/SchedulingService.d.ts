import type { Server as SocketIOServer } from "socket.io";
export declare function processDueScheduledRides(io: SocketIOServer): Promise<number>;
export declare function startScheduler(io: SocketIOServer): NodeJS.Timeout;
export declare function stopScheduler(): void;
/** Reminds the assigned driver once, ~REMINDER_MINUTES before pickup. */
export declare function remindAssignedDrivers(io: SocketIOServer): Promise<number>;
/**
 * Releases a reservation back to 'searching' when its pre-accepted driver is
 * still offline within RELEASE_MINUTES of pickup, then notifies the rider.
 * Uses an atomic UPDATE ... WHERE status='accepted' so it can never fire twice.
 */
export declare function releaseOfflineReservations(io: SocketIOServer): Promise<number>;
//# sourceMappingURL=SchedulingService.d.ts.map
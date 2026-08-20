import type { Server as SocketIOServer } from "socket.io";
export declare function processDueScheduledRides(io: SocketIOServer): Promise<number>;
export declare function startScheduler(io: SocketIOServer): NodeJS.Timeout;
export declare function stopScheduler(): void;
//# sourceMappingURL=SchedulingService.d.ts.map
import type { Server as SocketIOServer } from "socket.io";
/** Send the prompt for a fresh anomaly (skips if one is already pending). */
export declare function sendCheckin(io: SocketIOServer, rideId: string, anomalyId: string | null, type: string): Promise<void>;
export type CheckinResponse = "safe" | "sos";
/**
 * The rider's answer. 'safe' closes the anomaly; 'sos' supersedes it with a
 * full SOS alert (enriched payload) — both stop the escalation clock.
 */
export declare function respondCheckin(io: SocketIOServer, rideId: string, riderId: string, response: CheckinResponse): Promise<{
    ok: boolean;
    error?: string;
    sos?: {
        id: string;
    };
}>;
/** Deadline pass: pending check-ins nobody answered → admin alert. */
export declare function timeoutCheckins(): Promise<string[]>;
//# sourceMappingURL=checkinService.d.ts.map
/** Trip statuses the console filters on (mirrors rides.status values). */
export declare const TRIP_STATUSES: readonly ["searching", "matched", "accepted", "in_progress", "completed", "cancelled"];
export interface TripListOpts {
    status?: string;
    search?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
}
/** Searchable trip list — rider/driver names, no raw contact data (list stays POPIA-light). */
export declare function listTrips(opts: TripListOpts): Promise<{
    rows: any[];
    total: number;
}>;
/** One trip: header + dispatch timeline (ride_events) + vehicle snapshot. */
export declare function getTrip(rideId: string): Promise<any | null>;
/**
 * Live-map snapshot: online drivers (position + vehicle) and active rides.
 * Positions are the last heartbeat from driver_profiles — no new tracking.
 */
export declare function getLiveSnapshot(): Promise<{
    drivers: any[];
    rides: any[];
}>;
export interface TicketListOpts {
    status?: string;
    priority?: string;
    search?: string;
    limit?: number;
    offset?: number;
}
export declare function listTickets(opts: TicketListOpts): Promise<{
    rows: any[];
    total: number;
}>;
export declare function getTicket(id: string): Promise<any | null>;
/** Create a ticket (reference retried on the astronomically-rare collision). */
export declare function createTicket(input: {
    subject: string;
    body: string;
    priority?: string;
    rider_id?: string | null;
    driver_id?: string | null;
    rider_name?: string | null;
    rider_email?: string | null;
    rider_phone?: string | null;
    ride_id?: string | null;
}, authorEmail: string): Promise<any>;
export declare function updateTicket(id: string, patch: {
    status?: string;
    priority?: string;
    assignee_email?: string | null;
}): Promise<any | null>;
/** Append a reply (or an internal note) to the thread. */
export declare function addTicketMessage(id: string, authorEmail: string, message: string, isInternal?: boolean): Promise<void>;
/** Trip stats for the dashboard tile: counts by status over a window. */
export declare function getTripStats(days?: number): Promise<any>;
//# sourceMappingURL=adminTrips.d.ts.map
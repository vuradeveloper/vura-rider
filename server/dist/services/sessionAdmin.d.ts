export interface RevokeResult {
    total: number;
    revoked: number;
    failed: number;
}
export declare function revokeSessionsForRole(role: "passenger" | "driver"): Promise<RevokeResult>;
/**
 * Driver lock: force every available/break driver offline and tell the live
 * sockets. Drivers already `on_trip` are left alone so an active trip can be
 * finished; they simply cannot go available or accept anything new.
 */
export declare function forceAllDriversOffline(message: string): Promise<number>;
//# sourceMappingURL=sessionAdmin.d.ts.map
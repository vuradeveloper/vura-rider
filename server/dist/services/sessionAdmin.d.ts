export interface RevokeResult {
    total: number;
    revoked: number;
    failed: number;
}
export declare function revokeSessionsForRole(role: "passenger" | "driver"): Promise<RevokeResult>;
//# sourceMappingURL=sessionAdmin.d.ts.map
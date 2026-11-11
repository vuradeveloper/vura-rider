export declare class UserSecurityError extends Error {
    statusCode: number;
    code: string;
    constructor(message: string, statusCode?: number, code?: string);
}
export interface UserSecurityRow {
    user_id: string;
    secret_enc: string | null;
    enabled: boolean;
    epoch: number;
    recovery_hashes: string[] | string | null;
    failed_attempts: number;
    locked_until: string | Date | null;
    confirmed_at: string | Date | null;
    last_used_at: string | Date | null;
}
export interface SessionInput {
    deviceId: string;
    platform?: string;
    app?: string;
    appVersion?: string | null;
    deviceName?: string | null;
    ip?: string;
    /** Firebase auth_time (seconds). Proof that this is a fresh password login. */
    authTime?: number;
}
export interface UserSessionRow {
    id: string;
    device_id: string;
    platform: string | null;
    app: string | null;
    app_version: string | null;
    device_name: string | null;
    created_at: string | Date;
    last_seen_at: string | Date;
}
export declare function ensureUserSecuritySchema(): Promise<void>;
export declare function issueUserStepUpToken(uid: string, epoch: number): string;
export declare function verifyUserStepUpToken(uid: string, token: string, epoch: number): boolean;
export interface UserAuthGate {
    enabled: boolean;
    epoch: number;
    /** Unix seconds. Tokens issued before this are dead. 0 = no cutoff. */
    sessionsValidAfter: number;
}
export declare function invalidateUserSecurityCache(uid: string): void;
export declare function getUserSecurityGate(uid: string): Promise<UserAuthGate>;
/** True when this request carries a valid second-factor proof. */
export declare function twoFactorSatisfied(uid: string, header: string | undefined): Promise<boolean>;
export declare function invalidateDeviceCache(uid: string, deviceId: string): void;
export declare function isDeviceRevoked(uid: string, deviceId: string): Promise<boolean>;
export declare function logSecurityEvent(uid: string, event: string, detail?: Record<string, unknown>, ip?: string): Promise<void>;
export declare function getSecurityStatus(uid: string): Promise<{
    two_factor_enabled: boolean;
    configured: boolean;
    recovery_codes_left: number;
    locked_until: string | null;
    last_used_at: string | null;
}>;
export declare function startTwoFactorSetup(uid: string, emailHint?: string): Promise<{
    secret: string;
    otpauth_uri: string;
}>;
export declare function enableTwoFactor(uid: string, code: string): Promise<{
    recovery_codes: string[];
    token: string;
}>;
export declare function verifyTwoFactor(uid: string, code: string): Promise<{
    token: string;
    used_recovery: boolean;
}>;
export declare function disableTwoFactor(uid: string, code: string): Promise<void>;
export declare function regenerateRecoveryCodes(uid: string, code: string): Promise<{
    recovery_codes: string[];
}>;
/**
 * Support recovery: reset 2FA after the human has verified the account owner.
 * Also kills every session, so a stolen phone cannot keep using the old token.
 */
export declare function resetUserSecurity(uid: string, actor: string): Promise<{
    sessions_revoked: number;
}>;
export declare function startSession(uid: string, raw: SessionInput): Promise<{
    session: UserSessionRow;
    new_device: boolean;
}>;
export declare function heartbeatSession(uid: string, deviceId: string, appVersion?: string): Promise<void>;
export declare function listSessions(uid: string, currentDeviceId?: string): Promise<Array<UserSessionRow & {
    current: boolean;
}>>;
export declare function revokeSession(uid: string, sessionId: string, currentDeviceId?: string): Promise<{
    revoked: boolean;
    current: boolean;
    device_id: string;
}>;
export declare function revokeAllSessions(uid: string, currentDeviceId?: string | null, reason?: string): Promise<{
    revoked: number;
}>;
export declare function listSecurityActivity(uid: string, limit?: number): Promise<Array<{
    id: string;
    event: string;
    detail: any;
    created_at: string;
}>>;
//# sourceMappingURL=userSecurity.d.ts.map
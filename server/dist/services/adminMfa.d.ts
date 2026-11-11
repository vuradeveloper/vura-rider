export declare class AdminMfaError extends Error {
    statusCode: number;
    code: string;
    constructor(message: string, statusCode?: number, code?: string);
}
export interface AdminMfaRow {
    admin_uid: string;
    email: string | null;
    secret_enc: string | null;
    enabled: boolean;
    epoch: number;
    recovery_hashes: string[] | null;
    failed_attempts: number;
    locked_until: string | Date | null;
    confirmed_at: string | Date | null;
    last_used_at: string | Date | null;
}
export declare function ensureAdminMfaSchema(): Promise<void>;
export declare function generateTotpSecret(): string;
export declare function totpCode(secret: string, counter: number): string;
export declare function verifyTotp(secret: string, code: string): boolean;
export declare function otpauthUrl(email: string, secret: string): string;
export declare function issueAdminMfaToken(uid: string, epoch: number): string;
export declare function verifyAdminMfaToken(uid: string, token: string, epoch: number): boolean;
interface Gate {
    enabled: boolean;
    epoch: number;
}
export declare function invalidateAdminMfaCache(uid: string): void;
export declare function getAdminMfaGate(uid: string): Promise<Gate>;
export declare function getAdminMfaStatus(uid: string): Promise<{
    enabled: boolean;
    configured: boolean;
    locked_until: string | null;
}>;
export declare function startAdminMfaSetup(uid: string, email: string): Promise<{
    secret: string;
    otpauth_uri: string;
}>;
export declare function enableAdminMfa(uid: string, code: string): Promise<{
    recovery_codes: string[];
    token: string;
}>;
export declare function verifyAdminMfa(uid: string, code: string): Promise<{
    token: string;
}>;
export declare function disableAdminMfa(uid: string, code: string): Promise<void>;
export declare function resetAdminMfa(uid: string): Promise<void>;
/** True when the request carries a valid token for the current MFA epoch. */
export declare function adminMfaTokenValid(uid: string, token: string): Promise<boolean>;
export declare function securityKeyMaterial(): string;
export declare function sealSecret(secret: string): string;
export declare function openSecret(value: string | null): string | null;
export declare function generateRecoveryCodeSet(): {
    plain: string[];
    hashes: string[];
};
export declare function hashRecoveryCode(code: string): string;
export declare function constantTimeEqual(a: string, b: string): boolean;
export {};
//# sourceMappingURL=adminMfa.d.ts.map
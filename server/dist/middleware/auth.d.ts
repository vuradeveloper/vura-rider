import { Request, Response, NextFunction } from "express";
export interface AuthRequest extends Request {
    userId?: string;
    user?: {
        uid: string;
        email?: string;
        phone_number?: string;
        name?: string;
        picture?: string;
    };
    /** Firebase `auth_time` (seconds). Used to require a fresh password check. */
    authTime?: number;
    /** Firebase `iat` (seconds). Used for the per-user token cutoff. */
    tokenIssuedAt?: number;
    /** Stable app-generated device id, sent as X-Vura-Device. */
    deviceId?: string;
}
/**
 * Middleware: Verifies Firebase ID token from Authorization header.
 * Attaches userId and user info to the request object.
 */
export declare function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
/**
 * Optional auth: attaches user info if token is present, but doesn't block.
 */
export declare function optionalAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void>;
//# sourceMappingURL=auth.d.ts.map
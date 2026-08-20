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
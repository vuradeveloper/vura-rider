import { Request, Response, NextFunction } from "express";
import { getAuth } from "../config/firebase";

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
export async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    const token = authHeader.split("Bearer ")[1];

    if (!token) {
      res.status(401).json({ error: "Missing token" });
      return;
    }

    const decoded = await getAuth().verifyIdToken(token);

    req.userId = decoded.uid;
    req.user = {
      uid: decoded.uid,
      email: decoded.email,
      phone_number: decoded.phone_number,
      name: decoded.name,
      picture: decoded.picture,
    };

    next();
  } catch (error: any) {
    console.error("Auth verification failed:", error.code || error.message);

    if (error.code === "auth/id-token-expired") {
      res.status(401).json({ error: "Token expired. Please sign in again." });
    } else {
      res.status(401).json({ error: "Authentication failed" });
    }
  }
}

/**
 * Optional auth: attaches user info if token is present, but doesn't block.
 */
export async function optionalAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split("Bearer ")[1];
      if (token) {
        const decoded = await getAuth().verifyIdToken(token);
        req.userId = decoded.uid;
        req.user = {
          uid: decoded.uid,
          email: decoded.email,
          phone_number: decoded.phone_number,
          name: decoded.name,
          picture: decoded.picture,
        };
      }
    }
  } catch {
    // Ignore — auth is optional
  }

  next();
}
import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../config/firebase";
import { queryOne } from "../config/database";
import { User } from "../types";

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
      res.status(401).json({ error: "Missing or invalid Authorization header" });
      return;
    }

    const idToken = header.slice(7);
    const decoded = await verifyToken(idToken);

    const dbUser = await queryOne<User>(
      `SELECT * FROM users WHERE firebase_uid = $1`,
      [decoded.uid]
    );

    if (!dbUser) {
      res.status(401).json({ error: "User not found. Call POST /api/users/sync first." });
      return;
    }

    req.user = { firebase_uid: decoded.uid, dbUser };
    next();
  } catch (err: any) {
    console.error("Auth error:", err.message);
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
}

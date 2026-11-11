import { Request, Response, NextFunction } from "express";
import { getAuth } from "../config/firebase";
import { queryOne } from "../config/database";
import { readMaintenanceStatus } from "../services/featureFlags";
import {
  getUserSecurityGate,
  isDeviceRevoked,
  verifyUserStepUpToken,
} from "../services/userSecurity";

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

// The DB role is only needed while a maintenance lock / revoke epoch is in
// play. Cached briefly so a locked platform does not add one SELECT per request.
const roleCache = new Map<string, { role: string | null; at: number }>();
const ROLE_CACHE_MS = 60_000;

async function dbRoleFor(uid: string): Promise<string | null> {
  const hit = roleCache.get(uid);
  if (hit && Date.now() - hit.at < ROLE_CACHE_MS) return hit.role;
  const row = await queryOne<{ role: string | null }>(
    "SELECT role FROM users WHERE firebase_uid = $1",
    [uid]
  ).catch(() => null);
  const role = row?.role ?? null;
  roleCache.set(uid, { role, at: Date.now() });
  return role;
}

/** Firebase auth_time/iat are Unix seconds. */
function tokenAuthTime(decoded: any): number {
  const n = Number(decoded?.auth_time ?? decoded?.iat ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The backend kill switch. While a side is locked, every authenticated call
 * from that side is rejected with 401 (the apps cannot get data or book), and
 * any token issued before `revoke_before` is rejected even after unlock. The
 * Firebase sign-in call itself is client-side; this is the server-side logout.
 */
async function maintenanceBlock(decoded: any): Promise<{ code: string; message: string } | null> {
  const maint = await readMaintenanceStatus();
  const riderOn = maint.rider.enabled || Boolean(maint.rider.revokeBefore);
  const driverOn = maint.driver.enabled || Boolean(maint.driver.revokeBefore);
  if (!riderOn && !driverOn) return null;

  const role = await dbRoleFor(String(decoded.uid || ""));
  if (!role) return null; // brand-new Firebase user — /api/users/sync decides

  const side =
    role === "driver"
      ? maint.driver
      : role === "passenger" || role === "rider"
        ? maint.rider
        : null;
  if (!side) return null;

  if (side.enabled) {
    return { code: "maintenance", message: side.message };
  }
  if (side.revokeBefore) {
    const cutoff = Math.floor(new Date(side.revokeBefore).getTime() / 1000);
    if (Number.isFinite(cutoff) && tokenAuthTime(decoded) < cutoff) {
      return {
        code: "session_revoked",
        message: "Your session was ended by Vura. Please sign in again.",
      };
    }
  }
  return null;
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

    // Maintenance / forced-logout gate (rider or driver side).
    const blocked = await maintenanceBlock(decoded);
    if (blocked) {
      res.status(401).json({ error: blocked.message, code: blocked.code });
      return;
    }

    const uid = String(decoded.uid || "");
    const issuedAt = Number(decoded.iat || decoded.auth_time || 0);
    const deviceId = String(req.headers["x-vura-device"] || "").trim();

    // Per-user "sign out everywhere" cutoff. This is separate from the
    // platform-wide maintenance cutoff above: one rider signing out all of
    // their devices must not affect anybody else.
    const gate = await getUserSecurityGate(uid);
    if (gate.sessionsValidAfter && issuedAt > 0 && issuedAt < gate.sessionsValidAfter) {
      res.status(401).json({
        error: "Your session was ended. Please sign in again.",
        code: "session_revoked",
      });
      return;
    }

    // A device signed out from the device list stops working on its next call.
    // Session routes handle their own state (heartbeat must be able to REPORT
    // a revoke; start is how a fresh login re-registers).
    const path = String(req.originalUrl || req.url || "").split("?")[0];
    const isSessionRoute = path.startsWith("/api/users/sessions");
    if (deviceId && !isSessionRoute && (await isDeviceRevoked(uid, deviceId))) {
      res.status(401).json({
        error: "This device was signed out from another device. Please sign in again.",
        code: "session_revoked",
      });
      return;
    }

    // Account 2FA gate. Only the calls needed to complete the challenge (and
    // the harmless profile sync that tells the app who is signed in) pass
    // while the second factor is outstanding. Everything else is refused.
    const twoFactorExempt =
      /^\/api\/users\/sync\/?$/.test(path) ||
      /^\/api\/users\/security\/status\/?$/.test(path) ||
      /^\/api\/users\/security\/2fa\/verify\/?$/.test(path);
    if (gate.enabled && !twoFactorExempt) {
      const proof = String(req.headers["x-vura-2fa"] || "");
      if (!verifyUserStepUpToken(uid, proof, gate.epoch)) {
        res.status(403).json({
          error: "Enter the code from your authenticator app to continue.",
          code: "two_factor_required",
        });
        return;
      }
    }

    req.userId = uid;
    req.authTime = tokenAuthTime(decoded);
    req.tokenIssuedAt = issuedAt;
    req.deviceId = deviceId || undefined;
    req.user = {
      uid,
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
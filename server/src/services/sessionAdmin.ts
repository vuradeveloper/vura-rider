// ─────────────────────────────────────────────────────────────────────────────
// SERVER-SIDE LOGOUT — revoke every Firebase refresh token for one side.
//
// This is the "log everyone out" half of the admin maintenance button:
//   • requireAuth already rejects every request while the side is locked, and
//     rejects tokens issued before `revoke_before` after it is unlocked.
//   • This additionally kills the refresh tokens, so the app's silent
//     refresh cannot mint a new token. The next refresh forces a real sign-in.
//
// Best-effort: Firebase Admin may be unavailable, and a single bad uid must
// never stop the rest. Runs in small batches to stay under rate limits.
// ─────────────────────────────────────────────────────────────────────────────
import { getAuth } from "../config/firebase";
import { execute, query } from "../config/database";

export interface RevokeResult {
  total: number;
  revoked: number;
  failed: number;
}

export async function revokeSessionsForRole(
  role: "passenger" | "driver"
): Promise<RevokeResult> {
  let rows: Array<{ firebase_uid: string | null }> = [];
  try {
    rows = await query<{ firebase_uid: string | null }>(
      `SELECT firebase_uid FROM users
        WHERE role = $1 AND firebase_uid IS NOT NULL AND firebase_uid <> ''`,
      [role]
    );
  } catch (err: any) {
    console.warn(`[maintenance] could not list ${role} sessions:`, err?.message || err);
    return { total: 0, revoked: 0, failed: 0 };
  }

  let revoked = 0;
  let failed = 0;
  const BATCH = 10;
  for (let i = 0; i < rows.length; i += BATCH) {
    await Promise.all(
      rows.slice(i, i + BATCH).map(async (row) => {
        const uid = String(row.firebase_uid || "").trim();
        if (!uid) return;
        try {
          await getAuth().revokeRefreshTokens(uid);
          revoked++;
        } catch (err: any) {
          failed++;
          if (failed <= 5) {
            console.warn(
              `[maintenance] revoke failed for ${uid}:`,
              err?.code || err?.message || err
            );
          }
        }
      })
    );
  }

  console.log(
    `[maintenance] revoked ${revoked}/${rows.length} ${role} refresh tokens (${failed} failed)`
  );
  return { total: rows.length, revoked, failed };
}

/**
 * Driver lock: force every available/break driver offline and tell the live
 * sockets. Drivers already `on_trip` are left alone so an active trip can be
 * finished; they simply cannot go available or accept anything new.
 */
export async function forceAllDriversOffline(message: string): Promise<number> {
  let affected = 0;
  try {
    const res = await execute(
      `UPDATE driver_profiles
          SET is_online = FALSE, status = 'offline', updated_at = NOW()
        WHERE COALESCE(status, 'offline') IN ('available', 'break')`
    );
    affected = Number(res?.rowCount || 0);
  } catch (err: any) {
    console.warn("[maintenance] force drivers offline failed:", err?.message || err);
  }
  try {
    const io = (global as any).__vuraIo;
    if (io) io.to("drivers").emit("driver:maintenance", { message });
  } catch {
    /* sockets are best-effort */
  }
  return affected;
}

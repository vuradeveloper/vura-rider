// ─────────────────────────────────────────────────────────────────────────────
// driverPhoto — one answer to "what photo does the RIDER see next to the car".
//
// 1. users.profile_photo_url — written by POST /api/users/photo (profile save /
//    face flow).
// 2. Otherwise the driver's newest `profile_photo` / `face_scan` document in S3
//    as a short-lived presigned URL. Drivers who only ever uploaded a photo
//    through the documents flow have NOTHING in `users`, which is why the rider
//    used to see an initials circle forever.
//
// The active-ride endpoint is polled every 3s, so the answer is cached in
// memory: 10 min for a hit, 60 s for "none yet" (a fresh upload then appears
// within a minute). Any failure returns null — a missing photo must never
// break a ride payload.
// ─────────────────────────────────────────────────────────────────────────────
import { queryOne, query } from "../config/database";
import { getPresignedViewUrl } from "../lib/s3";

type Entry = { url: string | null; at: number };
const cache = new Map<string, Entry>();
const HIT_TTL_MS = 10 * 60 * 1000;
const MISS_TTL_MS = 60 * 1000;

export async function resolveDriverPhotoUrl(
  driverId: string | null | undefined,
  knownUrl?: string | null
): Promise<string | null> {
  if (!driverId) return null;
  // The caller already JOINed users.profile_photo_url — no lookup needed.
  if (knownUrl) return knownUrl;

  const hit = cache.get(driverId);
  if (hit && Date.now() - hit.at < (hit.url ? HIT_TTL_MS : MISS_TTL_MS)) return hit.url;

  let url: string | null = null;
  try {
    const user = await queryOne<{ profile_photo_url: string | null }>(
      `SELECT profile_photo_url FROM users WHERE id = $1`,
      [driverId]
    );
    if (user?.profile_photo_url) {
      url = user.profile_photo_url;
    } else {
      const doc = await query<{ s3_key: string }>(
        `SELECT s3_key FROM driver_documents
          WHERE driver_id = $1 AND doc_type IN ('profile_photo', 'face_scan')
          ORDER BY created_at DESC LIMIT 1`,
        [driverId]
      );
      if (doc[0]?.s3_key) url = await getPresignedViewUrl(doc[0].s3_key);
    }
  } catch {
    url = null; // never throw — a missing photo must not fail a ride response
  }
  cache.set(driverId, { url, at: Date.now() });
  return url;
}
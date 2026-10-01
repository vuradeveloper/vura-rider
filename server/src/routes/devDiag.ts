import { Router, Request, Response } from "express";
import { statSync } from "fs";
import { join } from "path";
import { query } from "../config/database";
import { uploadToS3, deleteFromS3 } from "../lib/s3";
import { READ_KEY } from "./devLogs";
import { carsxeUsage } from "../services/vehicleImages";

// ── Environment diagnostics ────────────────────────────────────────────────────
//   GET /api/dev/diag?key=…        what the live instance is actually running
//   GET /api/dev/diag?key=…&s3=1   also do a real S3 write + delete round trip
//
// Same read key as the device-log viewer and the dispatch inspector. No secret is
// ever returned — only presence flags, lengths and messages.
//
// Why this exists: the two worst live bugs were both invisible from outside. Driver
// earnings read R0 because users.role had been rewritten to 'passenger', and every
// vehicle photo became none_found while CarsXE cheerfully returned HTTP 200 with
// nine images. Neither could be diagnosed without reading files on an instance
// nobody could ssh into, so this endpoint turns "probably X" into "X, proven" — and
// it is the only way to confirm from a laptop that a deploy actually landed.

const router = Router();

/** Which build is actually live. Rides along with every response so a stale
 *  deploy can never be mistaken for a broken fix. */
function buildStamp(): Record<string, unknown> {
  try {
    // This file is dist/routes/devDiag.js, so the entrypoint is one level up.
    const entry = join(__dirname, "..", "index.js");
    return { entry, builtAt: statSync(entry).mtime.toISOString() };
  } catch (err: any) {
    return { error: String(err?.message || err) };
  }
}

/** sharp is imported lazily, so a wrong-platform native build stays invisible
 *  until the first image is processed — and even then it only shows up as a
 *  missing photo. Actually ENCODE something: a module that resolves is not the
 *  same as a native binary that works. */
async function probeSharp(): Promise<Record<string, unknown>> {
  try {
    const sharp = (await import("sharp")).default;
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .png()
      .toBuffer();
    return { loads: true, encodedBytes: png.length, versions: (sharp as any).versions || null };
  } catch (err: any) {
    return {
      loads: false,
      error: String(err?.message || err),
      code: err?.code ?? null,
      hint:
        "a Windows-built @img/sharp-win32-x64 cannot load on linux-x64 — the EB hook must install the platform build",
    };
  }
}

/** The strongest possible check: real bytes into the real bucket, then clean up. */
async function probeS3(): Promise<Record<string, unknown>> {
  const bucket = process.env.AWS_S3_BUCKET || "";
  if (!bucket) return { ok: false, error: "AWS_S3_BUCKET is not set" };
  const key = `diag/healthcheck-${Date.now()}.txt`;
  try {
    const up = await uploadToS3(key, Buffer.from("vura s3 healthcheck").toString("base64"), "text/plain");
    await deleteFromS3(key);
    return { ok: true, bucket: up.bucket, wroteBytes: up.size, deleted: true };
  } catch (err: any) {
    return { ok: false, bucket, key, error: String(err?.message || err), name: err?.name ?? null };
  }
}

router.get("/", async (req: Request, res: Response) => {
  if (String(req.query.key || "") !== READ_KEY) {
    res.status(401).json({ error: "bad read key" });
    return;
  }

  const wantS3 = String(req.query.s3 || "") === "1";
  const [sharpStatus, budget] = await Promise.all([
    probeSharp(),
    carsxeUsage().catch((err: any) => ({ error: String(err?.message || err) })),
  ]);

  const out: Record<string, unknown> = {
    serverTime: new Date().toISOString(),
    build: buildStamp(),
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime()),
      cwd: process.cwd(),
    },
    sharp: sharpStatus,
    carsxe: { keySet: Boolean(process.env.CARSXE_API_KEY), budget },
    storage: {
      bucket: process.env.AWS_S3_BUCKET || "MISSING",
      region: process.env.AWS_S3_REGION || "(default af-south-1)",
      staticKeysInEnv: Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
      roundTrip: wantS3 ? await probeS3() : "not run — add &s3=1",
    },
  };

  // Why each car has no photo, newest first — the same reason the review page shows,
  // readable from a terminal.
  try {
    out.recentVehicleImages = await query<any>(
      `SELECT cache_key, status, api_calls_used, attempts, last_error, last_attempt_at
         FROM vehicle_images
        ORDER BY COALESCE(last_attempt_at, created_at) DESC
        LIMIT 10`
    );
  } catch (err: any) {
    out.recentVehicleImages = { error: String(err?.message || err) };
  }

  // The role bug: an account that owns a driver_profiles row can never receive a
  // ride offer unless users.role is also 'driver', because the socket decides
  // driver-vs-passenger from that column alone. Anything where the two disagree is
  // a driver who is silently invisible to dispatch.
  try {
    out.driverRoles = await query<any>(
      `SELECT u.email, u.role, dp.is_online, dp.vehicle_make, dp.vehicle_model
         FROM users u
         JOIN driver_profiles dp ON dp.user_id = u.id
        ORDER BY u.created_at DESC
        LIMIT 20`
    );
    out.driverRoleMismatch = await query<any>(
      `SELECT u.email, u.role
         FROM users u
         JOIN driver_profiles dp ON dp.user_id = u.id
        WHERE u.role <> 'driver'
        LIMIT 20`
    );
  } catch (err: any) {
    out.driverRoles = { error: String(err?.message || err) };
  }

  // ── Why a driver is getting no rides ─────────────────────────────────────────
  // The offer query needs FOUR things true at once, and when any one of them is
  // false the driver simply never appears as a candidate: no error, no offer,
  // nothing in the app. It is the quietest failure in the whole system, so every
  // condition is reported separately instead of only the verdict. `is_candidate`
  // repeats findCandidates' predicate exactly — if this says false while the driver
  // is online with a good GPS fix, the difference between the two queries is the bug.
  try {
    out.dispatch = await query<any>(
      `SELECT u.email,
              dp.is_online,
              COALESCE(dp.status, CASE WHEN dp.is_online THEN 'available' ELSE 'offline' END) AS status,
              (dp.current_lat IS NOT NULL AND dp.current_lng IS NOT NULL) AS has_coords,
              ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(dp.last_location_at, dp.updated_at))))::int AS location_age_s,
              ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(dp.last_heartbeat_at, dp.updated_at))))::int AS heartbeat_age_s,
              (dp.is_online IS TRUE
                AND COALESCE(dp.status, CASE WHEN dp.is_online THEN 'available' ELSE 'offline' END) = 'available'
                AND dp.current_lat IS NOT NULL AND dp.current_lng IS NOT NULL
                AND GREATEST(COALESCE(dp.last_location_at, dp.updated_at),
                             COALESCE(dp.last_heartbeat_at, dp.updated_at)) > NOW() - INTERVAL '30 seconds'
              ) AS is_candidate,
              (SELECT COUNT(*) FROM rides r WHERE r.driver_id = u.id
                 AND r.status IN ('accepted','driver_arrived','in_progress')) AS active_rides
         FROM users u
         JOIN driver_profiles dp ON dp.user_id = u.id
        ORDER BY dp.updated_at DESC
        LIMIT 20`
    );
  } catch (err: any) {
    out.dispatch = { error: String(err?.message || err) };
  }

  // Rides still looking for a driver, and whether an offer is actually out. A rider
  // who is waiting with zero pending offers means dispatch never found a candidate
  // (a driver problem); a pending offer means a driver is being asked (a phone
  // problem). Those are the same symptom in the app and need opposite fixes.
  try {
    out.queue = await query<any>(
      `SELECT r.id, r.status, r.created_at, r.offer_round,
              (SELECT COUNT(*) FROM ride_offers ro
                WHERE ro.ride_id = r.id AND ro.status = 'pending' AND ro.expires_at > NOW()) AS pending_offers
         FROM rides r
        WHERE r.status IN ('searching', 'no_drivers')
        ORDER BY r.created_at DESC
        LIMIT 10`
    );
  } catch (err: any) {
    out.queue = { error: String(err?.message || err) };
  }

  res.json(out);
});

export default router;

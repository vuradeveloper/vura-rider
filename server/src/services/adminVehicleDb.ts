// ─────────────────────────────────────────────────────────────────────────────
// adminVehicleDb — ADMIN V2 Phase 7: Car DB console + vehicle photo requests.
//
// The image pipeline itself lives in services/vehicleImages (Car DB files,
// CarsXE search, S3, approval). This module adds the CONSOLE layer:
//   • a request queue: when a driver's car has no photo in the Car DB, the
//     gap is recorded here and the driver is alerted ONCE,
//   • filling a gap: upload a photo (importSeedImage) or trigger a web search,
//   • AUTO-RESOLVE: the moment an image for that cache_key is approved, every
//     open request for it resolves and the driver is pushed "photo ready" —
//     the driver does nothing; the next app load shows the image.
// ─────────────────────────────────────────────────────────────────────────────
import { query, queryOne, execute } from "../config/database";
import { sendPushToUsers } from "./notify";
import {
  approveVehicleImage,
  claimVehicleImageFetch,
  importSeedImage,
  listVehicleImages,
  refetchVehicleImage,
  rejectVehicleImage,
  RECOLOUR_PALETTE,
  recolourFromWhite,
  pythonRecolour,
} from "./vehicleImages";
import type { AdminActor } from "./adminAuth";
import { writeAudit } from "./adminAuth";
import { MAKE_MODELS } from "../data/vehicleCatalogue";
import {
  ensureVehicleRequestTable,
  recordVehicleRequestMiss,
  resolveVehicleRequests,
  vehicleImageCacheKey,
} from "./vehicleImages";

/** Idempotent — the migration creates this too; the guard covers first-boot order. */
export const ensureRequestTable = ensureVehicleRequestTable;

/**
 * Called from noteDriverVehicle's Car-DB-miss branch: queue the gap and alert
 * the driver exactly ONCE (driver_notified_at gates the push). Thin delegate —
 * the logic lives in vehicleImages next to the pipeline hooks.
 */
export const recordCarDbMiss = recordVehicleRequestMiss;

/** Console list: open (oldest first) or resolved; driver identity included. */
export async function listVehicleRequests(status = "open"): Promise<any[]> {
  await ensureRequestTable();
  return query(
    `SELECT r.*, u.full_name AS driver_name, u.email AS driver_email
       FROM admin_vehicle_requests r
       JOIN users u ON u.id = r.driver_id
      WHERE ($1 = '' OR r.status = $1)
      ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at ASC
      LIMIT 300`,
    [status]
  );
}

/** Push "photo ready" to a driver (used by both manual and auto resolution). */
async function notifyReady(driverId: string, label: string): Promise<void> {
  await sendPushToUsers([driverId], {
    type: "vehicle_image",
    title: "Your car photo is ready",
    body: `A photo for "${label}" is now live — it will show on trips automatically. Nothing else to do.`,
    highPriority: true,
  }).catch(() => null);
}

/** Manual console resolution (e.g. driver fixed their details). Audited. */
export async function resolveVehicleRequest(
  id: string,
  actor: AdminActor,
  reason?: string
): Promise<any | null> {
  await ensureRequestTable();
  const before = await queryOne<any>(
    `SELECT * FROM admin_vehicle_requests WHERE id = $1`,
    [id]
  );
  if (!before) return null;
  await execute(
    `UPDATE admin_vehicle_requests
        SET status = 'resolved', resolved_at = NOW(), updated_at = NOW()
      WHERE id = $1`,
    [id]
  );
  await writeAudit(actor, {
    action: "vehicle_request.resolve",
    entityType: "admin_vehicle_requests",
    entityId: id,
    oldValue: { status: before.status },
    newValue: { status: "resolved" },
    reason: reason ?? null,
  });
  const label = [before.make, before.model, before.year].filter(Boolean).join(" ");
  await notifyReady(before.driver_id, label || before.cache_key);
  return queryOne(`SELECT * FROM admin_vehicle_requests WHERE id = $1`, [id]);
}

/**
 * THE AUTO-PULL: when an image for cache_key becomes approved (via upload or
 * the review flow), every open request for that key resolves and its driver
 * is pushed. Thin delegate to the pipeline-side implementation.
 */
export const resolveRequestsForCacheKey = resolveVehicleRequests;

/** Admin uploads a photo for a missing car: pipeline → S3 → approved → auto-pull. */
export async function addCarDbImage(
  input: {
    make: string;
    model: string;
    year?: number | null;
    yearRange?: string | null;
    colour?: string | null;
    imageBase64: string;
    sourceNote?: string | null;
    bodyType?: string | null;
    categories?: string[] | null;
  },
  actor: AdminActor
): Promise<{ image: any; resolvedRequests: number }> {
  const seed = await importSeedImage({
    // MUST be the resolver's key format (make|model|year_range|colour) or the
    // approved image would never match the open requests it should release.
    cacheKey: vehicleImageCacheKey({
      make: input.make,
      model: input.model,
      year: input.year ?? input.yearRange ?? null,
      colour: input.colour ?? "white",
    }),
    make: input.make,
    model: input.model,
    year: input.year ?? null,
    yearRange: input.yearRange ?? null,
    colour: input.colour ?? null,
    licenceNote: input.sourceNote ?? `Uploaded by admin ${actor.email}`,
    webpBase64: input.imageBase64,
    processRaw: true,
    approve: true,
  });
  const imageId = String(seed?.row?.id ?? "");
  const cacheKey = String(seed?.row?.cache_key ?? "").toLowerCase();
  // Admin placement: body shape + booking category ride with the row and win
  // the static guess in catalogueForApi.
  if (imageId && (input.bodyType || (input.categories && input.categories.length))) {
    await execute(
      `UPDATE vehicle_images
          SET body_type = COALESCE($2, body_type),
              categories = COALESCE($3::text[], categories)
        WHERE id = $1`,
      [imageId, input.bodyType ?? null, input.categories?.length ? input.categories : null]
    );
  }
  const resolved = cacheKey && imageId ? await resolveRequestsForCacheKey(cacheKey, imageId) : 0;
  await writeAudit(actor, {
    action: "car_db.image_add",
    entityType: "vehicle_images",
    entityId: imageId || cacheKey,
    newValue: { make: input.make, model: input.model, year: input.year, colour: input.colour },
  });
  return { image: seed, resolvedRequests: resolved };
}

/** Trigger the web (CarsXE) search for a car — the worker + approval finish it. */
export async function searchCarsXe(
  v: { make: string; model: string; year?: number | null; colour?: string | null },
  actor: AdminActor
): Promise<{ queued: boolean }> {
  const queued = await claimVehicleImageFetch(v as any);
  await writeAudit(actor, {
    action: "car_db.search",
    entityType: "vehicle_images",
    newValue: { make: v.make, model: v.model, year: v.year, colour: v.colour, queued },
  });
  return { queued };
}

/** Approve a pending image (from search or upload) → resolves matching requests. */
export async function approveImage(
  id: string,
  candidateIndex: number,
  actor: AdminActor
): Promise<{ approval: any; resolvedRequests: number }> {
  const approval = await approveVehicleImage(id, candidateIndex);
  if (!approval) throw new Error("image not found");
  // approveVehicleImage resolves matching open requests itself (auto-pull).
  const resolved = Number(approval.resolvedRequests ?? 0);
  await writeAudit(actor, {
    action: "car_db.image_approve",
    entityType: "vehicle_images",
    entityId: id,
    newValue: { candidateIndex, resolvedRequests: resolved },
  });
  return { approval, resolvedRequests: resolved };
}

export async function refetchImage(id: string, actor: AdminActor): Promise<any> {
  const r = await refetchVehicleImage(id);
  await writeAudit(actor, {
    action: "car_db.image_refetch",
    entityType: "vehicle_images",
    entityId: id,
  });
  return r;
}

export async function rejectImage(id: string, actor: AdminActor): Promise<any> {
  const r = await rejectVehicleImage(id);
  await writeAudit(actor, {
    action: "car_db.image_reject",
    entityType: "vehicle_images",
    entityId: id,
  });
  return r;
}

export async function listImages(status?: string): Promise<any[]> {
  const rows = await listVehicleImages(status);
  // The apps pull photos via the PUBLIC bucket route /api/vehicle-images/<file>
  // (never the raw S3 URL) — the console uses the exact same source.
  return (rows || []).map((r: any) => ({
    ...r,
    display_url: r.storage_key
      ? `/api/vehicle-images/${String(r.storage_key).split("/").pop()}`
      : null,
  }));
}

/**
 * Clear the whole image library (console "Clear Car DB") — used right before a
 * curated re-import of the white masters + v11 colours. Audited; returns how
 * many rows were removed. Driver/rider apps fall back to silhouettes until the
 * re-import lands, so run it only as part of a refresh.
 */
export async function purgeCarDb(actor: AdminActor): Promise<{ removed: number }> {
  const before = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM vehicle_images`);
  await execute(`DELETE FROM vehicle_images`);
  const removed = before?.n ?? 0;
  await writeAudit(actor, {
    action: "car_db.purge",
    entityType: "vehicle_images",
    oldValue: { rows: removed },
    newValue: { rows: 0 },
  });
  return { removed };
}

// (recolourFromWhite + RECOLOUR_PALETTE live in services/vehicleImages — one
// engine shared by this console path and the automatic backfill worker.)

/**
 * Generate this car's missing colours from the WHITE original:
 *   • source = the uploaded file when given, else the car's existing approved
 *     WHITE row from the Car DB (zero upload needed),
 *   • one recolour per requested palette colour (default: every missing one),
 *   • each variant goes through the standard pipeline → approved → matching
 *     requests auto-resolve and drivers are pushed "photo ready".
 */
export async function generateImages(
  input: {
    make: string;
    model: string;
    year?: number | null;
    yearRange?: string | null;
    colours?: string[];
    bodyType?: string | null;
    categories?: string[] | null;
    imageBase64?: string | null;
  },
  actor: AdminActor
): Promise<{ generated: any[]; failed: any[]; source: "upload" | "car-db" }> {
  // Source: the uploaded white original, else the car's approved WHITE row.
  const baseKey = vehicleImageCacheKey({
    make: input.make,
    model: input.model,
    year: input.year ?? input.yearRange ?? null,
    colour: "white",
  });
  let raw: Buffer | null = null;
  let source: "upload" | "car-db" = "upload";
  if (input.imageBase64) {
    const b64 = input.imageBase64.includes(",") ? input.imageBase64.split(",")[1] : input.imageBase64;
    raw = Buffer.from(b64, "base64");
  } else {
    const whiteRow = await queryOne<any>(
      `SELECT storage_key FROM vehicle_images
        WHERE cache_key = $1 AND status = 'approved' AND storage_key IS NOT NULL
        LIMIT 1`,
      [baseKey]
    );
    if (whiteRow?.storage_key) {
      const { getObjectFromS3 } = await import("../lib/s3");
      raw = await getObjectFromS3(whiteRow.storage_key);
      source = "car-db";
    }
  }
  if (!raw || !raw.length) {
    const e: any = new Error(
      "No white original found: upload the white photo here first (it becomes the generate source), or add the white row to the Car DB."
    );
    e.status = 400;
    throw e;
  }

  // Default = every palette colour the car does NOT have approved yet.
  const baseNoColour = baseKey.slice(0, baseKey.lastIndexOf("|"));
  const existing = await query<{ colour: string | null }>(
    `SELECT colour FROM vehicle_images
      WHERE cache_key LIKE $1 AND status = 'approved'`,
    [`${baseNoColour}|%`]
  );
  const have = new Set(existing.map((r) => String(r.colour || "").toLowerCase()));
  const palette = (input.colours && input.colours.length ? input.colours : RECOLOUR_PALETTE)
    .map((c) => String(c).trim().toLowerCase())
    .filter((c) => c && c !== "white" && !have.has(c))
    .slice(0, 12);
  const generated: any[] = [];
  const failed: any[] = [];
  for (const colour of palette) {
    try {
      const out = (await pythonRecolour(raw, colour)) ?? (await recolourFromWhite(raw, colour));
      const seed = await importSeedImage({
        // Resolver key format (make|model|year_range|colour) — auto-pull matches on it.
        cacheKey: vehicleImageCacheKey({
          make: input.make,
          model: input.model,
          year: input.year ?? input.yearRange ?? null,
          colour,
        }),
        make: input.make,
        model: input.model,
        year: input.year ?? null,
        yearRange: input.yearRange ?? null,
        colour,
        licenceNote: `Recoloured from the white original by admin ${actor.email}`,
        webpBase64: out.toString("base64"),
        processRaw: true,
        approve: true,
      });
      generated.push({ colour, imageId: seed?.row?.id, cacheKey: seed?.row?.cache_key });
      if (seed?.row?.id && (input.bodyType || (input.categories && input.categories.length))) {
        await execute(
          `UPDATE vehicle_images
              SET body_type = COALESCE($2, body_type),
                  categories = COALESCE($3::text[], categories)
            WHERE id = $1`,
          [String(seed.row.id), input.bodyType ?? null, input.categories?.length ? input.categories : null]
        );
      }
    } catch (err: any) {
      failed.push({ colour, error: err?.message || String(err) });
    }
  }
  await writeAudit(actor, {
    action: "car_db.generate",
    entityType: "vehicle_images",
    newValue: { make: input.make, model: input.model, year: input.year, source, generated: generated.length, failed },
  });
  if (!generated.length && failed.length) {
    const e: any = new Error(failed[0].error);
    e.status = 400;
    throw e;
  }
  return { generated, failed, source };
}

/** Static catalogue (makes/models/body/years) for the console's pickers. */
export function catalogue(): { makes: Array<{ make: string; models: any[] }> } {
  return {
    makes: Object.entries(MAKE_MODELS).map(([make, models]) => ({
      make,
      models: models.map((m: any) => ({
        model: m.model,
        body: m.body,
        yearRange: m.year_range ?? m.yearRange ?? null,
        categories: m.categories ?? null,
      })),
    })),
  };
}

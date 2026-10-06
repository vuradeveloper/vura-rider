import { Router, Response } from "express";
import { AuthRequest, requireAuth } from "../middleware/auth";
import { query, queryOne, execute } from "../config/database";
import { reviveWaitingRides } from "../services/dispatch";
import { getDriverIndex } from "../services/driverIndex";
import { approvedVehicleCatalogue } from "../services/vehicleImages";
import {
  catalogueForApi,
  colourName,
  normalisePlate,
  resolveBodyType,
  resolveCategory,
} from "../data/vehicleCatalogue";
import { noteDriverVehicle } from "../services/vehicleImages";
import { classifyVehicle, primaryTier } from "../lib/tier-classifier";

const router = Router();

// GET /api/drivers/stats — Get driver statistics
router.get("/stats", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    // A driver is whoever OWNS a driver_profiles row. This is resolved through the
    // PRIMARY KEY link (driver_profiles.user_id), never through the mutable
    // users.role string.
    //
    // Why it matters: POST /api/users/sync sets role from whatever the app sends, so
    // signing into the RIDER app once with the same account rewrites role to
    // 'passenger'. The old `AND role = 'driver'` filter then returned nothing, this
    // endpoint answered 403, and the whole Earnings screen went blank for a real
    // driver who had genuinely completed paid rides.
    const user = await queryOne<{ id: string }>(
      `SELECT u.id
         FROM users u
         LEFT JOIN driver_profiles dp ON dp.user_id = u.id
        WHERE u.firebase_uid = $1
          AND (dp.user_id IS NOT NULL OR u.role = 'driver')`,
      [firebaseUid]
    );
    if (!user) { res.status(403).json({ error: "Driver profile not found" }); return; }

    const today = await queryOne(
      `SELECT COUNT(*)::int AS rides, COALESCE(SUM(actual_fare), 0)::float AS earned
       FROM rides WHERE driver_id = $1 AND status = 'completed' AND DATE(created_at) = CURRENT_DATE`,
      [user.id]
    );
    const thisMonth = await queryOne(
      `SELECT COUNT(*)::int AS rides, COALESCE(SUM(actual_fare), 0)::float AS earned
       FROM rides WHERE driver_id = $1 AND status = 'completed'
       AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)`,
      [user.id]
    );
    const allTime = await queryOne(
      `SELECT COUNT(*)::int AS rides, COALESCE(SUM(actual_fare), 0)::float AS earned
       FROM rides WHERE driver_id = $1 AND status = 'completed'`,
      [user.id]
    );
    const rating = await queryOne(
      `SELECT COALESCE(AVG(score), 0)::float AS average, COUNT(*)::int AS total
       FROM ratings WHERE driver_id = $1`,
      [user.id]
    );

    res.json({
      today: today || { rides: 0, earned: 0 },
      thisMonth: thisMonth || { rides: 0, earned: 0 },
      allTime: allTime || { rides: 0, earned: 0 },
      rating: rating || { average: 0, total: 0 },
    });
  } catch (err: any) {
    console.error("Driver stats error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/drivers/nearby — Find nearby drivers
router.get("/nearby", async (req: AuthRequest, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);
    const radius = parseFloat(req.query.radius as string) || 10;

    if (isNaN(lat) || isNaN(lng)) { res.status(400).json({ error: "Invalid coordinates" }); return; }

    const latDelta = radius / 111;
    const lngDelta = radius / (111 * Math.cos(lat * Math.PI / 180));

    const drivers = await query(
      `SELECT u.id, u.full_name, u.profile_photo_url,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, dp.license_plate,
              dp.current_lat, dp.current_lng, dp.current_heading,
              COALESCE(dp.rating_avg, 0)::float AS average_rating
       FROM driver_profiles dp
       JOIN users u ON u.id = dp.user_id
       WHERE dp.is_online = true
         AND dp.current_lat BETWEEN $1 AND $2
         AND dp.current_lng BETWEEN $3 AND $4
       LIMIT 20`,
      [lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta]
    );

    res.json({ drivers });
  } catch (err: any) {
    console.error("Nearby drivers error:", err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/drivers/profile — Update driver profile
router.patch("/profile", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const firebaseUid = req.userId!;
    const { license_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate, vehicle_type, vehicle_vin, odometer_km, carscan_report_name, vehicle_body_type, vehicle_fuel_type, vehicle_doors, vehicle_seats, vehicle_derivative } = req.body;

    // NORMALISE the car on the way in: plate uppercase without spaces, colour stored
    // as a palette NAME, and the body type + category DERIVED from make + model (a
    // driver — or a client — can never choose the shape of a catalogued car).
    const plate = license_plate !== undefined ? normalisePlate(license_plate) : undefined;
    const colour = vehicle_color !== undefined ? colourName(vehicle_color) : undefined;
    const derivedBody =
      vehicle_make !== undefined || vehicle_model !== undefined || vehicle_body_type !== undefined
        ? resolveBodyType(vehicle_make, vehicle_model, vehicle_body_type)
        : undefined;
    const derivedCategory = derivedBody
      ? resolveCategory(vehicle_make, vehicle_model, derivedBody)
      : undefined;

    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    // Ensure the newer vehicle columns exist (safe on every call).
    await execute(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR(50)`).catch(() => {});
    await execute(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_vin VARCHAR(50)`).catch(() => {});
    await execute(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS odometer_km INTEGER`).catch(() => {});
    await execute(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS carscan_report_name VARCHAR(255)`).catch(() => {});
    // the vehicle-tier columns the driver app now fills in (additive, self-healing)
    await execute(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_body_type VARCHAR(30)`).catch(() => {});
    await execute(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_fuel_type VARCHAR(20)`).catch(() => {});
    await execute(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_doors INTEGER`).catch(() => {});
    await execute(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_seats INTEGER`).catch(() => {});
    await execute(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_derivative VARCHAR(100)`).catch(() => {});
    await execute(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_tier VARCHAR(20)`).catch(() => {});
    await execute(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_tiers JSONB DEFAULT '[]'::jsonb`).catch(() => {});

    const existing = await queryOne("SELECT id FROM driver_profiles WHERE user_id = $1", [user.id]);

    if (existing) {
      const updates: string[] = [];
      const params: any[] = [];
      let idx = 1;
      if (license_number !== undefined) { updates.push(`license_number = $${idx}`); params.push(license_number); idx++; }
      if (vehicle_make !== undefined) { updates.push(`vehicle_make = $${idx}`); params.push(vehicle_make); idx++; }
      if (vehicle_model !== undefined) { updates.push(`vehicle_model = $${idx}`); params.push(vehicle_model); idx++; }
      if (vehicle_year !== undefined) { updates.push(`vehicle_year = $${idx}`); params.push(vehicle_year); idx++; }
      if (vehicle_color !== undefined) { updates.push(`vehicle_color = $${idx}`); params.push(colour); idx++; }
      if (license_plate !== undefined) { updates.push(`license_plate = $${idx}`); params.push(plate); idx++; }
    if (derivedBody !== undefined) { updates.push(`body_type = $${idx}`); params.push(derivedBody); idx++; }
    if (derivedCategory !== undefined) { updates.push(`vehicle_category = $${idx}`); params.push(derivedCategory); idx++; }
      if (vehicle_type !== undefined) { updates.push(`vehicle_type = $${idx}`); params.push(vehicle_type); idx++; }
      if (vehicle_vin !== undefined) { updates.push(`vehicle_vin = $${idx}`); params.push(vehicle_vin); idx++; }
      if (odometer_km !== undefined) { updates.push(`odometer_km = $${idx}`); params.push(odometer_km); idx++; }
      if (carscan_report_name !== undefined) { updates.push(`carscan_report_name = $${idx}`); params.push(carscan_report_name); idx++; }
      if (vehicle_fuel_type !== undefined) { updates.push(`vehicle_fuel_type = $${idx}`); params.push(vehicle_fuel_type); idx++; }
      if (vehicle_doors !== undefined) { updates.push(`vehicle_doors = $${idx}`); params.push(vehicle_doors); idx++; }
      if (vehicle_seats !== undefined) { updates.push(`vehicle_seats = $${idx}`); params.push(vehicle_seats); idx++; }
      if (vehicle_derivative !== undefined) { updates.push(`vehicle_derivative = $${idx}`); params.push(vehicle_derivative); idx++; }
      updates.push("updated_at = NOW()");

      params.push(existing.id);
      await execute(`UPDATE driver_profiles SET ${updates.join(", ")} WHERE id = $${idx}`, params);
    } else {
      await execute(
        `INSERT INTO driver_profiles (user_id, license_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate, vehicle_type, vehicle_vin, odometer_km, carscan_report_name, is_online)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)`,
        [user.id, license_number, vehicle_make, vehicle_model, vehicle_year, vehicle_color, license_plate, vehicle_type, vehicle_vin, odometer_km, carscan_report_name]
      );
    }

    const profile = await queryOne("SELECT * FROM driver_profiles WHERE user_id = $1", [user.id]);

    // Vehicle photo cache. This is DB-only: if we already hold an approved image
    // for this make|model|generation|colour it is simply used. If nothing exists
    // yet, noteDriverVehicle() WINS a one-row claim (unique cache_key), which is
    // what guarantees a single CarsXE call even if two drivers save the same car
    // in the same second. Fire-and-forget: saving a car must never wait on it.
    noteDriverVehicle({
      make: vehicle_make ?? profile?.vehicle_make,
      model: vehicle_model ?? profile?.vehicle_model,
      year: vehicle_year ?? profile?.vehicle_year,
      colour: colour ?? profile?.vehicle_color,
    }).catch((err) => console.error("[vehicleImages] hook failed:", err?.message || err));

    res.json(profile);
  } catch (err: any) {
    console.error("Driver profile update error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/drivers/profile — Full driver profile row (vehicle details + license
// number) so the driver app can re-hydrate the "Link Your Car" form after save.
router.get("/profile", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [req.userId!]
    );
    if (!user) { res.status(404).json({ error: "User not found" }); return; }
    const profile = await queryOne(
      "SELECT * FROM driver_profiles WHERE user_id = $1",
      [user.id]
    );
    res.json({ profile: profile || null });
  } catch (err: any) {
    console.error("Get driver profile error:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/drivers/me — Current driver's verification status + profile summary.
// Used to gate "Go Online" in the driver app until their docs are approved.
router.get("/me", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await queryOne<{ id: string; license_document_name: string | null; id_document_name: string | null }>(
      // Same primary-key rule as /stats: having a driver_profiles row is what makes
      // this account a driver. users.role is only a fallback for a driver whose
      // profile row has not been created yet.
      `SELECT u.id, u.license_document_name, u.id_document_name
         FROM users u
         LEFT JOIN driver_profiles dp ON dp.user_id = u.id
        WHERE u.firebase_uid = $1
          AND (dp.user_id IS NOT NULL OR u.role = 'driver')`,
      [req.userId!]
    );
    if (!user) { res.status(403).json({ error: "Driver profile not found" }); return; }
    const profile = await queryOne<any>(
      "SELECT vehicle_make, vehicle_model, vehicle_color, license_plate, is_online, verification_status FROM driver_profiles WHERE user_id = $1",
      [user.id]
    ).catch(() => null);
    res.json({
      verification: profile?.verification_status || (user.license_document_name || user.id_document_name ? "approved" : "pending"),
      hasDocuments: Boolean(user.license_document_name || user.id_document_name),
      profile: profile || null,
    });
  } catch (err: any) {
    console.error("Driver me error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/drivers/online | /offline — REST twins of the `driver:online` socket
// event. The toggle calls these so the driver's INTENT (is_online) is recorded on
// the server and the app can show the SERVER's answer instead of its own opinion.
// They are idempotent, and coming online immediately retries any waiting ride.
router.post("/online", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const dbUser = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [req.userId!]
    );
    if (!dbUser) {
      res.status(403).json({ error: "Driver account not synced yet" });
      return;
    }
    // Self-heal the role. Only the DRIVER app calls this endpoint, so reaching it is
    // proof that this account drives. Without it, one sign-in to the RIDER app (which
    // syncs role='passenger') would leave the account unable to receive ride requests
    // for ever, because the socket decides driver-vs-passenger purely from users.role.
    // Harmless when already correct, and it never touches a rider-only account.
    await execute(
      `UPDATE users SET role = 'driver' WHERE id = $1 AND role <> 'driver'`,
      [dbUser.id]
    ).catch(() => {});
    const online = req.body?.online !== false; // default: go online
    const onTrip = await queryOne<{ id: string }>(
      `SELECT id FROM rides WHERE driver_id = $1
        AND status IN ('accepted','driver_arrived','in_progress') LIMIT 1`,
      [dbUser.id]
    ).catch(() => null);
    const status = online ? (onTrip ? "on_trip" : "available") : "offline";

    const row = await queryOne<any>(
      `INSERT INTO driver_profiles (user_id, is_online, status, last_heartbeat_at, verification_status)
       VALUES ($1, $2, $3, NOW(), 'approved')
       ON CONFLICT (user_id) DO UPDATE
         SET is_online = EXCLUDED.is_online,
             status = EXCLUDED.status,
             last_heartbeat_at = NOW(),
             updated_at = NOW()
       RETURNING user_id, is_online, status, last_heartbeat_at`,
      [dbUser.id, online, status]
    ).catch(() => null);

    console.log(`[driver] online_intent=${online} status=${status} driver=${dbUser.id}`);
    // Module 1: keep the H3 index in step with the REST intent toggle too —
    // offline removes the row, online refreshes status/coords when known.
    if (online) {
      void (async () => {
        const prof = await queryOne<{ current_lat: number | null; current_lng: number | null }>(
          "SELECT current_lat, current_lng FROM driver_profiles WHERE user_id = $1",
          [dbUser.id]
        ).catch(() => null);
        if (prof?.current_lat != null && prof.current_lng != null) {
          await getDriverIndex().upsert({
            userId: dbUser.id,
            lat: Number(prof.current_lat),
            lng: Number(prof.current_lng),
            status,
          });
        }
      })().catch((err) => console.warn("[driverIndex] online upsert failed:", err?.message));
    } else {
      void getDriverIndex().remove(dbUser.id).catch(() => false);
    }
    if (online) void reviveWaitingRides((global as any).__vuraIo).catch(() => 0);
    res.json({ ok: true, online_intent: !!row?.is_online, status: row?.status || status });
  } catch (err: any) {
    console.error("Driver online/offline error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/drivers/offline — explicit offline (kept as its own path for clarity).
router.post("/offline", requireAuth, async (req: AuthRequest, res: Response) => {
  const dbUser = await queryOne<{ id: string }>(
    "SELECT id FROM users WHERE firebase_uid = $1",
    [req.userId!]
  ).catch(() => null);
  if (!dbUser) {
    res.status(403).json({ error: "Driver account not synced yet" });
    return;
  }
  await execute(
    `UPDATE driver_profiles SET is_online = FALSE, status = 'offline', updated_at = NOW()
      WHERE user_id = $1`,
    [dbUser.id]
  ).catch(() => undefined);
  // Module 1: offline means unofferable — drop the index row now rather than
  // waiting for stale eviction (a pending offer to a gone driver is a lost
  // round for a waiting rider).
  void getDriverIndex().remove(dbUser.id).catch(() => false);
  console.log(`[driver] online_intent=false status=offline driver=${dbUser.id}`);
  res.json({ ok: true, online_intent: false, status: "offline" });
});

// GET /api/drivers/vehicle-catalogue — dropdown data for the driver app
// (makes → models → body type, the 12 colours with hex, the 5 body types) and the
// fallbacks the UI must apply. Public on purpose: reference data, not personal data.
//
// The makes/models come from the IMAGE LIBRARY, not the static catalogue, so a driver
// can only pick a car that has a photo. That is what guarantees the rider sees an
// image instead of the SVG body-type icon: there is nothing to offer that cannot be
// served. The static catalogue still supplies the shared colours/body types, and is
// the fallback if the library query fails — the driver app must never show an empty
// dropdown.
router.get("/vehicle-catalogue", async (_req: AuthRequest, res: Response) => {
  try {
    const pairs = await approvedVehicleCatalogue();
    res.json(catalogueForApi(pairs));
  } catch (err: any) {
    console.error("[catalogue] library lookup failed, serving the static list:", err?.message || err);
    res.json(catalogueForApi());
  }
});

// POST /api/drivers/vehicle/classify
// Body: { make, model, model_year, body_type, fuel_type, doors, seats, derivative?, color? }
// Runs the tier engine (src/lib/tier-classifier.ts) and stores the result on the
// driver's profile. Ported from the driver repo's server so the two agree.
router.post("/vehicle/classify", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const { make, model, model_year, body_type, fuel_type, doors, seats, derivative, color } = req.body || {};

    const year = parseInt(String(model_year ?? ""), 10);
    const doorCount = parseInt(String(doors ?? ""), 10);
    const seatCount = parseInt(String(seats ?? ""), 10);

    if (!make || !model || !body_type || !fuel_type) {
      res.status(400).json({ error: "make, model, body_type and fuel_type are required" });
      return;
    }
    if (!Number.isFinite(year) || year < 1950 || year > new Date().getFullYear() + 1) {
      res.status(400).json({ error: "Valid model_year is required" });
      return;
    }
    if (!Number.isFinite(doorCount) || doorCount < 2 || doorCount > 8) {
      res.status(400).json({ error: "Valid doors count is required" });
      return;
    }
    if (!Number.isFinite(seatCount) || seatCount < 2 || seatCount > 20) {
      res.status(400).json({ error: "Valid seats count is required" });
      return;
    }

    const firebaseUid = req.userId!;
    const user = await queryOne<{ id: string }>("SELECT id FROM users WHERE firebase_uid = $1", [firebaseUid]);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    const assignments = classifyVehicle({
      vin: "",
      make: String(make),
      model: String(model),
      model_year: year,
      body_type: String(body_type).toLowerCase(),
      fuel_type: String(fuel_type).toLowerCase(),
      doors: doorCount,
      seats: seatCount,
      derivative: typeof derivative === "string" ? derivative : null,
      color: typeof color === "string" ? color : null,
    });

    const tier = primaryTier(assignments);

    // the tier columns are created on demand so production never needs a migration
    await execute(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_tier VARCHAR(20)`).catch(() => {});
    await execute(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_tiers JSONB DEFAULT '[]'::jsonb`).catch(() => {});

    await execute(
      `UPDATE driver_profiles
          SET vehicle_tier  = $2,
              vehicle_tiers = $3::jsonb,
              updated_at    = NOW()
        WHERE user_id = $1`,
      [user.id, tier, JSON.stringify(assignments)]
    );

    res.json({ assignments, primary_tier: tier });
  } catch (err: any) {
    console.error("vehicle classify error:", err?.message || err);
    res.status(500).json({ error: "Failed to classify vehicle" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// THE DRIVER ONBOARDING RECORD
//
// One canonical, per-driver payload that BOTH the driver app and the admin app
// render. The driver app's "Your driver profile" screen and the admin's driver
// detail screen read THIS endpoint (admin via /api/admin/drivers/:id), so the
// two can never disagree about what a driver has entered.
//
// Everything comes straight from Postgres -- nothing is assembled from whatever
// the phone happens to have cached. That is the point: a driver can install the
// APK, sign in on a new phone, and still see their full record.
//
// Progress is DERIVED here rather than stored, so it cannot drift out of sync
// with the rows it describes.
// ─────────────────────────────────────────────────────────────────────────────

/** Document types a driver must clear before the account can go live. */
const REQUIRED_DOC_TYPES = [
  "drivers_license",
  "id_document",
  "prdp",
  "criminal_record",
  "license_disk",
  "carscan_report",
] as const;

const DOC_TYPE_LABEL: Record<string, string> = {
  drivers_license: "Driver's licence",
  id_document: "ID document",
  prdp: "PRDP licence",
  criminal_record: "Criminal record check",
  license_disk: "Licence disc",
  carscan_report: "CarScan report",
  vehicle_scan: "Vehicle scan",
};

type OnboardingStep = { key: string; label: string; done: boolean; detail: string };

function buildOnboardingSteps(user: any, profile: any, docs: any[], face: any): OnboardingStep[] {
  const approved = new Set(docs.filter((d) => d.status === "approved").map((d) => d.doc_type as string));
  const submitted = new Set(docs.map((d) => d.doc_type as string));
  const steps: OnboardingStep[] = [];
  const name = user.full_name ? String(user.full_name).trim() : "";
  const phone = user.phone_number ? String(user.phone_number).trim() : "";

  steps.push({ key: "full_name", label: "Legal name", done: name.length > 0, detail: name || "Not entered yet" });
  steps.push({ key: "phone", label: "Phone number", done: phone.length > 0, detail: phone || "Not entered yet" });
  steps.push({ key: "profile_photo", label: "Profile photo", done: Boolean(user.profile_photo_url), detail: user.profile_photo_url ? "Uploaded" : "Not uploaded yet" });

  const make = profile?.vehicle_make ? String(profile.vehicle_make).trim() : "";
  const model = profile?.vehicle_model ? String(profile.vehicle_model).trim() : "";
  steps.push({ key: "vehicle", label: "Vehicle make and model", done: make.length > 0 && model.length > 0, detail: make ? `${make} ${model}`.trim() : "Not entered yet" });

  const plate = profile?.license_plate ? String(profile.license_plate).trim() : "";
  steps.push({ key: "license_plate", label: "Number plate", done: plate.length > 0, detail: plate || "Not entered yet" });
  steps.push({ key: "vehicle_photo", label: "Vehicle photo", done: Boolean(profile?.vehicle_image_url), detail: profile?.vehicle_image_url ? "Uploaded" : "Not uploaded yet" });

  for (const type of REQUIRED_DOC_TYPES) {
    steps.push({
      key: `doc:${type}`,
      label: DOC_TYPE_LABEL[type] ?? type,
      done: approved.has(type),
      detail: approved.has(type) ? "Approved" : submitted.has(type) ? "Awaiting review" : "Not uploaded yet",
    });
  }

  steps.push({
    key: "face_scan",
    label: "Facial recognition scan",
    done: Boolean(face?.verified),
    detail: face ? (face.verified ? "Verified" : face.status || "Recorded, not verified") : "Not done yet",
  });

  return steps;
}

// GET /api/drivers/me/onboarding -- everything about THIS driver, in one payload.
router.get("/me/onboarding", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const user = await queryOne<any>("SELECT * FROM users WHERE firebase_uid = $1", [req.userId!]);
    if (!user) { res.status(404).json({ error: "User not found" }); return; }

    // driver_profiles is created lazily, so its absence is normal early on and
    // must NOT be an error.
    const profile = await queryOne<any>("SELECT * FROM driver_profiles WHERE user_id = $1", [user.id]);

    const docs = await query<any>(
      `SELECT id, doc_type, file_name, mime_type, size_bytes, status, note, created_at
         FROM driver_documents WHERE driver_id = $1 ORDER BY created_at DESC`,
      [user.id]
    );

    // No face scan yet is normal, so this must never 500 the whole payload --
    // the driver still needs to see their profile.
    const face = await queryOne<any>(
      `SELECT id, verified, method, status, note, created_at
         FROM face_verifications WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [user.id]
    ).catch(() => null);

    const stats = await queryOne<any>(
      `SELECT
         (SELECT COUNT(*) FROM rides WHERE driver_id = $1 AND status = 'completed')::int AS completed_rides,
         (SELECT COUNT(*) FROM ratings WHERE driver_id = $1)::int AS ratings_count,
         (SELECT COALESCE(AVG(score), 0) FROM ratings WHERE driver_id = $1)::float AS rating_average`,
      [user.id]
    );

    const steps = buildOnboardingSteps(user, profile, docs, face);
    const completed = steps.filter((s) => s.done).length;

    // Mirror the /me fallback so both endpoints agree: if every required document
    // is explicitly approved the driver is approved, whatever the cached column says.
    const allDocsApproved = REQUIRED_DOC_TYPES.every((t) =>
      docs.some((d) => d.doc_type === t && d.status === "approved")
    );

    res.json({
      user,
      profile: profile || null,
      documents: docs,
      face_scan: face || null,
      stats: {
        completed_rides: stats?.completed_rides ?? 0,
        ratings_count: stats?.ratings_count ?? 0,
        rating_average: stats?.rating_average ?? 0,
      },
      verification_status: allDocsApproved ? "approved" : profile?.verification_status || "pending",
      progress: {
        steps,
        completed,
        total: steps.length,
        percent: steps.length ? Math.round((completed / steps.length) * 100) : 0,
      },
      updated_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Driver onboarding error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
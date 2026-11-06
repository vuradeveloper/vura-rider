"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.vehicleReviewKey = vehicleReviewKey;
exports.categoriesForTier = categoriesForTier;
exports.ensureVehicleReviewSchema = ensureVehicleReviewSchema;
exports.classifyDriverVehicle = classifyDriverVehicle;
exports.sweepVehicleClassification = sweepVehicleClassification;
exports.saveVehicleClasses = saveVehicleClasses;
exports.setVehicleSuspended = setVehicleSuspended;
exports.setVehicleDocExpiry = setVehicleDocExpiry;
// vehicleReview - keeps the "can this car be classified?" decision in one place.
//
// WHAT THIS SOLVES
// classifyVehicle() never returns "nothing": an unknown make/model falls back
// to a low tier with status "pending_review". Before this module nothing read
// that status, so an unclassified car looked exactly like a classified one and
// the driver quietly received the wrong ride classes.
//
// This module:
//   1. ensures the review columns exist (lazy, idempotent - production does not
//      run migrations on boot),
//   2. classifies a driver's stored vehicle and records whether a human needs to
//      look at it,
//   3. lets an admin set the ride classes and clears the flag, with an audit row.
//
// The flag is deliberately sticky after a manual review: saving the same car
// again must not put it back in the queue. Changing make/model/year changes the
// review key, so a genuinely new car is classified again.
const database_1 = require("../config/database");
const tier_classifier_1 = require("../lib/tier-classifier");
const rideCategories_1 = require("./rideCategories");
const adminAuth_1 = require("./adminAuth");
function vehicleReviewKey(p) {
    return [p.vehicle_make, p.vehicle_model, p.vehicle_year]
        .map((v) => String(v ?? "").trim().toLowerCase())
        .join("|");
}
/**
 * A confident catalog match still needs ride classes for dispatch. CarScan
 * normally supplies them; when it did not, map the classifier tier onto the
 * canonical tokens. Explicit CarScan classes always win, so this only fills an
 * empty list.
 */
function categoriesForTier(tier, assignments) {
    const out = new Set();
    if (tier === "GO") {
        out.add("economy");
        out.add("standard");
    }
    else if (tier === "COMFORT") {
        out.add("comfort");
        out.add("business");
    }
    else if (tier === "PREMIUM") {
        out.add("premium");
        out.add("business");
    }
    if (assignments.some((a) => a.tier_code === "GREEN"))
        out.add("electric");
    return Array.from(out);
}
let ensurePromise = null;
/**
 * Create the additive columns and flag rows that already have no ride classes.
 * Safe to call on every boot and on every route; the first call does the work.
 */
function ensureVehicleReviewSchema() {
    if (!ensurePromise) {
        ensurePromise = doEnsure().catch((err) => {
            ensurePromise = null; // let the next caller retry
            throw err;
        });
    }
    return ensurePromise;
}
async function doEnsure() {
    try {
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_categories JSONB DEFAULT '[]'::jsonb`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_tier VARCHAR(20)`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_tiers JSONB DEFAULT '[]'::jsonb`);
        // The Cars page reads these; keep the endpoint safe even on a database that
        // has never seen a driver save since the columns were introduced.
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_vin VARCHAR(50)`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_engine VARCHAR(50)`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS body_type VARCHAR(30)`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_category VARCHAR(30)`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_fuel_type VARCHAR(20)`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_doors INTEGER`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_seats INTEGER`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_derivative VARCHAR(100)`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_needs_review BOOLEAN NOT NULL DEFAULT FALSE`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_review_reason TEXT`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_review_key TEXT`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_reviewed_at TIMESTAMPTZ`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_reviewed_by TEXT`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_admin_note TEXT`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_classified_at TIMESTAMPTZ`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS status VARCHAR(20)`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS break_until TIMESTAMPTZ`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_suspended BOOLEAN NOT NULL DEFAULT FALSE`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_suspended_reason TEXT`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_suspended_at TIMESTAMPTZ`);
        await (0, database_1.execute)(`ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS vehicle_suspended_by TEXT`);
        // The Cars page edits the expiry of the vehicle documents that already
        // exist. Older bootstraps created the table without this column.
        await (0, database_1.execute)(`ALTER TABLE driver_documents ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ`);
        await (0, database_1.execute)(`CREATE INDEX IF NOT EXISTS idx_driver_profiles_vehicle_needs_review
         ON driver_profiles (vehicle_needs_review)
       WHERE vehicle_needs_review = TRUE`);
        // One-time catch-up for cars saved before this feature existed. Only rows
        // with NO ride classes are flagged: a car whose CarScan report already gave
        // it classes is not "unclassified" just because the classifier is new.
        await (0, database_1.execute)(`UPDATE driver_profiles
          SET vehicle_needs_review = TRUE,
              vehicle_review_reason = COALESCE(vehicle_review_reason,
                'No ride classes yet - classify this car')
        WHERE vehicle_needs_review = FALSE
          AND vehicle_reviewed_at IS NULL
          AND (vehicle_make IS NOT NULL OR vehicle_model IS NOT NULL)
          AND (vehicle_categories IS NULL OR vehicle_categories = '[]'::jsonb)`);
        console.log("[schema] vehicle review columns ready");
    }
    catch (err) {
        console.warn("[schema] vehicle review columns failed:", err?.message || err);
        throw err;
    }
}
/**
 * Classify the car currently stored on the driver's profile and persist the
 * result. Returns null when the driver has no profile row.
 *
 * Missing details are a review reason, not a crash: an admin can set the ride
 * classes even when the scan omitted the body type or year.
 */
async function classifyDriverVehicle(driverId) {
    await ensureVehicleReviewSchema().catch(() => { });
    const p = await (0, database_1.queryOne)(`SELECT vehicle_make, vehicle_model, vehicle_year, body_type,
            vehicle_fuel_type, vehicle_doors, vehicle_seats, vehicle_derivative,
            vehicle_color, vehicle_categories, vehicle_review_key, vehicle_reviewed_at
       FROM driver_profiles
      WHERE user_id = $1`, [driverId]);
    if (!p)
        return null;
    const categories = (0, rideCategories_1.normaliseVehicleCategories)(p.vehicle_categories);
    const key = vehicleReviewKey(p);
    const reviewedSameCar = Boolean(p.vehicle_reviewed_at) &&
        String(p.vehicle_review_key || "") === key;
    const make = String(p.vehicle_make || "").trim();
    const model = String(p.vehicle_model || "").trim();
    const year = Number(p.vehicle_year);
    const body = String(p.body_type || "").trim().toLowerCase();
    const fuel = String(p.vehicle_fuel_type || "petrol").trim().toLowerCase();
    const doors = Number(p.vehicle_doors) || 4;
    const seats = Number(p.vehicle_seats) || 5;
    let assignments = [];
    let reason = null;
    if (!make || !model) {
        reason = "Vehicle make and model are missing";
    }
    else if (!Number.isFinite(year) || year < 1950 || year > new Date().getFullYear() + 1) {
        reason = "Model year is missing or invalid";
    }
    else if (!body) {
        reason = "Body type is missing - set it on the car before classifying";
    }
    else {
        assignments = (0, tier_classifier_1.classifyVehicle)({
            vin: "",
            make,
            model,
            model_year: year,
            body_type: body,
            fuel_type: fuel,
            doors,
            seats,
            derivative: p.vehicle_derivative || null,
            color: p.vehicle_color || null,
        });
        const base = assignments.find((a) => a.tier_code !== "GREEN") || assignments[0];
        if (!base) {
            reason = "Could not classify this vehicle";
        }
        else if (base.status === "pending_review") {
            reason =
                base.method === "catalog_match_failed_filters"
                    ? "Vehicle specs fall outside the catalogue tier limits"
                    : "Model is not in the vehicle catalogue";
        }
    }
    // A human already classified this exact car - keep their decision.
    const needsReview = reviewedSameCar ? false : Boolean(reason);
    const reviewReason = reviewedSameCar ? null : reason;
    const tier = (0, tier_classifier_1.primaryTier)(assignments);
    const autoCategories = categories.length === 0 && !needsReview ? categoriesForTier(tier, assignments) : [];
    await (0, database_1.execute)(`UPDATE driver_profiles
        SET vehicle_tier = COALESCE($2, vehicle_tier),
            vehicle_tiers = $3::jsonb,
            vehicle_needs_review = $4,
            vehicle_review_reason = $5,
            vehicle_classified_at = NOW(),
            updated_at = NOW()
      WHERE user_id = $1`, [driverId, tier, JSON.stringify(assignments), needsReview, reviewReason]);
    // A confident catalog match with no CarScan Eligible Categories still needs
    // dispatch tokens; fill them from the tier. Never overwrite an explicit list.
    if (autoCategories.length > 0) {
        await (0, database_1.execute)(`UPDATE driver_profiles SET vehicle_categories = $2::jsonb WHERE user_id = $1`, [driverId, JSON.stringify(autoCategories)]);
    }
    return {
        assignments,
        primary_tier: tier,
        needs_review: needsReview,
        review_reason: reviewReason,
        categories: categories.length > 0 ? categories : autoCategories,
    };
}
/**
 * One boot-time pass over cars that have never been reviewed. This is what
 * turns the existing fleet into a real review queue instead of only flagging
 * cars saved after this feature ships. Small and bounded; failures on one car
 * never stop the rest.
 */
async function sweepVehicleClassification(limit = 500) {
    await ensureVehicleReviewSchema().catch(() => { });
    const rows = await (0, database_1.queryOne)(`SELECT COUNT(*)::int AS count
       FROM driver_profiles
      WHERE (vehicle_make IS NOT NULL OR vehicle_model IS NOT NULL)
        AND vehicle_reviewed_at IS NULL`).catch(() => null);
    if (!rows?.count)
        return 0;
    const drivers = await (0, database_1.query)(`SELECT user_id FROM driver_profiles
      WHERE (vehicle_make IS NOT NULL OR vehicle_model IS NOT NULL)
        AND vehicle_reviewed_at IS NULL
      LIMIT $1`, [limit]).catch(() => []);
    if (drivers.length === 0)
        return 0;
    let done = 0;
    for (const row of drivers) {
        try {
            await classifyDriverVehicle(row.user_id);
            done += 1;
        }
        catch (err) {
            console.warn(`[vehicleReview] sweep failed driver=${row.user_id}:`, err?.message || err);
        }
    }
    if (done > 0)
        console.log(`[vehicleReview] classified ${done} car(s) on boot`);
    return done;
}
/** Admin action: set the ride classes and close the review. Audited. */
async function saveVehicleClasses(driverId, rawCategories, actor, note) {
    await ensureVehicleReviewSchema();
    const before = await (0, database_1.queryOne)(`SELECT vehicle_make, vehicle_model, vehicle_year, vehicle_categories,
            vehicle_tier, vehicle_needs_review
       FROM driver_profiles
      WHERE user_id = $1`, [driverId]);
    if (!before)
        return null;
    const categories = (0, rideCategories_1.normaliseVehicleCategories)(rawCategories);
    if (categories.length === 0) {
        throw new Error("Pick at least one ride class");
    }
    const key = vehicleReviewKey(before);
    const cleanNote = note === undefined ? null : String(note).trim().slice(0, 2000) || null;
    await (0, database_1.execute)(`UPDATE driver_profiles
        SET vehicle_categories = $2::jsonb,
            vehicle_needs_review = FALSE,
            vehicle_review_reason = NULL,
            vehicle_reviewed_at = NOW(),
            vehicle_reviewed_by = $3,
            vehicle_review_key = $4,
            vehicle_admin_note = COALESCE($5, vehicle_admin_note),
            vehicle_tier = 'MANUAL',
            updated_at = NOW()
      WHERE user_id = $1`, [driverId, JSON.stringify(categories), actor.email, key, cleanNote]);
    await (0, adminAuth_1.writeAudit)(actor, {
        action: "vehicle.classify",
        entityType: "driver_profiles",
        entityId: driverId,
        oldValue: {
            categories: (0, rideCategories_1.normaliseVehicleCategories)(before.vehicle_categories),
            needs_review: Boolean(before.vehicle_needs_review),
            tier: before.vehicle_tier || null,
        },
        newValue: { categories, needs_review: false },
        reason: cleanNote || undefined,
    });
    return (0, database_1.queryOne)(`SELECT * FROM driver_profiles WHERE user_id = $1`, [driverId]);
}
/** Admin action: suspend or reactivate one vehicle. Audited. */
async function setVehicleSuspended(driverId, suspended, actor, reason) {
    await ensureVehicleReviewSchema();
    const before = await (0, database_1.queryOne)(`SELECT vehicle_make, vehicle_model, license_plate, vehicle_suspended,
            vehicle_suspended_reason
       FROM driver_profiles
      WHERE user_id = $1`, [driverId]);
    if (!before)
        return null;
    const cleanReason = reason === undefined ? null : String(reason).trim().slice(0, 2000) || null;
    if (suspended && (!cleanReason || cleanReason.length < 3)) {
        throw new Error("A reason is required to suspend a vehicle");
    }
    await (0, database_1.execute)(`UPDATE driver_profiles
        SET vehicle_suspended = $2,
            vehicle_suspended_reason = $3,
            vehicle_suspended_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
            vehicle_suspended_by = CASE WHEN $2 THEN $4 ELSE NULL END,
            is_online = CASE WHEN $2 THEN FALSE ELSE is_online END,
            status = CASE
              WHEN $2 AND COALESCE(status, 'offline') <> 'on_trip' THEN 'offline'
              ELSE status
            END,
            break_until = CASE WHEN $2 THEN NULL ELSE break_until END,
            updated_at = NOW()
      WHERE user_id = $1`, [driverId, suspended, suspended ? cleanReason : null, actor.email]);
    await (0, adminAuth_1.writeAudit)(actor, {
        action: suspended ? "vehicle.suspend" : "vehicle.reactivate",
        entityType: "driver_profiles",
        entityId: driverId,
        oldValue: {
            suspended: Boolean(before.vehicle_suspended),
            reason: before.vehicle_suspended_reason || null,
        },
        newValue: { suspended, reason: suspended ? cleanReason : null },
        reason: suspended ? cleanReason || undefined : undefined,
    });
    return (0, database_1.queryOne)(`SELECT * FROM driver_profiles WHERE user_id = $1`, [driverId]);
}
const VEHICLE_EXPIRY_DOCS = new Set(["license_disk", "carscan_report", "vehicle_scan"]);
/** Admin action: set the expiry of the latest vehicle document of one type. */
async function setVehicleDocExpiry(driverId, docType, expiresAt, actor) {
    await ensureVehicleReviewSchema();
    if (!VEHICLE_EXPIRY_DOCS.has(docType)) {
        throw new Error("That document type is not a vehicle expiry document");
    }
    const before = await (0, database_1.queryOne)(`SELECT id, doc_type, expires_at
       FROM driver_documents
      WHERE driver_id = $1 AND doc_type = $2
      ORDER BY created_at DESC
      LIMIT 1`, [driverId, docType]);
    if (!before)
        return null;
    let clean = null;
    if (expiresAt) {
        const d = new Date(expiresAt);
        if (!Number.isFinite(d.getTime()))
            throw new Error("Invalid expiry date");
        clean = d.toISOString();
    }
    await (0, database_1.execute)(`UPDATE driver_documents SET expires_at = $2::timestamptz WHERE id = $1`, [before.id, clean]);
    await (0, adminAuth_1.writeAudit)(actor, {
        action: "vehicle.expiry",
        entityType: "driver_documents",
        entityId: before.id,
        oldValue: { docType, expiresAt: before.expires_at || null },
        newValue: { docType, expiresAt: clean },
    });
    return (0, database_1.queryOne)(`SELECT id, doc_type, expires_at FROM driver_documents WHERE id = $1`, [before.id]);
}
//# sourceMappingURL=vehicleReview.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicBaseUrl = publicBaseUrl;
exports.ensureShareToken = ensureShareToken;
exports.triggerSos = triggerSos;
// ─────────────────────────────────────────────────────────────────────────────
// SOS SERVICE — one press sends the admin team everything they need (§4):
// both people's names + phones, the car incl. plate, the live GPS position,
// and the ride id/time. Stored in sos_alerts (with a handling workflow the
// console drives) AND journaled into safety_events. No emergency service is
// contacted automatically — the admin team is the responder.
// ─────────────────────────────────────────────────────────────────────────────
const crypto_1 = require("crypto");
const database_1 = require("../config/database");
const safetyConfig_1 = require("./safetyConfig");
const locationLog_1 = require("./locationLog");
const safetyNotify_1 = require("./safetyNotify");
function publicBaseUrl() {
    return (process.env.PUBLIC_BASE_URL ||
        "https://api.ridevura.com").replace(/\/+$/, "");
}
/** Reuse the ride's existing live-trip token, or mint one for this SOS. */
async function ensureShareToken(rideId) {
    await (0, safetyConfig_1.ensureSafetyTables)();
    const last = await (0, database_1.queryOne)(`SELECT type, data->>'shareToken' AS token FROM safety_events
      WHERE ride_id = $1 AND type IN ('share_started', 'share_ended')
      ORDER BY created_at DESC LIMIT 1`, [rideId]).catch(() => null);
    // Reuse the live token. After a stop, mint a NEW one so an old link cannot
    // silently come back to life.
    if (last?.type === "share_started" && last.token)
        return last.token;
    const token = (0, crypto_1.randomBytes)(16).toString("hex");
    await (0, database_1.execute)("INSERT INTO safety_events (ride_id, type, data) VALUES ($1, 'share_started', $2)", [rideId, JSON.stringify({ shareToken: token, timestamp: new Date().toISOString(), reason: "sos" })]).catch(() => undefined);
    return token;
}
async function contactsFor(userId) {
    return (0, database_1.query)(`SELECT name, phone, email FROM emergency_contacts
      WHERE user_id = $1 ORDER BY created_at ASC LIMIT 10`, [userId]).catch(() => []);
}
async function triggerSos(input) {
    await (0, safetyConfig_1.ensureSafetyTables)();
    const rideId = input.rideId || null;
    // Two presses in a row (or an accidental repeat) must not create a pile of
    // active alerts or spam the contacts. Update the active one with the latest
    // location instead.
    const recent = await (0, database_1.queryOne)(`SELECT id, payload FROM sos_alerts
      WHERE triggered_by = $1 AND status = 'active'
        AND created_at > NOW() - INTERVAL '2 minutes'
      ORDER BY created_at DESC LIMIT 1`, [input.byUserId]).catch(() => null);
    if (recent) {
        const merged = {
            ...(recent.payload || {}),
            last_repeat_at: new Date().toISOString(),
            ...(input.location
                ? {
                    location: {
                        lat: input.location.lat,
                        lng: input.location.lng,
                        at: new Date().toISOString(),
                        source: "phone",
                    },
                }
                : {}),
        };
        await (0, database_1.execute)("UPDATE sos_alerts SET payload = $2::jsonb WHERE id = $1", [recent.id, JSON.stringify(merged)]).catch(() => undefined);
        return {
            id: recent.id,
            ride_id: rideId,
            share_url: null,
            contacts_notified: 0,
            safety_team_notified: false,
            duplicate: true,
            message: "Your SOS is already active — the safety team has your latest location. Stay on this screen.",
        };
    }
    let payload = {
        triggered_at: new Date().toISOString(),
        role: input.byRole,
    };
    if (rideId) {
        const r = await (0, database_1.queryOne)(`SELECT r.id, r.status, r.created_at, r.trip_started_at,
              r.pickup_address, r.destination_address,
              pu.full_name AS rider_name, pu.phone AS rider_phone,
              du.full_name AS driver_name, du.phone AS driver_phone,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, dp.license_plate,
              dp.current_lat, dp.current_lng
         FROM rides r
         LEFT JOIN users pu ON pu.id = r.passenger_id
         LEFT JOIN users du ON du.id = r.driver_id
         LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
        WHERE r.id = $1`, [rideId]).catch(() => null);
        if (r) {
            const last = await (0, locationLog_1.lastRidePoint)(rideId);
            const loc = input.location
                ? { lat: input.location.lat, lng: input.location.lng, at: new Date().toISOString(), source: "phone" }
                : last
                    ? { lat: last.lat, lng: last.lng, at: String(last.recorded_at), source: "trip_ping" }
                    : r.current_lat != null
                        ? { lat: Number(r.current_lat), lng: Number(r.current_lng), at: null, source: "driver_profile" }
                        : null;
            payload = {
                ...payload,
                ride_id: r.id,
                ride_status: r.status,
                ride_started_at: r.created_at,
                trip_started_at: r.trip_started_at ?? null,
                pickup_address: r.pickup_address ?? null,
                destination_address: r.destination_address ?? null,
                rider: { name: r.rider_name ?? null, phone: r.rider_phone ?? null },
                driver: {
                    name: r.driver_name ?? null,
                    phone: r.driver_phone ?? null,
                    plate: r.license_plate ?? null,
                    car: [r.vehicle_color, r.vehicle_make, r.vehicle_model].filter(Boolean).join(" ") || null,
                },
                location: loc,
            };
        }
    }
    if (input.location && !rideId) {
        payload.location = { lat: input.location.lat, lng: input.location.lng, at: new Date().toISOString() };
    }
    // Emergency contacts belong to the person who pressed SOS (rider or driver).
    const contacts = await contactsFor(input.byUserId);
    const shareToken = rideId ? await ensureShareToken(rideId) : null;
    const shareUrl = shareToken ? `${publicBaseUrl()}/share/${shareToken}` : null;
    payload.emergency_contacts = contacts.map((c) => ({
        name: c.name,
        phone: c.phone,
        email: c.email,
    }));
    payload.share_url = shareUrl;
    const row = await (0, database_1.queryOne)(`INSERT INTO sos_alerts (ride_id, triggered_by, triggered_by_role, payload)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING id`, [rideId, input.byUserId, input.byRole, JSON.stringify(payload)]);
    await (0, database_1.execute)("INSERT INTO safety_events (ride_id, type, data) VALUES ($1, 'sos', $2)", [rideId, JSON.stringify({ sos_id: row?.id, triggered_by: input.byUserId, role: input.byRole })]).catch(() => { });
    console.error(`🚨🚨 SOS ${row?.id} ride=${rideId ?? "-"} by=${input.byRole}:${input.byUserId} ` +
        `rider=${payload.rider?.name ?? "-"} driver=${payload.driver?.name ?? "-"} ` +
        `plate=${payload.driver?.plate ?? "-"} loc=${payload.location ? `${payload.location.lat},${payload.location.lng}` : "none"}`);
    // The SOS row is already recorded before this runs, so a mail outage can only
    // reduce the reach of the alert — never lose it.
    const notified = await (0, safetyNotify_1.notifySos)({ payload, contacts, shareUrl }).catch(() => ({
        contacts_notified: 0,
        safety_team_notified: false,
    }));
    const contactLine = notified.contacts_notified > 0
        ? `${notified.contacts_notified} emergency contact${notified.contacts_notified === 1 ? "" : "s"} and `
        : "";
    return {
        id: row.id,
        ride_id: rideId,
        share_url: shareUrl,
        contacts_notified: notified.contacts_notified,
        safety_team_notified: notified.safety_team_notified,
        duplicate: false,
        message: "Help alerted — " +
            contactLine +
            "Vura's safety team has your details and live location. " +
            "Stay on this screen; they can see your trip moving in real time." +
            (notified.contacts_notified === 0
                ? " Add an email to an emergency contact so they are alerted automatically next time."
                : ""),
    };
}
//# sourceMappingURL=sosService.js.map
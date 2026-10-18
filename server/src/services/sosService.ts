// ─────────────────────────────────────────────────────────────────────────────
// SOS SERVICE — one press sends the admin team everything they need (§4):
// both people's names + phones, the car incl. plate, the live GPS position,
// and the ride id/time. Stored in sos_alerts (with a handling workflow the
// console drives) AND journaled into safety_events. No emergency service is
// contacted automatically — the admin team is the responder.
// ─────────────────────────────────────────────────────────────────────────────
import { queryOne, execute } from "../config/database";
import { ensureSafetyTables } from "./safetyConfig";
import { lastRidePoint } from "./locationLog";

export interface SosInput {
  rideId?: string | null;
  byUserId: string;
  byRole: "rider" | "driver";
  /** Optional fresh fix from the phone's own GPS (better than last ping). */
  location?: { lat: number; lng: number } | null;
}

export interface SosResult {
  id: string;
  message: string;
  ride_id: string | null;
}

export async function triggerSos(input: SosInput): Promise<SosResult> {
  await ensureSafetyTables();
  const rideId = input.rideId || null;

  let payload: Record<string, unknown> = {
    triggered_at: new Date().toISOString(),
    role: input.byRole,
  };

  if (rideId) {
    const r = await queryOne<any>(
      `SELECT r.id, r.status, r.created_at, r.trip_started_at,
              r.pickup_address, r.destination_address,
              pu.full_name AS rider_name, pu.phone AS rider_phone,
              du.full_name AS driver_name, du.phone AS driver_phone,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, dp.license_plate,
              dp.current_lat, dp.current_lng
         FROM rides r
         LEFT JOIN users pu ON pu.id = r.passenger_id
         LEFT JOIN users du ON du.id = r.driver_id
         LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
        WHERE r.id = $1`,
      [rideId]
    ).catch(() => null);

    if (r) {
      const last = await lastRidePoint(rideId);
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

  const row = await queryOne<{ id: string }>(
    `INSERT INTO sos_alerts (ride_id, triggered_by, triggered_by_role, payload)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING id`,
    [rideId, input.byUserId, input.byRole, JSON.stringify(payload)]
  );
  await execute(
    "INSERT INTO safety_events (ride_id, type, data) VALUES ($1, 'sos', $2)",
    [rideId, JSON.stringify({ sos_id: row?.id, triggered_by: input.byUserId, role: input.byRole })]
  ).catch(() => { });

  console.error(
    `🚨🚨 SOS ${row?.id} ride=${rideId ?? "-"} by=${input.byRole}:${input.byUserId} ` +
    `rider=${(payload.rider as any)?.name ?? "-"} driver=${(payload.driver as any)?.name ?? "-"} ` +
    `plate=${(payload.driver as any)?.plate ?? "-"} loc=${payload.location ? `${(payload.location as any).lat},${(payload.location as any).lng}` : "none"}`
  );

  return {
    id: row!.id,
    ride_id: rideId,
    message:
      "Help alerted — Vura's safety team has your details and live location. " +
      "Stay on this screen; they can see your trip moving in real time.",
  };
}

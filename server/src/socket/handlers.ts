import { Server as SocketIOServer, Socket } from "socket.io";
import { getAuth } from "../config/firebase";
import { query, queryOne, execute } from "../config/database";
import { refundTransaction, chargeAuthorization, getDefaultCardToken } from "../services/paystackPayment";
import { sendPushToUsers } from "../services/notify";
import { markDriverLivePing, stopServerRideSim, syncSimToDriver } from "../services/rideSim";
import {
  acceptRide,
  cancelPendingOffers,
  declineOffer,
  logRideEvent,
  offerToNextDriver,
  releaseDriver,
  reviveWaitingRides,
  startDispatch,
} from "../services/dispatch";
import { trace, startTrace } from "../services/trace";
import { getDriverIndex } from "../services/driverIndex";
import { noteIndexUpsertFailure } from "../services/metrics";

/**
 * `request_received` must be timestamped at the rider's TAP, but the ride row (and
 * therefore its UUID, which ride_events.ride_id is typed as) does not exist until
 * several awaits later. Writing the stage under a placeholder id would fail the
 * INSERT outright and lose the very measurement we want.
 *
 * So instead: capture the clock in a per-socket pending slot NOW, then once the
 * INSERT returns, write BOTH request_received and trip_saved under the real ride
 * id using that original timestamp. The elapsed time is preserved exactly, and the
 * whole journey ends up under one trace_id.
 */
interface PendingRequest {
  t0: number;
  traceId: string;
}
const pendingRequest = new WeakMap<Socket, PendingRequest>();

/** Stamp the rider's tap. Returns the clock so the caller can keep it. */
function markRequestReceived(socket: Socket): PendingRequest {
  const ctx: PendingRequest = { t0: Date.now(), traceId: crypto.randomUUID() };
  pendingRequest.set(socket, ctx);
  return ctx;
}

/** Write the first two stages under the real ride id, preserving the tap clock. */
function traceRequestAndSave(rideId: string | null, socket: Socket, extra: Record<string, unknown>) {
  const ctx = pendingRequest.get(socket);
  pendingRequest.delete(socket);
  if (!rideId || !ctx) return;

  // Adopt the tap's trace_id for the ride, so every later stage lines up with it.
  startTrace(rideId);
  const adopted = startTrace(rideId);
  adopted.traceId = ctx.traceId;
  adopted.t0 = ctx.t0;

  trace(rideId, "request_received", { ...extra, ms_from_start: 0, at: new Date(ctx.t0).toISOString() });
}

// Push a ride milestone to a user's registered devices. firebaseUid is the
// rider's/driver's Firebase account id (stored on users.firebase_uid).
//
// WHY THIS NO LONGER USES services/push.ts
//
// services/push.ts is the LEGACY Expo-only sender: it accepts just
// ExponentPushToken[...] tokens. The apps actually being shipped are Capacitor
// APKs, which cannot mint an Expo token, so every milestone sent through here
// ("Driver arrived", "Ride complete", the cancellations) reached NOTHING on a
// backgrounded phone -- no socket, no notification. Only dispatch's offer path
// reached FCM, because it already went through services/notify.ts.
//
// services/notify.ts is the real sender: FCM via firebase-admin with Android
// priority high, a high-importance channel and apns time-sensitive, PLUS the
// Expo fallback for the legacy RN build. Both transports, so nobody regresses.
//
// Note the key change: notify.ts keys on DB user ids, not Firebase uids, so the
// uid is resolved here. That resolution is also recorded in the trace, so a
// milestone that fails to resolve is visible instead of silent.
function notifyUser(
  firebaseUid: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  rideId?: string | null,
  type?: string
) {
  if (!firebaseUid) return;
  void (async () => {
    const user = await queryOne<{ id: string }>(
      "SELECT id FROM users WHERE firebase_uid = $1",
      [firebaseUid]
    );
    if (!user) {
      // Unresolvable uid: log it rather than dropping the notification silently.
      console.warn(`[push] no DB user for firebase uid; dropped "${title}"`);
      return;
    }

    // FCM data values must be strings, so coerce rather than trusting callers.
    const stringData: Record<string, string> = {};
    for (const [k, v] of Object.entries(data || {})) {
      if (v == null) continue;
      stringData[k] = String(v);
    }

    const delivered = await sendPushToUsers([user.id], {
      type: type || "trip_update",
      title,
      body,
      rideId: rideId ?? null,
      // Milestones like "Driver arrived" are worth waking a phone for.
      highPriority: true,
      data: stringData,
    });

    if (rideId) {
      trace(rideId, "milestone_push", {
        type: type || "trip_update",
        delivered,
        ok: delivered > 0,
      });
    }
    if (!delivered) {
      console.warn(`[push] milestone "${title}" reached 0 devices (ride=${rideId ?? "-"})`);
    }
  })().catch((err) => console.warn("[push] milestone failed:", err?.message));
}

interface AuthSocket extends Socket {
  userId?: string;
  dbUserId?: string;
  userRole?: string;
}

export function setupSocketHandlers(io: SocketIOServer) {
  // Auth middleware
  io.use(async (socket: AuthSocket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Authentication required"));

      const decoded = await getAuth().verifyIdToken(token);
      socket.userId = decoded.uid;

      const user = await queryOne<{ id: string; role: string }>(
        "SELECT id, role FROM users WHERE firebase_uid = $1",
        [decoded.uid]
      );
      if (user) {
        socket.dbUserId = user.id;
        socket.userRole = user.role;
      }
      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (rawSocket: Socket) => {
    const socket = rawSocket as AuthSocket;
    console.log(`🔌 Socket: ${socket.id} (user: ${socket.userId})`);

    if (socket.userId) socket.join(`user:${socket.userId}`);

    const getDbUserId = async (): Promise<string | undefined> => {
      if (socket.dbUserId) return socket.dbUserId;
      if (!socket.userId) return undefined;
      const user = await queryOne<{ id: string }>(
        "SELECT id FROM users WHERE firebase_uid = $1",
        [socket.userId]
      );
      if (user) {
        socket.dbUserId = user.id;
        return user.id;
      }
      return undefined;
    };

    // Broadcast the number of riders currently waiting (rides in "searching"
    // status) to all online drivers so they can see how many ride requests
    // are pending.
    const broadcastRiderQueue = async () => {
      try {
        const count = await queryOne<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM rides WHERE status = 'searching'"
        );
        io.to("drivers").emit("ride:queue", { count: count?.count ?? 0 });
      } catch (e) {
        console.warn("Failed to broadcast rider queue:", e);
      }
    };

    // Ensure the chat messages table exists (best-effort; created on boot too).
    const ensureChatTable = async () => {
      await execute(
        `CREATE TABLE IF NOT EXISTS chat_messages (
           id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
           ride_id UUID NOT NULL,
           sender_id UUID NOT NULL,
           message TEXT NOT NULL,
           created_at TIMESTAMPTZ DEFAULT NOW()
         )`
      ).catch((err) => console.warn("chat_messages table init warning:", err.message));
    };

    // ── Passenger: (re)connect — rejoin active ride room + current driver position ──
    // IMPORTANT: also rejoin rides still in 'searching'/'scheduled'. If the rider's
    // socket reconnects mid-search (network blip, app backgrounded, token refresh),
    // the room membership from passenger:ride:request is lost — without this, the
    // rider would NEVER receive the ride:accepted broadcast and would stay stuck on
    // "Finding your driver" forever.
    socket.on("passenger:connect", async () => {
      try {
        const dbUserId = await getDbUserId();
        if (!dbUserId) return;
        const active = await queryOne<any>(
          `SELECT r.id, r.status,
                  dp.current_lat, dp.current_lng, dp.current_heading
           FROM rides r
           LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
           WHERE r.passenger_id = $1
             AND r.status IN ('searching','scheduled','accepted','driver_arrived','in_progress')
             AND r.created_at > NOW() - INTERVAL '240 minutes'
           ORDER BY r.created_at DESC LIMIT 1`,
          [dbUserId]
        );
        if (active?.id) {
          socket.join(`ride:${active.id}`);
          if (active.current_lat != null && active.current_lng != null) {
            socket.emit("ride:driver:location", {
              rideId: active.id,
              lat: Number(active.current_lat),
              lng: Number(active.current_lng),
              bearing: Number(active.current_heading ?? 0) || 0,
              heading: Number(active.current_heading ?? 0) || 0,
            });
          }
        }
      } catch (err: any) {
        console.error("passenger:connect error:", err.message);
      }
    });

    // ── Driver confirms the offer actually reached the device ──────────────────
  // "offer_sent" only proves the server handed the event to socket.io. It says
  // nothing about whether the phone rendered it. This ack is what distinguishes
  // "the offer was sent" from "the offer arrived" -- the difference between a
  // dispatch bug and a dead socket.
  socket.on("driver:ride:offer:ack", async (data) => {
    try {
      const rideId = String(data?.rideId || data?.id || "");
      if (!/^[0-9a-f-]{36}$/i.test(rideId)) return;
      const driverId = await getDbUserId();
      if (!driverId) return;

      trace(rideId, "offer_delivered_ack", {
        driver_id: driverId,
        channel: data?.channel === "push" ? "push" : "socket",
        offer_id: data?.offerId ?? null,
      });
      await logRideEvent(rideId, driverId, "offer_delivered_ack", {
        channel: data?.channel ?? "socket",
      });
    } catch (err: any) {
      console.warn("offer ack failed:", err?.message);
    }
  });

  // ── Passenger: request ride ──
    socket.on("passenger:ride:request", async (data) => {
      // Clock the rider's tap BEFORE any await, so ms_from_start reflects the real
      // rider-tap -> server-entry cost rather than starting late.
      markRequestReceived(socket);
      try {
        const { pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng, paymentMethod, paymentReference, fare, deviceId, waypoints, stops } = data;
        let dbUserId = await getDbUserId();

        if (!dbUserId) {
          // For testing and race condition safety, use the first available passenger or auto-insert a placeholder
          const fallbackUser = await queryOne<{ id: string }>(
            "SELECT id FROM users WHERE role = 'passenger' OR role = 'rider' LIMIT 1"
          );
          if (fallbackUser) {
            dbUserId = fallbackUser.id;
          } else {
            const newUser = await queryOne<{ id: string }>(
              "INSERT INTO users (email, full_name, firebase_uid, role) VALUES ($1, $2, $3, 'passenger') RETURNING id",
              ["test-rider@vura.com", "Test Rider", socket.userId || "test-fb-uid"]
            );
            dbUserId = newUser?.id;
          }
        }

        if (!dbUserId) {
          throw new Error("Passenger account not synced with database yet. Try again in a moment.");
        }

        // ── Fraud / abuse guard for Pay Later rides ──
        // Server-authoritative, NEVER trust the client: the rider must have an
        // active, non-frozen Pay Later account, the fare must fit the remaining
        // credit, they must not be blacklisted, and they must be under the
        // per-day / per-month velocity caps. Violations block the ride.
        if (paymentMethod === "pay_later") {
          try {
            const acct = await queryOne<any>(
              `SELECT id, status, credit_limit, outstanding, identity_fingerprint
               FROM pay_later_accounts WHERE user_id = $1`,
              [dbUserId]
            );
            const available = acct
              ? Number(acct.credit_limit || 0) - Number(acct.outstanding || 0)
              : 0;
            if (!acct || acct.status !== "active" || available <= 0) {
              socket.emit("ride:requested:ack", {
                success: false,
                reason:
                  "Pay Later is not active on your account or you have no remaining credit. Add a card or repay your balance first.",
              });
              return;
            }
            // Velocity caps — block rapid rebooking / farming.
            const { today = 0, month = 0 } = await queryOne<any>(
              `SELECT
                 COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today,
                 COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('month', CURRENT_DATE))::int AS month
               FROM rides
               WHERE passenger_id = $1 AND payment_method = 'pay_later'`,
              [dbUserId]
            ) || {};
            if ((today || 0) >= 2 || (month || 0) >= 8) {
              socket.emit("ride:requested:ack", {
                success: false,
                reason: "You've reached your Pay Later ride limit. Please repay or use another payment method.",
              });
              return;
            }
            const fareNum = Number(fare ?? 0);
            if (fareNum <= 0 || fareNum > available) {
              socket.emit("ride:requested:ack", {
                success: false,
                reason: `This ride (R${fareNum.toFixed(2)}) exceeds your available Pay Later credit (R${available.toFixed(2)}).`,
              });
              return;
            }
          } catch (e: any) {
            socket.emit("ride:requested:ack", {
              success: false,
              reason: "Pay Later could not be verified. Please try another payment method.",
            });
            return;
          }
        }

        // ── Pre-booking payment (best-effort, non-blocking) ──
        // Ride creation is NEVER blocked by payment so riders can always find
        // a driver. If they have a saved card we pre-authorize it as a safety
        // check; if the check fails (no card, decline) we still create the
        // ride — the real charge happens at pickup. This guarantees drivers
        // always see booking requests.
        let cardChargeRef: string | null = null;
        if (paymentMethod === "card" && fare != null) {
          const amountRands = Number(fare);
          if (amountRands > 0) {
            const card = await getDefaultCardToken(dbUserId).catch(() => null);
            if (!card) {
              // NO SAVED CARD  -  BOOK ANYWAY.
              // This branch used to emit a failure ack and return, so the ride was
              // never created and NO DRIVER WAS EVER OFFERED IT: a card-paying rider
              // could not get a car at all. Payment must never gate dispatch  -  the
              // fare is settled outside the card. Logged, not fatal.
              console.warn(`[preauth] rider ${dbUserId} has no saved card  -  booking ${amountRands} ZAR without a pre-auth`);
            } else {
              const rider = await queryOne<{ email: string }>(
                "SELECT email FROM users WHERE id = $1", [dbUserId]
              ).catch(() => null);
              const reference =
                `VURA${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
              let charge;
              try {
                charge = await chargeAuthorization({
                  amountRands,
                  reference,
                  email: rider?.email || "rider@vura.com",
                  authorizationCode: card.transaction_index,
                });
              } catch (err: any) {
                charge = { success: false, message: err?.message || "Could not process your card." };
              }
              if (!charge?.success) {
                // A DECLINED PRE-AUTH MUST NOT CANCEL THE BOOKING EITHER  -  same trap
                // as above. Record it and let the driver receive the request.
                console.warn(`[preauth] card declined for rider ${dbUserId}: ${charge?.message || "no message"}  -  booking anyway`);
              } else {
                cardChargeRef = reference;
                try {
                  await execute(`
                    CREATE TABLE IF NOT EXISTS payments (
                      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
                      user_id UUID, ride_id UUID,
                      reference VARCHAR(100), amount NUMERIC(10,2),
                      currency VARCHAR(3) DEFAULT 'ZAR', status VARCHAR(20),
                      provider VARCHAR(20), raw_response JSONB,
                      created_at TIMESTAMPTZ DEFAULT NOW(),
                      updated_at TIMESTAMPTZ DEFAULT NOW()
                    )`);
                } catch { /* already exists */ }
                await execute(
                  `INSERT INTO payments (user_id, ride_id, reference, amount, currency, status, provider)
                   VALUES ($1, NULL, $2, $3, 'ZAR', 'completed', 'paystack')`,
                  [dbUserId, reference, amountRands]
                ).catch(() => {});
              }
            }
          }
        }
        // ── Stops between pickup and drop-off ──
        // Accept `waypoints` (current apps) and `stops` (older payloads); each
        // entry is { address, lat, lng }. Stored in rides.waypoints (JSONB) so the
        // stops survive the booking round-trip and can be re-drawn on BOTH maps.
        const rideWaypoints = (Array.isArray(waypoints) ? waypoints : Array.isArray(stops) ? stops : [])
          .filter((w: any) => w && Number.isFinite(Number(w?.lat)) && Number.isFinite(Number(w?.lng)))
          .slice(0, 8)
          .map((w: any) => ({ address: String(w?.address ?? ""), lat: Number(w.lat), lng: Number(w.lng) }));

        // One rider, one live ride: a double-tap on "Confirm" (or a retry after a
        // timeout) must not create two rides that two drivers could each accept.
        const existingActive = await queryOne<{ id: string; status: string }>(
          `SELECT id, status FROM rides
            WHERE passenger_id = $1
              AND status IN ('searching','scheduled','accepted','driver_arrived','in_progress')
            ORDER BY created_at DESC LIMIT 1`,
          [dbUserId]
        ).catch(() => null);
        if (existingActive?.id) {
          socket.emit("ride:requested:ack", {
            success: true,
            rideId: existingActive.id,
            reused: true,
          });
          socket.join(`ride:${existingActive.id}`);
          if (["searching", "scheduled"].includes(existingActive.status)) {
            await offerToNextDriver(io, existingActive.id);
          }
          return;
        }

        // Add the column if this deployment's DB predates it (no-op otherwise).
        // CRITICAL: if the migration cannot run we fall back to the previous
        // 10-column INSERT, so booking can NEVER break because of stops.
        const waypointsReady = await execute(
          `ALTER TABLE rides ADD COLUMN IF NOT EXISTS waypoints JSONB`
        ).then(() => true).catch(() => false);

        const ride = waypointsReady
          ? await queryOne<any>(
              `INSERT INTO rides (passenger_id, pickup_address, pickup_lat, pickup_lng, destination_address, destination_lat, destination_lng, status, estimated_fare, payment_method, device_id, waypoints)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'searching', $8, $9, $10, $11)
               RETURNING *`,
              [dbUserId, pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng, fare != null ? Number(fare) : null, paymentMethod || null, deviceId || null, rideWaypoints.length ? JSON.stringify(rideWaypoints) : null]
            )
          : await queryOne<any>(
              `INSERT INTO rides (passenger_id, pickup_address, pickup_lat, pickup_lng, destination_address, destination_lat, destination_lng, status, estimated_fare, payment_method, device_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7, 'searching', $8, $9, $10)
               RETURNING *`,
              [dbUserId, pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng, fare != null ? Number(fare) : null, paymentMethod || null, deviceId || null]
            );

        // Link the successful card charge to this ride so it can be refunded on cancel.
        if (cardChargeRef) {
          await execute(
            "UPDATE payments SET ride_id = $1, updated_at = NOW() WHERE reference = $2",
            [ride?.id, cardChargeRef]
          ).catch(() => {});
        }
        // Backwards-compatible: also link any hosted-checkout reference provided.
        if (paymentReference) {
          await execute(
            "UPDATE payments SET ride_id = $1, updated_at = NOW() WHERE reference = $2",
            [ride?.id, paymentReference]
          ).catch(() => {});
        }

        traceRequestAndSave(ride?.id ?? null, socket, {
          has_pickup_coords:
            Number.isFinite(Number(pickupLat)) && Number.isFinite(Number(pickupLng)),
        });
        trace(ride?.id ?? null, "trip_saved", { payment_method: paymentMethod || "cash" });
        socket.emit("ride:requested:ack", { success: true, rideId: ride?.id });
        if (ride) socket.join(`ride:${ride.id}`);

        // ── Notify nearby drivers about the new ride ──
        // Find all online drivers and emit ride:request to each one so the
        // first to accept wins.
        (async () => {
          try {
            // Targeted dispatch replaces the old "shout at every online driver"
            // broadcast: services/dispatch.ts offers this ride to the CLOSEST fresh
            // driver only (15s window), then the next one, logging every step.
            const drivers: { id: string; firebase_uid: string | null }[] = [];
            if (ride?.id) void startDispatch(io, ride.id);
            const payload = {
              id: ride?.id,
              pickupAddress,
              pickupLat,
              pickupLng,
              destinationAddress,
              destinationLat,
              destinationLng,
              fare: fare != null ? Number(fare) : 0,
              paymentMethod: paymentMethod || "cash",
              // Stops the rider added (pickup → stops… → drop-off). Both keys are
              // sent so DTOs/normalisers on either app pick them up.
              waypoints: rideWaypoints,
              stops: rideWaypoints,
              riderName: "Rider",
              riderRating: 5,
            };
            for (const driver of drivers || []) {
              if (driver?.firebase_uid) {
                io.to(`user:${driver.firebase_uid}`).emit("ride:request", payload);
              }
            }
            // Fallback: broadcast to the drivers room so any online driver
            // socket that is connected but missed the direct emit still gets it.
            // (no room-wide broadcast: offers are targeted, see services/dispatch.ts)
          } catch (e) {
            console.warn("Failed to notify driver:", e);
          }
          // Update the visible rider-request count for online drivers.
          await broadcastRiderQueue();
        })();
      } catch (err: any) {
        console.error("Ride request error:", err);
        socket.emit("ride:requested:ack", { success: false, reason: err.message });
      }
    });

    // ── Passenger: cancel ride ──
    socket.on("passenger:ride:cancel", async (data) => {
      try {
        const { rideId, reason } = data;

        // Cancellation-fee policy. Read the ride's pre-cancel state so we can
        // decide whether a fee applies (driver was already matched + meaningful
        // time passed). Store it on the row and deduct from any refund.
        const before = await queryOne<{ status: string; accepted_at: Date | null }>(
          "SELECT status, accepted_at FROM rides WHERE id = $1 LIMIT 1",
          [rideId]
        ).catch(() => null);
        const FEE_FLAT_RANDS = 15.0;          // flat cancellation fee (policy)
        const FEE_GRACE_MINUTES = 2;          // no fee if cancelled within 2 min of match
        let fee = 0.0;
        if (before?.status === "accepted" || before?.status === "driver_arrived") {
          let elapsedMin = 0;
          if (before.accepted_at) {
            elapsedMin = (Date.now() - new Date(before.accepted_at).getTime()) / 60000;
          }
          if (elapsedMin > FEE_GRACE_MINUTES) fee = FEE_FLAT_RANDS;
        }

        await execute(
          "UPDATE rides SET status = 'cancelled', cancelled_by = $1, cancel_reason = $2, cancelled_at = NOW(), cancellation_fee = $3 WHERE id = $4 AND status IN ('searching','scheduled','no_drivers','accepted','driver_arrived')",
          [socket.userId, reason, fee, rideId]
        );
        stopServerRideSim(rideId);

        // ── Cancelling while an offer is out ──
        // The driver who was being asked gets told immediately (previously the
        // Accept/Decline card stayed on their screen until they ignored it), and the
        // driver who had accepted goes back to 'available' instead of staying
        // 'on_trip' forever.
        await cancelPendingOffers(io, rideId, "rider_cancelled");
        const assigned = await queryOne<{ driver_id: string | null }>(
          "SELECT driver_id FROM rides WHERE id = $1",
          [rideId]
        ).catch(() => null);
        if (assigned?.driver_id) await releaseDriver(assigned.driver_id);

        // Tell the rider instantly — no waiting on the refund API.
        io.to(`ride:${rideId}`).emit("ride:cancelled", {
          reason,
          cancellation_fee: fee,
          fee_note: fee > 0
            ? `A R${fee.toFixed(2)} cancellation fee applies because a driver was already on the way.`
            : null,
        });

        // Also broadcast to every online driver so pending Accept/Decline
        // cards for this ride disappear immediately (drivers not yet joined
        // to the ride room still see the request card).
        io.to("drivers").emit("ride:cancelled", { rideId, reason });

        // Push "ride cancelled" to the assigned driver (and any driver watching).
        (async () => {
          const drv = await queryOne<{ firebase_uid: string }>(
            "SELECT u.firebase_uid FROM rides r LEFT JOIN users u ON u.id = r.driver_id WHERE r.id = $1",
            [rideId]
          ).catch(() => null);
          if (drv?.firebase_uid) {
            notifyUser(drv.firebase_uid, "Ride cancelled", "The rider cancelled this ride.", { ride_id: rideId }, rideId, "ride_cancelled");
          }
        })();

        // ── Auto-refund (async, non-blocking) ──
        // If the rider cancels, refund the card payment taken at pickup. If a
        // cancellation fee applies, keep the fee and refund the remainder.
        // This runs in the background so the cancel is instant for the rider.
        (async () => {
          try {
            const payment = await queryOne<{ id: string; status: string; reference: string; amount: string }>(
              "SELECT id, status, reference, amount FROM payments WHERE ride_id = $1 AND status = 'completed'",
              [rideId]
            ).catch(() => null);
            if (!payment) return;
            const paid = Number(payment.amount);
            const refundAmount = Math.max(0, paid - fee);
            try {
              if (refundAmount >= 0.01) {
                await refundTransaction(payment.reference, refundAmount);
                console.log(`Refunded R${refundAmount} of Paystack payment ${payment.reference}`);
                await execute(
                  "UPDATE payments SET status = 'refunded', updated_at = NOW() WHERE id = $1",
                  [payment.id]
                ).catch(() => {});
              } else {
                console.log(`Cancellation fee R${fee} covers the full R${paid} — no refund due.`);
              }
            } catch (e) {
              console.warn("Paystack refund failed on cancel:", e);
            }
            io.to(`ride:${rideId}`).emit("ride:refunded", {
              amount: refundAmount >= 0.01 ? refundAmount : null,
              note:
                fee > 0 && refundAmount > 0.01
                  ? `R${refundAmount.toFixed(2)} was refunded (a R${fee.toFixed(2)} cancellation fee applies because a driver was already on the way).`
                  : fee > 0
                    ? `A R${fee.toFixed(2)} cancellation fee applies; the payment is retained for that fee.`
                    : "If your payment was taken, it is being refunded to the same account you paid from.",
            });
          } catch (err) {
            console.error("Async refund error on cancel:", err);
          }
        })();
      } catch (err: any) { console.error("Cancel error:", err); }
    });

    // ── Passenger: update pickup location ──
    socket.on("passenger:ride:update_pickup", async (data) => {
      try {
        const { rideId, address, lat, lng } = data;
        if (!rideId || !address || lat == null || lng == null) {
          socket.emit("ride:pickup:updated:ack", { success: false, error: "Missing pickup details" });
          return;
        }

        const dbUserId = await getDbUserId();
        if (!dbUserId) {
          socket.emit("ride:pickup:updated:ack", { success: false, error: "User not synced" });
          return;
        }

        const ride = await queryOne<any>(
          "SELECT id, status FROM rides WHERE id = $1 AND passenger_id = $2",
          [rideId, dbUserId]
        );
        if (!ride) {
          socket.emit("ride:pickup:updated:ack", { success: false, error: "Ride not found" });
          return;
        }
        if (!["searching", "accepted", "driver_arrived", "in_progress"].includes(ride.status)) {
          socket.emit("ride:pickup:updated:ack", { success: false, error: "Pickup can no longer be updated on this ride" });
          return;
        }

        await execute(
          `UPDATE rides
           SET pickup_address = $1, pickup_lat = $2, pickup_lng = $3, updated_at = NOW()
           WHERE id = $4 AND passenger_id = $5`,
          [address, lat, lng, rideId, dbUserId]
        );

        socket.emit("ride:pickup:updated:ack", { success: true });
        io.to(`ride:${rideId}`).emit("ride:pickup:updated", { address, lat, lng });
      } catch (err: any) {
        console.error("Update pickup socket error:", err);
        socket.emit("ride:pickup:updated:ack", { success: false, error: err.message });
      }
    });

    // ── Chat ──
    socket.on("chat:join", async (data) => {
      try {
        const { rideId } = data;
        if (!rideId) return;
        socket.join(`chat:${rideId}`);
        // Send the existing conversation history so the screen isn't empty.
        await ensureChatTable();
        const history = await query<any>(
          `SELECT cm.id, cm.ride_id, cm.sender_id, cm.message, cm.created_at,
                  COALESCE(u.role, 'rider') AS sender_role
           FROM chat_messages cm
           LEFT JOIN users u ON u.id = cm.sender_id
           WHERE cm.ride_id = $1
           ORDER BY cm.created_at ASC
           LIMIT 200`,
          [rideId]
        );
        socket.emit("chat:history", history);
      } catch (err: any) { console.error("Chat history error:", err); }
    });

    // ── Chat ──
    socket.on("chat:leave", (data) => {
      if (data?.rideId) socket.leave(`chat:${data.rideId}`);
    });

    socket.on("chat:send", async (data) => {
      try {
        const { rideId, message } = data;
        const dbUserId = await getDbUserId();
        if (!dbUserId) throw new Error("User details not synced.");
        if (!message || !String(message).trim()) return;
        await ensureChatTable();
        const msg = await queryOne<any>(
          `INSERT INTO chat_messages (ride_id, sender_id, message)
           VALUES ($1, $2, $3)
           RETURNING id, ride_id, sender_id, message, created_at`,
          [rideId, dbUserId, String(message).trim()]
        );
        io.to(`chat:${rideId}`).emit("chat:message", {
          ...msg,
          sender_role: socket.userRole || "rider",
        });
      } catch (err: any) { console.error("Chat error:", err); }
    });

    // ── Split fare ──
    socket.on("split:invite", async (data) => {
      try {
        const { rideId, inviteeEmail, amount } = data;
        const dbUserId = await getDbUserId();
        if (!dbUserId) throw new Error("User details not synced.");

        const inviter = await queryOne<{ id: string; full_name: string; email: string }>(
          "SELECT id, full_name, email FROM users WHERE id = $1",
          [dbUserId]
        );

        const split = await queryOne<any>(
          `INSERT INTO split_fares (ride_id, inviter_id, invitee_email, amount) VALUES ($1, $2, $3, $4) RETURNING id`,
          [rideId, dbUserId, inviteeEmail, amount]
        );

        const invitee = await queryOne<{ firebase_uid: string }>(
          "SELECT firebase_uid FROM users WHERE email = $1",
          [inviteeEmail]
        );

        if (invitee && split) {
          io.to(`user:${invitee.firebase_uid}`).emit("split:invite", {
            splitId: split.id, rideId,
            inviterName: inviter?.full_name || "Someone",
            inviterEmail: inviter?.email || "",
            amount,
          });
        }
      } catch (err: any) { console.error("Split invite error:", err); }
    });

    socket.on("split:respond", async (data) => {
      try {
        const { splitId, accept } = data;
        const status = accept ? "accepted" : "declined";
        const resp = await queryOne<any>(
          `UPDATE split_fares SET status = $1, invitee_id = $2, updated_at = NOW() WHERE id = $3 RETURNING ride_id, inviter_id`,
          [status, socket.dbUserId, splitId]
        );

        if (resp) {
          const responder = await queryOne<{ full_name: string }>(
            "SELECT full_name FROM users WHERE id = $1", [socket.dbUserId]
          );
          const inviter = await queryOne<{ firebase_uid: string }>(
            "SELECT firebase_uid FROM users WHERE id = $1", [resp.inviter_id]
          );
          if (inviter) {
            io.to(`user:${inviter.firebase_uid}`).emit(
              accept ? "split:accepted" : "split:declined",
              { splitId, inviteeName: responder?.full_name || "Someone" }
            );
          }
        }
      } catch (err: any) { console.error("Split respond error:", err); }
    });

    // ── Safety ──
    socket.on("safety:sos", async (data) => {
      try {
        const { rideId } = data;
        await execute(
          "INSERT INTO safety_events (ride_id, type, data) VALUES ($1, 'sos', $2)",
          [rideId, JSON.stringify({ triggered_by: socket.userId, timestamp: new Date().toISOString() })]
        );
        io.to(`ride:${rideId}`).emit("safety:sos:dispatched", {
          rideId, message: "SOS alert triggered for this ride",
        });
      } catch (err: any) { console.error("SOS error:", err); }
    });

    socket.on("share:generate", async (data) => {
      try {
        const { rideId } = data;
        if (!rideId) return;
        const shareToken = Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
        // Persist the token so the public /share/:token page resolves it. If we
        // only emit it, opening the link 404s because no safety_events row has
        // the token (the shop side must be able to look it up).
        await execute(
          `CREATE TABLE IF NOT EXISTS safety_events (
             id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
             ride_id UUID REFERENCES rides(id),
             type VARCHAR(50) NOT NULL,
             data JSONB,
             created_at TIMESTAMPTZ DEFAULT NOW()
           )`
        ).catch(() => undefined);
        await execute(
          "INSERT INTO safety_events (ride_id, type, data) VALUES ($1, 'share_started', $2)",
          [rideId, JSON.stringify({ shareToken, timestamp: new Date().toISOString() })]
        ).catch(() => undefined);
        io.to(`ride:${rideId}`).emit("share:generated", { rideId, shareToken, shareUrl: `/share/${shareToken}` });
      } catch (err: any) {
        console.error("share:generate error:", err?.message);
      }
    });

    // ── Driver live location (persisted so public share pages can track it) ──
    socket.on("driver:location", async (data) => {
      try {
        const { lat, lng, heading } = data || {};
        if (lat == null || lng == null) return;
        const dbUserId = await getDbUserId();
        if (!dbUserId) return;
        const updated = await execute(
          `UPDATE driver_profiles
           SET current_lat = $1, current_lng = $2,
               current_heading = COALESCE($3, current_heading),
               last_location_at = NOW(),
               last_heartbeat_at = NOW(),
               status = CASE
                 WHEN COALESCE(status, 'offline') = 'offline' AND is_online THEN 'available'
                 ELSE COALESCE(status, 'offline')
               END,
               updated_at = NOW()
           WHERE user_id = $4
           RETURNING status`,
          [lat, lng, heading ?? null, dbUserId]
        );
        // Module 1: mirror the ping into the H3 driver index. Fire-and-forget —
        // an index failure must never drop a GPS update the share page and
        // dispatch fallback both rely on. Every ping re-computes the cell, so
        // the row follows the driver across cell boundaries automatically.
        const statusAfterPing = updated.rows?.[0]?.status as string | undefined;
        if (statusAfterPing) {
          void getDriverIndex()
            .upsert({
              userId: dbUserId,
              lat: Number(lat),
              lng: Number(lng),
              heading: heading ?? null,
              status: statusAfterPing,
            })
            .catch((err) => noteIndexUpsertFailure(dbUserId, err));
        }
        // Broadcast the driver's live position to the rider(s) of any ACTIVE
        // ride this driver is on, so the rider's car follows the real driver
        // (single source of truth — no per-app simulation).
        const activeRide = await queryOne<{ id: string }>(
          `SELECT id FROM rides
           WHERE driver_id = $1 AND status IN ('accepted','driver_arrived','in_progress')
           ORDER BY created_at DESC LIMIT 1`,
          [dbUserId]
        ).catch(() => null);
        if (activeRide?.id) {
          // The driver app is live — tell the server sim to back off so the rider
          // sees ONE car (the driver's real position), not a sim fighting it.
          markDriverLivePing(activeRide.id);
          syncSimToDriver(activeRide.id, Number(lat), Number(lng));
          io.to(`ride:${activeRide.id}`).emit("ride:driver:location", {
            rideId: activeRide.id,
            lat,
            lng,
            bearing: heading ?? 0,
            heading: heading ?? 0,
          });
        }
      } catch (err: any) { console.error("Driver location error:", err); }
    });

    // ── Driver: online/offline status ──
    socket.on("driver:online", async (data) => {
      try {
        const { online } = data || {};
        const dbUserId = await getDbUserId();
        if (!dbUserId) return;
        // Auto-create driver_profiles if missing (first time going online).
        const existing = await queryOne<{ id: string; verification_status: string | null }>(
          "SELECT id, verification_status FROM driver_profiles WHERE user_id = $1",
          [dbUserId]
        ).catch(() => null);
        if (!existing) {
          await execute(
            `INSERT INTO driver_profiles (user_id, is_online, verification_status, status, last_heartbeat_at)
             VALUES ($1, $2, 'approved', $3, NOW())`,
            [dbUserId, online === true, online === true ? "available" : "offline"]
          );
        } else {
          // status drives dispatch: available = offerable, offline = never offered,
          // on_trip = busy. is_online stays in sync for the older code paths.
          await execute(
            `UPDATE driver_profiles
                SET is_online = $1,
                    status = CASE
                      WHEN $1 = FALSE THEN 'offline'
                      WHEN COALESCE(status, 'offline') = 'on_trip' THEN 'on_trip'
                      ELSE 'available'
                    END,
                    last_heartbeat_at = NOW(),
                    updated_at = NOW()
              WHERE user_id = $2`,
            [online === true, dbUserId]
          );
        }
        // Join/leave the drivers room so we can broadcast queue counts.
        if (online === true) {
          socket.join("drivers");
          // Module 1: refresh the index row (status + last position) if we have
          // one — the next driver:location ping re-upserts coords anyway, so a
          // driver who never pinged simply has no row and needs none here.
          void (async () => {
            const prof = await queryOne<{ current_lat: number | null; current_lng: number | null; status: string }>(
              "SELECT current_lat, current_lng, status FROM driver_profiles WHERE user_id = $1",
              [dbUserId]
            ).catch(() => null);
            if (prof?.current_lat != null && prof.current_lng != null) {
              await getDriverIndex().upsert({
                userId: dbUserId,
                lat: Number(prof.current_lat),
                lng: Number(prof.current_lng),
                status: prof.status || "available",
              });
            }
          })().catch((err) => noteIndexUpsertFailure(dbUserId, err));
          await broadcastRiderQueue();
          // A driver just became available: give them any ride that is still waiting
          // (including one parked as 'no_drivers'), instead of making the rider wait
          // for their next booking attempt.
          void reviveWaitingRides(io).catch(() => 0);
        } else {
          socket.leave("drivers");
          // Offline drivers leave the index immediately: a queued offer to a
          // driver who just closed the app is a lost round for the rider.
          void getDriverIndex().remove(dbUserId).catch(() => false);
        }
      } catch (err: any) { console.error("Driver online error:", err); }
    });

    // ── Driver: accept ride request ──
    socket.on("driver:ride:accept", async (data) => {
      try {
        const { rideId, deviceId } = data;
        const dbUserId = await getDbUserId();
        if (!dbUserId) return;
        // Allow accepting both live 'searching' rides AND upcoming 'scheduled'
        // rides so a driver can pre-claim a booking BEFORE the pickup time.
        const ride = await queryOne<{ id: string; passenger_id: string; status: string; estimated_fare: number | null; device_id?: string | null; scheduled_at?: Date }>(
          "SELECT id, passenger_id, status, estimated_fare, device_id, scheduled_at FROM rides WHERE id = $1 AND status IN ('searching','scheduled')",
          [rideId]
        );
        // Stops live in their own column, which an older database may not have —
        // a missing column must never break accepting a ride, so this read is
        // isolated and its failure is swallowed.
        const rideWaypoints = await queryOne<{ waypoints: any }>(
          "SELECT waypoints FROM rides WHERE id = $1", [rideId]
        ).then((r) => (Array.isArray(r?.waypoints) ? r!.waypoints : [])).catch(() => [] as any[]);
        if (!ride) {
          socket.emit("ride:accepted:ack", { success: false, error: "Ride no longer available" });
          return;
        }
        // ── Self-collusion guard ──
        // Block a driver accepting their OWN ride request (same device = one
        // person operating both rider + driver accounts to farm money/rewards).
        if (ride.device_id && deviceId && ride.device_id === deviceId) {
          // Also check the driver's own device history — if this device has
          // ever been used to create a passenger ride, block.
          const driverDeviceUsedAsPassenger = await queryOne<{ id: string }>(
            `SELECT id FROM rides
             WHERE passenger_id = $1 AND device_id = $2
             LIMIT 1`,
            [ride.passenger_id, deviceId]
          ).catch(() => null);
          if (driverDeviceUsedAsPassenger || ride.device_id === deviceId) {
            socket.emit("ride:accepted:ack", {
              success: false,
              error: "You cannot accept this ride from this device.",
            });
            return;
          }
        }
        // ── Atomic claim (this used to be a read-then-write race) ──
        // services/dispatch.acceptRide locks the ride row, verifies this driver's
        // offer is still inside its 15s window, updates with a status guard and
        // promotes the driver to 'on_trip' — all inside ONE transaction. Two drivers
        // accepting at the same instant can no longer both win.
        const claim = await acceptRide(io, { rideId, driverId: dbUserId });
        if (!claim.ok) {
          socket.emit("ride:accepted:ack", {
            success: false,
            error: claim.error || "Ride no longer available",
          });
          return;
        }
        socket.join(`ride:${rideId}`);
        // Notify the rider
        const driver = await queryOne<any>(
          "SELECT u.full_name, dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, dp.license_plate, COALESCE(dp.rating_avg, 0) AS rating_avg FROM users u LEFT JOIN driver_profiles dp ON dp.user_id = u.id WHERE u.id = $1",
          [dbUserId]
        );
        // NOTE: the rider-facing `ride:accepted` event and its push are now emitted
        // by services/dispatch.emitRideAccepted() (single source of truth, carries
        // the ride `version` and is delivered to the user room as well). Removing
        // the old duplicate here stops the rider's phone buzzing twice.
        void driver;
        // Push "driver found" to the rider's devices.
        (async () => {
          const passenger = await queryOne<{ firebase_uid: string }>(
            "SELECT firebase_uid FROM users WHERE id = $1", [ride.passenger_id]
          ).catch(() => null);
          const isScheduled = (ride?.status ?? "") === "scheduled";
          notifyUser(
            passenger?.firebase_uid,
            isScheduled ? "Driver assigned" : "Driver found",
            isScheduled
              ? `${driver?.full_name || "Your driver"} is confirmed for your scheduled ride. They'll pick you up at the booked time.`
              : `${driver?.full_name || "Your driver"} has accepted your ride and is on the way to pick you up.`,
            { ride_id: rideId, scheduled_at: ride?.scheduled_at ? new Date(ride.scheduled_at).toISOString() : undefined },
            rideId,
            "ride_accepted"
          );
        })();
        socket.emit("ride:accepted:ack", { success: true, rideId });
        // A ride was taken — refresh the rider-request count for drivers.
        await broadcastRiderQueue();
      } catch (err: any) {
        console.error("Driver accept error:", err);
        // Surface the failure to the driver app (it would otherwise navigate to a
        // fake trip while the ride stays 'searching' and the rider never gets found).
        try {
          socket.emit("ride:accepted:ack", { success: false, error: "Could not accept this ride right now. Please try again." });
        } catch { /* socket already gone */ }
      }
    });

    // ── Driver: cancel an accepted ride (or release a pre-claimed scheduled ride) ──
    // Uber/Bolt style: when the driver cancels BEFORE pickup, the ride is NOT
    // dead — it goes straight back into the dispatch pool ('searching') so a
    // different driver can accept it, and the driver's cancellation-rate
    // counter is incremented for quality control.
    // ── Driver: decline an offer (or let the 15s countdown do it) ──
    socket.on("driver:ride:decline", async (data: any) => {
      try {
        const { rideId, reason } = data || {};
        const dbUserId = await getDbUserId();
        if (!dbUserId || !rideId) return;
        const res = await declineOffer(io, {
          rideId,
          driverId: dbUserId,
          reason: reason || "declined",
        });
        socket.emit("ride:decline:ack", { success: res.ok, duplicate: res.duplicate === true });
      } catch (err: any) {
        console.error("Driver decline error:", err);
        socket.emit("ride:decline:ack", { success: false, error: "Could not decline right now." });
      }
    });

    // ── Driver: heartbeat ──
    // Cheap liveness beacon the driver app sends every ~10s while online (and on
    // every foreground resume). Without it a force-quit driver stayed "available"
    // forever and absorbed offers that nobody could answer.
    socket.on("driver:heartbeat", async () => {
      try {
        const dbUserId = await getDbUserId();
        if (!dbUserId) return;
        const updated = await execute(
          `UPDATE driver_profiles
              SET last_heartbeat_at = NOW(),
                  status = CASE
                    WHEN COALESCE(status, 'offline') = 'offline' AND is_online THEN 'available'
                    ELSE COALESCE(status, 'offline')
                  END,
                  updated_at = NOW()
            WHERE user_id = $1
        RETURNING status`,
          [dbUserId]
        ).catch(() => undefined);
        // MODULE 1 FIX: the heartbeat must also refresh driver_cells, or a
        // stationary driver (app alive, GPS quiet) is evicted from the index
        // after stale_seconds and vanishes from H3 matching even though
        // driver_profiles still counts them as fresh. Fire-and-forget like
        // every other index write — a failed touch must never break the
        // heartbeat itself.
        const status = (updated?.rows?.[0] as { status?: string } | undefined)?.status;
        if (status !== undefined) {
          void getDriverIndex()
            .touch(dbUserId, status)
            .catch((err) => noteIndexUpsertFailure(dbUserId, err));
        }
      } catch (err: any) {
        console.warn("driver heartbeat failed:", err?.message);
      }
    });

    socket.on("driver:ride:cancel", async (data: any) => {
      try {
        const { rideId, reason } = data || {};
        if (!rideId) return;
        const dbUserId = await getDbUserId();
        if (!dbUserId) return;

        const ride = await queryOne<{ id: string; status: string; passenger_id: string }>(
          "SELECT id, status, passenger_id FROM rides WHERE id = $1 AND driver_id = $2",
          [rideId, dbUserId]
        );
        if (!ride) {
          socket.emit("ride:cancel:ack", { success: false, error: "Ride not found for this driver" });
          return;
        }

        // 1) Increment the driver's cancellation-rate counter.
        try {
          await execute(
            `UPDATE driver_profiles SET cancellations_count = COALESCE(cancellations_count, 0) + 1, updated_at = NOW()
             WHERE user_id = $1`,
            [dbUserId]
          );
        } catch (e) { console.warn("Driver cancel counter update failed:", e); }

        // 2) Pre-pickup states → release back into the dispatch pool for rematch.
        //    A mid-trip cancel (in_progress) is a hard cancel instead.
        // 2) A driver cancel is a HARD cancel for both sides.
        //    The previous code put pre-pickup rides back into the dispatch pool
        //    ("Finding a new driver..."), which left the rider waiting for a driver
        //    they never cancelled and trapped the driver on the trip screen. Now the
        //    ride is cancelled, the rider is told over the socket AND with a push, and
        //    both apps return to their home screens.
        await execute(
          `UPDATE rides SET status = 'cancelled', cancelled_by = $1, cancel_reason = $2, cancelled_at = NOW()
           WHERE id = $3 AND status IN ('scheduled','searching','accepted','driver_arrived','in_progress')`,
          [dbUserId, reason || "Driver cancelled", rideId]
        );
        stopServerRideSim(rideId);
        // Any offer still ringing for this ride stops immediately.
        await cancelPendingOffers(io, rideId, "driver_cancelled");
        await releaseDriver(dbUserId);

        const cancelPayload = { rideId, reason: "Your driver cancelled the trip." };
        // Instant delivery to the ride room (the rider is on the trip screen)...
        io.to(`ride:${rideId}`).emit("ride:cancelled", cancelPayload);
        // ...and to the rider's personal room, which survives a socket reconnect.
        const pax = await queryOne<{ firebase_uid: string }>(
          "SELECT firebase_uid FROM users WHERE id = $1", [ride.passenger_id]
        ).catch(() => null);
        if (pax?.firebase_uid) {
          io.to(`user:${pax.firebase_uid}`).emit("ride:cancelled", cancelPayload);
          notifyUser(pax.firebase_uid, "Ride cancelled", "Your driver cancelled the trip.", { ride_id: rideId }, rideId, "ride_cancelled");
        }
        // Drivers still holding an Accept card for this ride lose it immediately.
        io.to("drivers").emit("ride:cancelled", cancelPayload);
        broadcastRiderQueue().catch(() => {});

        socket.emit("ride:cancel:ack", { success: true, rideId, rematched: false });
      } catch (err: any) {
        console.error("Driver cancel error:", err);
        try { socket.emit("ride:cancel:ack", { success: false, error: "Could not cancel this ride right now." }); } catch {}
      }
    });

    // ── Driver: start trip (arrived at pickup) ──
    socket.on("driver:ride:start", async (data) => {
      try {
        const { rideId } = data;
        const dbUserId = await getDbUserId();
        if (!dbUserId) return;
        const ride = await queryOne<{ id: string; driver_id: string }>(
          "SELECT id, driver_id FROM rides WHERE id = $1 AND driver_id = $2",
          [rideId, dbUserId]
        );
        if (!ride) return;
        await execute("UPDATE rides SET status = 'driver_arrived' WHERE id = $1", [rideId]);
        io.to(`ride:${rideId}`).emit("ride:driver:arrived");
        // Push "driver arrived" to the rider (with the driver's real name + car).
        (async () => {
          const p = await queryOne<any>(
            `SELECT u.firebase_uid AS fb, du.full_name AS driver_name,
                    dp.vehicle_color, dp.vehicle_make, dp.vehicle_model, dp.license_plate
             FROM rides r
             JOIN users u ON u.id = r.passenger_id
             LEFT JOIN users du ON du.id = r.driver_id
             LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
             WHERE r.id = $1`,
            [rideId]
          ).catch(() => null);
          const who = [p?.driver_name, p?.vehicle_color, p?.vehicle_make, p?.vehicle_model]
            .filter(Boolean)
            .join(" ") || "Your driver";
          if (p?.fb) io.to(`user:${p.fb}`).emit("ride:driver:arrived");
          notifyUser(p?.fb, "Driver arrived", `${who} has arrived at your pickup point.`, { ride_id: rideId }, rideId, "driver_arrived");
        })();
      } catch (err: any) { console.error("Driver start error:", err); }
    });

    // ── Driver: begin trip to destination ──
    socket.on("driver:ride:begin", async (data) => {
      try {
        const { rideId } = data;
        const dbUserId = await getDbUserId();
        if (!dbUserId) return;
        const ride = await queryOne<{ id: string; driver_id: string }>(
          "SELECT id, driver_id FROM rides WHERE id = $1 AND driver_id = $2",
          [rideId, dbUserId]
        );
        if (!ride) return;
        await execute("UPDATE rides SET status = 'in_progress' WHERE id = $1", [rideId]);
        io.to(`ride:${rideId}`).emit("ride:started");
        // Redundant delivery to the rider's personal room — survives the rider's
        // ride-room membership being lost (e.g. backgrounded socket reconnect).
        (async () => {
          const p = await queryOne<{ firebase_uid: string }>(
            "SELECT u.firebase_uid FROM rides r JOIN users u ON u.id = r.passenger_id WHERE r.id = $1", [rideId]
          ).catch(() => null);
          if (p?.firebase_uid) io.to(`user:${p.firebase_uid}`).emit("ride:started");
        })();
      } catch (err: any) { console.error("Driver begin error:", err); }
    });

    // ── Driver: complete trip ──
    socket.on("driver:ride:complete", async (data) => {
      try {
        const { rideId } = data;
        const dbUserId = await getDbUserId();
        if (!dbUserId) return;
        const ride = await queryOne<{ id: string; driver_id: string; fare: number }>(
          "SELECT id, driver_id, GREATEST(COALESCE(NULLIF(actual_fare, 0), estimated_fare, 0.20), COALESCE(actual_fare, 0)) AS fare FROM rides WHERE id = $1 AND driver_id = $2",
          [rideId, dbUserId]
        );
        if (!ride) return;
        await execute(
          "UPDATE rides SET status = 'completed', completed_at = NOW(), actual_fare = $1 WHERE id = $2",
          [ride.fare, rideId]
        );
        stopServerRideSim(rideId);
        // Record the driver's earnings so the wallet / pending-earnings
        // endpoint shows the real amount the driver earned from this ride.
        try {
          await execute(
            `INSERT INTO driver_earnings (driver_id, ride_id, gross_amount, fee, net_amount)
             VALUES ($1, $2, $3, 0, $3)`,
            [dbUserId, rideId, ride.fare || 0]
          );
        } catch {}
        io.to(`ride:${rideId}`).emit("ride:completed", { riderTotal: ride.fare || 0 });
        // Driver is free again: straight back into the dispatch pool (status flips
        // to 'available' while they stay online, 'offline' otherwise).
        await releaseDriver(dbUserId);
        // Push "arrived at destination" to the rider.
        (async () => {
          const p = await queryOne<{ firebase_uid: string }>(
            "SELECT u.firebase_uid FROM rides r JOIN users u ON u.id = r.passenger_id WHERE r.id = $1", [rideId]
          ).catch(() => null);
          if (p?.firebase_uid) io.to(`user:${p.firebase_uid}`).emit("ride:completed", { riderTotal: ride.fare || 0 });
          notifyUser(p?.firebase_uid, "Ride complete", "You've arrived at your destination. Thanks for riding with Vura!", { ride_id: rideId }, rideId, "trip_completed");
        })();
      } catch (err: any) { console.error("Driver complete error:", err); }
    });

    socket.on("disconnect", async () => {
      // Heartbeat: a driver who drops off the network stops being a candidate, and
      // any offer they were holding is released so the ride moves to the next driver
      // instead of waiting out the 15s window. A driver mid-trip is left alone —
      // the rider's trip must survive a dropped socket.
      try {
        const dbUserId = socket.dbUserId;
        if (dbUserId) {
          const onTrip = await queryOne<{ id: string }>(
            `SELECT id FROM rides
              WHERE driver_id = $1 AND status IN ('accepted','driver_arrived','in_progress')
              LIMIT 1`,
            [dbUserId]
          ).catch(() => null);
          if (!onTrip) {
            // NOTE: is_online is the driver's INTENT (the app's toggle) and stays as
            // it is — only the dispatch status drops. Flipping is_online here stranded
            // drivers: the shipped APK has no heartbeat and never re-announces, so the
            // server said "offline" forever while the app said "Online", and that
            // driver could never be offered a ride again until they toggled manually.
            await execute(
              `UPDATE driver_profiles
                  SET status = 'offline', updated_at = NOW()
                WHERE user_id = $1`,
              [dbUserId]
            ).catch(() => undefined);
            const released = await query<{ ride_id: string; round: number | null }>(
              `UPDATE ride_offers
                  SET status = 'expired', decline_reason = 'driver_disconnected', updated_at = NOW()
                WHERE status = 'pending' AND driver_id = $1
                RETURNING ride_id, round`,
              [dbUserId]
            ).catch(() => [] as any[]);
            for (const o of released) {
              await logRideEvent(o.ride_id, dbUserId, "offer_driver_disconnected", {});
              const r = await queryOne<{ status: string }>(
                `SELECT status FROM rides WHERE id = $1`,
                [o.ride_id]
              ).catch(() => null);
              if (r && ["searching", "scheduled"].includes(r.status)) {
                await offerToNextDriver(io, o.ride_id, (o.round ?? 1) + 1);
              }
            }
          }
        }
      } catch (err: any) {
        console.warn("disconnect cleanup failed:", err?.message);
      }
      console.log(`🔌 Disconnected: ${socket.id}`);
    });
  });
}
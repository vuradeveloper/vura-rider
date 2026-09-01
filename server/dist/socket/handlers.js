"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupSocketHandlers = setupSocketHandlers;
const firebase_1 = require("../config/firebase");
const database_1 = require("../config/database");
const paystackPayment_1 = require("../services/paystackPayment");
function setupSocketHandlers(io) {
    // Auth middleware
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth?.token;
            if (!token)
                return next(new Error("Authentication required"));
            const decoded = await (0, firebase_1.getAuth)().verifyIdToken(token);
            socket.userId = decoded.uid;
            const user = await (0, database_1.queryOne)("SELECT id, role FROM users WHERE firebase_uid = $1", [decoded.uid]);
            if (user) {
                socket.dbUserId = user.id;
                socket.userRole = user.role;
            }
            next();
        }
        catch {
            next(new Error("Authentication failed"));
        }
    });
    io.on("connection", (rawSocket) => {
        const socket = rawSocket;
        console.log(`🔌 Socket: ${socket.id} (user: ${socket.userId})`);
        if (socket.userId)
            socket.join(`user:${socket.userId}`);
        const getDbUserId = async () => {
            if (socket.dbUserId)
                return socket.dbUserId;
            if (!socket.userId)
                return undefined;
            const user = await (0, database_1.queryOne)("SELECT id FROM users WHERE firebase_uid = $1", [socket.userId]);
            if (user) {
                socket.dbUserId = user.id;
                return user.id;
            }
            return undefined;
        };
        // Ensure the chat messages table exists (best-effort; created on boot too).
        const ensureChatTable = async () => {
            await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS chat_messages (
           id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
           ride_id UUID NOT NULL,
           sender_id UUID NOT NULL,
           message TEXT NOT NULL,
           created_at TIMESTAMPTZ DEFAULT NOW()
         )`).catch((err) => console.warn("chat_messages table init warning:", err.message));
        };
        // ── Passenger: request ride ──
        socket.on("passenger:ride:request", async (data) => {
            try {
                const { pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng, paymentMethod, paymentReference } = data;
                let dbUserId = await getDbUserId();
                if (!dbUserId) {
                    // For testing and race condition safety, use the first available passenger or auto-insert a placeholder
                    const fallbackUser = await (0, database_1.queryOne)("SELECT id FROM users WHERE role = 'passenger' OR role = 'rider' LIMIT 1");
                    if (fallbackUser) {
                        dbUserId = fallbackUser.id;
                    }
                    else {
                        const newUser = await (0, database_1.queryOne)("INSERT INTO users (email, full_name, firebase_uid, role) VALUES ($1, $2, $3, 'passenger') RETURNING id", ["test-rider@vura.com", "Test Rider", socket.userId || "test-fb-uid"]);
                        dbUserId = newUser?.id;
                    }
                }
                if (!dbUserId) {
                    throw new Error("Passenger account not synced with database yet. Try again in a moment.");
                }
                // ── Card payment check ──
                // The rider books with "card" but the charge happens later, when the
                // driver arrives at pickup. So we no longer require a completed payment
                // upfront. If a paymentReference IS provided (e.g. from a hosted
                // checkout), just link it to the ride below.
                if (paymentMethod === "card" && paymentReference) {
                    const payment = await (0, database_1.queryOne)("SELECT id, status, user_id FROM payments WHERE reference = $1", [paymentReference]).catch(() => null);
                    const ok = payment && payment.user_id === dbUserId;
                    if (!ok) {
                        socket.emit("ride:requested:ack", {
                            success: false,
                            reason: "Card payment could not be verified. Ride was not booked.",
                        });
                        return;
                    }
                }
                const ride = await (0, database_1.queryOne)(`INSERT INTO rides (passenger_id, pickup_address, pickup_lat, pickup_lng, destination_address, destination_lat, destination_lng, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'searching')
           RETURNING *`, [dbUserId, pickupAddress, pickupLat, pickupLng, destinationAddress, destinationLat, destinationLng]);
                // Link the successful payment to this ride so it can be refunded on cancel.
                if (paymentReference) {
                    await (0, database_1.execute)("UPDATE payments SET ride_id = $1, updated_at = NOW() WHERE reference = $2", [ride?.id, paymentReference]).catch(() => { });
                }
                socket.emit("ride:requested:ack", { success: true, rideId: ride?.id });
                if (ride)
                    socket.join(`ride:${ride.id}`);
                // ── Notify a nearby driver about the new ride ──
                // Find an online driver and emit ride:request so they can accept.
                (async () => {
                    try {
                        const driver = await (0, database_1.queryOne)(`SELECT u.id, u.firebase_uid FROM users u
               JOIN driver_profiles dp ON dp.user_id = u.id
               WHERE u.role = 'driver' AND dp.is_online = true
               ORDER BY dp.updated_at DESC LIMIT 1`);
                        if (driver?.firebase_uid) {
                            io.to(`user:${driver.firebase_uid}`).emit("ride:request", {
                                id: ride?.id,
                                pickupAddress,
                                pickupLat,
                                pickupLng,
                                destinationAddress,
                                destinationLat,
                                destinationLng,
                                fare: 0,
                                paymentMethod: paymentMethod || "cash",
                                riderName: "Rider",
                                riderRating: 5,
                            });
                        }
                    }
                    catch (e) {
                        console.warn("Failed to notify driver:", e);
                    }
                })();
            }
            catch (err) {
                console.error("Ride request error:", err);
                socket.emit("ride:requested:ack", { success: false, reason: err.message });
            }
        });
        // ── Passenger: cancel ride ──
        socket.on("passenger:ride:cancel", async (data) => {
            try {
                const { rideId, reason } = data;
                await (0, database_1.execute)("UPDATE rides SET status = 'cancelled', cancelled_by = $1, cancel_reason = $2, cancelled_at = NOW() WHERE id = $3", [socket.userId, reason, rideId]);
                // Tell the rider instantly — no waiting on the refund API.
                io.to(`ride:${rideId}`).emit("ride:cancelled", { reason });
                // ── Auto-refund (async, non-blocking) ──
                // If the rider cancels, refund the card payment taken at pickup. This
                // runs in the background so the cancel is instant for the rider.
                (async () => {
                    try {
                        const payment = await (0, database_1.queryOne)("SELECT id, status, reference, amount FROM payments WHERE ride_id = $1 AND status = 'completed'", [rideId]).catch(() => null);
                        if (!payment)
                            return;
                        try {
                            await (0, paystackPayment_1.refundTransaction)(payment.reference, Number(payment.amount));
                            console.log(`Refunded Paystack payment ${payment.reference}`);
                        }
                        catch (e) {
                            console.warn("Paystack refund failed on cancel:", e);
                        }
                        await (0, database_1.execute)("UPDATE payments SET status = 'refunded', updated_at = NOW() WHERE id = $1", [payment.id]).catch(() => { });
                        io.to(`ride:${rideId}`).emit("ride:refunded", { amount: null, note: "Your payment was refunded." });
                    }
                    catch (err) {
                        console.error("Async refund error on cancel:", err);
                    }
                })();
            }
            catch (err) {
                console.error("Cancel error:", err);
            }
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
                const ride = await (0, database_1.queryOne)("SELECT id, status FROM rides WHERE id = $1 AND passenger_id = $2", [rideId, dbUserId]);
                if (!ride) {
                    socket.emit("ride:pickup:updated:ack", { success: false, error: "Ride not found" });
                    return;
                }
                if (!["searching", "accepted", "driver_arrived", "in_progress"].includes(ride.status)) {
                    socket.emit("ride:pickup:updated:ack", { success: false, error: "Pickup can no longer be updated on this ride" });
                    return;
                }
                await (0, database_1.execute)(`UPDATE rides
           SET pickup_address = $1, pickup_lat = $2, pickup_lng = $3, updated_at = NOW()
           WHERE id = $4 AND passenger_id = $5`, [address, lat, lng, rideId, dbUserId]);
                socket.emit("ride:pickup:updated:ack", { success: true });
                io.to(`ride:${rideId}`).emit("ride:pickup:updated", { address, lat, lng });
            }
            catch (err) {
                console.error("Update pickup socket error:", err);
                socket.emit("ride:pickup:updated:ack", { success: false, error: err.message });
            }
        });
        // ── Chat ──
        socket.on("chat:join", async (data) => {
            try {
                const { rideId } = data;
                if (!rideId)
                    return;
                socket.join(`chat:${rideId}`);
                // Send the existing conversation history so the screen isn't empty.
                await ensureChatTable();
                const history = await (0, database_1.query)(`SELECT cm.id, cm.ride_id, cm.sender_id, cm.message, cm.created_at,
                  COALESCE(u.role, 'rider') AS sender_role
           FROM chat_messages cm
           LEFT JOIN users u ON u.id = cm.sender_id
           WHERE cm.ride_id = $1
           ORDER BY cm.created_at ASC
           LIMIT 200`, [rideId]);
                socket.emit("chat:history", history);
            }
            catch (err) {
                console.error("Chat history error:", err);
            }
        });
        // ── Chat ──
        socket.on("chat:leave", (data) => {
            if (data?.rideId)
                socket.leave(`chat:${data.rideId}`);
        });
        socket.on("chat:send", async (data) => {
            try {
                const { rideId, message } = data;
                const dbUserId = await getDbUserId();
                if (!dbUserId)
                    throw new Error("User details not synced.");
                if (!message || !String(message).trim())
                    return;
                await ensureChatTable();
                const msg = await (0, database_1.queryOne)(`INSERT INTO chat_messages (ride_id, sender_id, message)
           VALUES ($1, $2, $3)
           RETURNING id, ride_id, sender_id, message, created_at`, [rideId, dbUserId, String(message).trim()]);
                io.to(`chat:${rideId}`).emit("chat:message", {
                    ...msg,
                    sender_role: socket.userRole || "rider",
                });
            }
            catch (err) {
                console.error("Chat error:", err);
            }
        });
        // ── Split fare ──
        socket.on("split:invite", async (data) => {
            try {
                const { rideId, inviteeEmail, amount } = data;
                const dbUserId = await getDbUserId();
                if (!dbUserId)
                    throw new Error("User details not synced.");
                const inviter = await (0, database_1.queryOne)("SELECT id, full_name, email FROM users WHERE id = $1", [dbUserId]);
                const split = await (0, database_1.queryOne)(`INSERT INTO split_fares (ride_id, inviter_id, invitee_email, amount) VALUES ($1, $2, $3, $4) RETURNING id`, [rideId, dbUserId, inviteeEmail, amount]);
                const invitee = await (0, database_1.queryOne)("SELECT firebase_uid FROM users WHERE email = $1", [inviteeEmail]);
                if (invitee && split) {
                    io.to(`user:${invitee.firebase_uid}`).emit("split:invite", {
                        splitId: split.id, rideId,
                        inviterName: inviter?.full_name || "Someone",
                        inviterEmail: inviter?.email || "",
                        amount,
                    });
                }
            }
            catch (err) {
                console.error("Split invite error:", err);
            }
        });
        socket.on("split:respond", async (data) => {
            try {
                const { splitId, accept } = data;
                const status = accept ? "accepted" : "declined";
                const resp = await (0, database_1.queryOne)(`UPDATE split_fares SET status = $1, invitee_id = $2, updated_at = NOW() WHERE id = $3 RETURNING ride_id, inviter_id`, [status, socket.dbUserId, splitId]);
                if (resp) {
                    const responder = await (0, database_1.queryOne)("SELECT full_name FROM users WHERE id = $1", [socket.dbUserId]);
                    const inviter = await (0, database_1.queryOne)("SELECT firebase_uid FROM users WHERE id = $1", [resp.inviter_id]);
                    if (inviter) {
                        io.to(`user:${inviter.firebase_uid}`).emit(accept ? "split:accepted" : "split:declined", { splitId, inviteeName: responder?.full_name || "Someone" });
                    }
                }
            }
            catch (err) {
                console.error("Split respond error:", err);
            }
        });
        // ── Safety ──
        socket.on("safety:sos", async (data) => {
            try {
                const { rideId } = data;
                await (0, database_1.execute)("INSERT INTO safety_events (ride_id, type, data) VALUES ($1, 'sos', $2)", [rideId, JSON.stringify({ triggered_by: socket.userId, timestamp: new Date().toISOString() })]);
                io.to(`ride:${rideId}`).emit("safety:sos:dispatched", {
                    rideId, message: "SOS alert triggered for this ride",
                });
            }
            catch (err) {
                console.error("SOS error:", err);
            }
        });
        socket.on("share:generate", async (data) => {
            const { rideId } = data;
            const shareToken = Math.random().toString(36).substring(2, 15);
            io.to(`ride:${rideId}`).emit("share:generated", { rideId, shareToken, shareUrl: `/share/${shareToken}` });
        });
        // ── Driver live location (persisted so public share pages can track it) ──
        socket.on("driver:location", async (data) => {
            try {
                const { lat, lng, heading } = data || {};
                if (lat == null || lng == null)
                    return;
                const dbUserId = await getDbUserId();
                if (!dbUserId)
                    return;
                await (0, database_1.execute)(`UPDATE driver_profiles
           SET current_lat = $1, current_lng = $2,
               current_heading = COALESCE($3, current_heading),
               updated_at = NOW()
           WHERE user_id = $4`, [lat, lng, heading ?? null, dbUserId]);
            }
            catch (err) {
                console.error("Driver location error:", err);
            }
        });
        // ── Driver: online/offline status ──
        socket.on("driver:online", async (data) => {
            try {
                const { online } = data || {};
                const dbUserId = await getDbUserId();
                if (!dbUserId)
                    return;
                // Auto-create driver_profiles if missing (first time going online).
                const existing = await (0, database_1.queryOne)("SELECT id FROM driver_profiles WHERE user_id = $1", [dbUserId]).catch(() => null);
                if (!existing) {
                    await (0, database_1.execute)(`INSERT INTO driver_profiles (user_id, is_online) VALUES ($1, $2)`, [dbUserId, online === true]);
                }
                else {
                    await (0, database_1.execute)(`UPDATE driver_profiles SET is_online = $1, updated_at = NOW() WHERE user_id = $2`, [online === true, dbUserId]);
                }
            }
            catch (err) {
                console.error("Driver online error:", err);
            }
        });
        // ── Driver: accept ride request ──
        socket.on("driver:ride:accept", async (data) => {
            try {
                const { rideId } = data;
                const dbUserId = await getDbUserId();
                if (!dbUserId)
                    return;
                const ride = await (0, database_1.queryOne)("SELECT id, passenger_id, status FROM rides WHERE id = $1 AND status = 'searching'", [rideId]);
                if (!ride) {
                    socket.emit("ride:accepted:ack", { success: false, error: "Ride no longer available" });
                    return;
                }
                await (0, database_1.execute)("UPDATE rides SET driver_id = $1, status = 'accepted' WHERE id = $2", [dbUserId, rideId]);
                socket.join(`ride:${rideId}`);
                // Notify the rider
                const driver = await (0, database_1.queryOne)("SELECT u.full_name, dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, dp.license_plate FROM users u LEFT JOIN driver_profiles dp ON dp.user_id = u.id WHERE u.id = $1", [dbUserId]);
                io.to(`ride:${rideId}`).emit("ride:accepted", {
                    id: rideId,
                    driver_name: driver?.full_name || "Driver",
                    vehicle_color: driver?.vehicle_color,
                    vehicle_make: driver?.vehicle_make,
                    vehicle_model: driver?.vehicle_model,
                    driver_license_plate: driver?.license_plate,
                });
                socket.emit("ride:accepted:ack", { success: true, rideId });
            }
            catch (err) {
                console.error("Driver accept error:", err);
            }
        });
        // ── Driver: start trip (arrived at pickup) ──
        socket.on("driver:ride:start", async (data) => {
            try {
                const { rideId } = data;
                const dbUserId = await getDbUserId();
                if (!dbUserId)
                    return;
                const ride = await (0, database_1.queryOne)("SELECT id, driver_id FROM rides WHERE id = $1 AND driver_id = $2", [rideId, dbUserId]);
                if (!ride)
                    return;
                await (0, database_1.execute)("UPDATE rides SET status = 'driver_arrived' WHERE id = $1", [rideId]);
                io.to(`ride:${rideId}`).emit("ride:driver:arrived");
            }
            catch (err) {
                console.error("Driver start error:", err);
            }
        });
        // ── Driver: begin trip to destination ──
        socket.on("driver:ride:begin", async (data) => {
            try {
                const { rideId } = data;
                const dbUserId = await getDbUserId();
                if (!dbUserId)
                    return;
                const ride = await (0, database_1.queryOne)("SELECT id, driver_id FROM rides WHERE id = $1 AND driver_id = $2", [rideId, dbUserId]);
                if (!ride)
                    return;
                await (0, database_1.execute)("UPDATE rides SET status = 'in_progress' WHERE id = $1", [rideId]);
                io.to(`ride:${rideId}`).emit("ride:started");
            }
            catch (err) {
                console.error("Driver begin error:", err);
            }
        });
        // ── Driver: complete trip ──
        socket.on("driver:ride:complete", async (data) => {
            try {
                const { rideId } = data;
                const dbUserId = await getDbUserId();
                if (!dbUserId)
                    return;
                const ride = await (0, database_1.queryOne)("SELECT id, driver_id, fare FROM rides WHERE id = $1 AND driver_id = $2", [rideId, dbUserId]);
                if (!ride)
                    return;
                await (0, database_1.execute)("UPDATE rides SET status = 'completed', completed_at = NOW() WHERE id = $1", [rideId]);
                io.to(`ride:${rideId}`).emit("ride:completed", { riderTotal: ride.fare || 0 });
            }
            catch (err) {
                console.error("Driver complete error:", err);
            }
        });
        socket.on("disconnect", () => {
            console.log(`🔌 Disconnected: ${socket.id}`);
        });
    });
}
//# sourceMappingURL=handlers.js.map
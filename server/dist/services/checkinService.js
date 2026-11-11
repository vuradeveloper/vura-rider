"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendCheckin = sendCheckin;
exports.respondCheckin = respondCheckin;
exports.timeoutCheckins = timeoutCheckins;
const database_1 = require("../config/database");
const safetyConfig_1 = require("./safetyConfig");
const sosService_1 = require("./sosService");
const safetyNotify_1 = require("./safetyNotify");
const TYPE_LABEL = {
    deviation: "your driver may be off the expected route",
    long_stop: "your trip has been stationary for a while",
    overrun: "your trip is taking much longer than expected",
    gps_silence: "we stopped receiving your trip's location",
};
/** Send the prompt for a fresh anomaly (skips if one is already pending). */
async function sendCheckin(io, rideId, anomalyId, type) {
    try {
        await (0, safetyConfig_1.ensureSafetyTables)();
        const pending = await (0, database_1.queryOne)("SELECT id FROM ride_checkins WHERE ride_id = $1 AND status = 'pending' LIMIT 1", [rideId]).catch(() => null);
        if (pending)
            return;
        const cfg = await (0, safetyConfig_1.getSafetySettings)();
        const resp = await (0, database_1.queryOne)(`SELECT u.id, u.firebase_uid, u.full_name FROM rides r
        JOIN users u ON u.id = r.passenger_id WHERE r.id = $1`, [rideId]).catch(() => null);
        await (0, database_1.execute)(`INSERT INTO ride_checkins (ride_id, anomaly_id, respond_by)
       VALUES ($1, $2, NOW() + make_interval(secs => $3::int))`, [rideId, anomalyId, cfg.checkin_timeout_s]);
        if (anomalyId) {
            await (0, database_1.execute)("UPDATE ride_anomalies SET status = 'checkin_sent' WHERE id = $1 AND status = 'new'", [anomalyId]).catch(() => { });
        }
        const reason = TYPE_LABEL[type] || "something unusual was detected";
        const message = `Is everything okay? On your trip, ${reason}.`;
        if (resp?.firebase_uid) {
            io.to(`user:${resp.firebase_uid}`).emit("safety:checkin", {
                ride_id: rideId,
                respond_by: new Date(Date.now() + cfg.checkin_timeout_s * 1000).toISOString(),
                type,
                message,
            });
            io.to(`ride:${rideId}`).emit("safety:checkin", { ride_id: rideId, type, message });
            // FCM so a backgrounded phone still wakes up.
            const { sendPushToUsers } = await Promise.resolve().then(() => __importStar(require("./notify")));
            void sendPushToUsers([resp.id], {
                type: "safety_checkin",
                title: "Is everything okay?",
                body: `${message} Tap to confirm you're safe.`,
                rideId,
                highPriority: true,
                data: { ride_id: rideId, action: "checkin" },
            }).catch(() => { });
        }
        console.log(`[safety] check-in sent ride=${rideId} type=${type}`);
    }
    catch (err) {
        console.warn("[safety] sendCheckin failed:", err?.message || err);
    }
}
/**
 * The rider's answer. 'safe' closes the anomaly; 'sos' supersedes it with a
 * full SOS alert (enriched payload) — both stop the escalation clock.
 */
async function respondCheckin(io, rideId, riderId, response) {
    await (0, safetyConfig_1.ensureSafetyTables)();
    const ride = await (0, database_1.queryOne)("SELECT passenger_id FROM rides WHERE id = $1", [rideId]).catch(() => null);
    if (!ride || ride.passenger_id !== riderId)
        return { ok: false, error: "Not your ride" };
    const pending = await (0, database_1.queryOne)(`SELECT id, anomaly_id FROM ride_checkins
      WHERE ride_id = $1 AND status = 'pending'
      ORDER BY sent_at DESC LIMIT 1`, [rideId]).catch(() => null);
    if (!pending)
        return { ok: false, error: "No pending check-in" };
    await (0, database_1.execute)(`UPDATE ride_checkins SET status = 'answered', response = $2, responded_at = NOW()
      WHERE id = $1`, [pending.id, response]);
    if (response === "safe") {
        if (pending.anomaly_id) {
            await (0, database_1.execute)("UPDATE ride_anomalies SET status = 'safe', handled_at = NOW(), note = 'rider confirmed safe' WHERE id = $1", [pending.anomaly_id]).catch(() => { });
        }
        io.to(`ride:${rideId}`).emit("safety:checkin:answered", { ride_id: rideId, response });
        return { ok: true };
    }
    // 'sos' — escalate for real.
    if (pending.anomaly_id) {
        await (0, database_1.execute)("UPDATE ride_anomalies SET status = 'escalated', note = 'rider pressed SOS from check-in' WHERE id = $1", [pending.anomaly_id]).catch(() => { });
    }
    const sos = await (0, sosService_1.triggerSos)({ rideId, byUserId: riderId, byRole: "rider" });
    return { ok: true, sos };
}
/** Deadline pass: pending check-ins nobody answered → admin alert. */
async function timeoutCheckins() {
    await (0, safetyConfig_1.ensureSafetyTables)();
    const overdue = await (0, database_1.query)(`SELECT id, ride_id, anomaly_id FROM ride_checkins
      WHERE status = 'pending' AND respond_by < NOW()`).catch(() => []);
    for (const c of overdue) {
        await (0, database_1.execute)("UPDATE ride_checkins SET status = 'escalated' WHERE id = $1", [c.id]);
        if (c.anomaly_id) {
            await (0, database_1.execute)("UPDATE ride_anomalies SET status = 'escalated', handled_at = NOW(), note = 'no rider response before deadline' WHERE id = $1", [c.anomaly_id]).catch(() => { });
        }
        await (0, database_1.execute)("INSERT INTO safety_events (ride_id, type, data) VALUES ($1, 'checkin_escalated', $2)", [c.ride_id, JSON.stringify({ checkin_id: c.id, at: new Date().toISOString() })]).catch(() => { });
        // The console queue is the responder, but an unopened tab is not an alert.
        // Email the on-call inbox with the route, both people and a live trip link.
        const detail = await (0, database_1.queryOne)(`SELECT r.pickup_address, r.destination_address,
              pu.full_name AS rider_name, pu.phone AS rider_phone,
              du.full_name AS driver_name, du.phone AS driver_phone,
              dp.license_plate
         FROM rides r
         LEFT JOIN users pu ON pu.id = r.passenger_id
         LEFT JOIN users du ON du.id = r.driver_id
         LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
        WHERE r.id = $1`, [c.ride_id]).catch(() => null);
        const token = await (0, sosService_1.ensureShareToken)(c.ride_id).catch(() => null);
        void (0, safetyNotify_1.notifyCheckinTimeout)({
            rideId: c.ride_id,
            payload: {
                triggered_at: new Date().toISOString(),
                role: "rider",
                ride_id: c.ride_id,
                checkin_id: c.id,
                pickup_address: detail?.pickup_address ?? null,
                destination_address: detail?.destination_address ?? null,
                rider: { name: detail?.rider_name ?? null, phone: detail?.rider_phone ?? null },
                driver: {
                    name: detail?.driver_name ?? null,
                    phone: detail?.driver_phone ?? null,
                    plate: detail?.license_plate ?? null,
                },
            },
            shareUrl: token ? `${(0, sosService_1.publicBaseUrl)()}/share/${token}` : null,
        }).catch(() => undefined);
        console.error(`🚨 [safety] CHECK-IN NO RESPONSE — ride ${c.ride_id} (admin team alerted)`);
    }
    return overdue.map((c) => c.ride_id);
}
//# sourceMappingURL=checkinService.js.map
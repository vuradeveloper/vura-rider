"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPaymentEvidence = buildPaymentEvidence;
const database_1 = require("../config/database");
const fareFees_1 = require("./fareFees");
const identity_1 = require("../lib/identity");
function iso(value) {
    if (!value)
        return null;
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function money(value) {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function fareBreakdownFor(ride) {
    const fare = money(ride?.actual_fare ?? ride?.captured_amount ?? ride?.estimated_fare);
    if (!fare)
        return null;
    return (0, fareFees_1.rideFareBreakdown)(fare);
}
async function buildPaymentEvidence(reference) {
    const ref = String(reference || "").trim();
    if (!ref)
        return null;
    const row = await (0, database_1.queryOne)(`SELECT p.reference, p.amount, p.currency, p.status, p.provider, p.ride_id,
            p.created_at, p.updated_at, p.raw_response,
            u.id AS rider_id, u.full_name AS rider_name, u.email AS rider_email,
            u.phone AS rider_phone, u.created_at AS rider_created_at
       FROM payments p
       LEFT JOIN users u ON u.id = p.user_id
      WHERE p.reference = $1
      ORDER BY p.created_at DESC
      LIMIT 1`, [ref]).catch(() => null);
    if (!row)
        return null;
    const ride = row.ride_id
        ? await (0, database_1.queryOne)(`SELECT r.id, r.status, r.pickup_address, r.destination_address,
                r.pickup_lat, r.pickup_lng, r.destination_lat, r.destination_lng,
                r.distance_km, r.duration_mins, r.estimated_fare, r.actual_fare,
                r.platform_fee, r.payment_status, r.payment_method,
                r.created_at, r.accepted_at, r.completed_at, r.cancelled_at,
                r.cancelled_by, r.cancel_reason,
                r.preauth_reference, r.captured_amount, r.booking_fee_cents,
                r.platform_share_cents, r.split_applied, r.card_auth_code,
                r.promo_code, r.promo_discount, r.device_id,
                r.driver_id,
                du.full_name AS driver_name, du.phone AS driver_phone,
                dp.vehicle_make, dp.vehicle_model, dp.license_plate
           FROM rides r
           LEFT JOIN users du ON du.id = r.driver_id
           LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
          WHERE r.id = $1
          LIMIT 1`, [row.ride_id]).catch(() => null)
        : null;
    const raw = row.raw_response || {};
    const auth = raw?.authorization || {};
    // The card that actually paid is the one whose authorization code is stamped
    // on the ride. Fall back to Paystack's own response for that charge — NOT the
    // rider's current default card, which may be a different card entirely.
    const cardToken = ride?.card_auth_code || null;
    const storedCard = cardToken
        ? await (0, database_1.queryOne)(`SELECT card_type, last4, bank, exp_month, exp_year, signature
           FROM saved_cards
          WHERE user_id = $1 AND transaction_index = $2
          ORDER BY is_default DESC, created_at DESC
          LIMIT 1`, [row.rider_id, cardToken]).catch(() => null)
        : null;
    const card = storedCard ||
        (auth?.last4
            ? {
                card_type: auth.brand || null,
                last4: auth.last4,
                bank: auth.bank || null,
                exp_month: auth.exp_month || null,
                exp_year: auth.exp_year || null,
                signature: null,
            }
            : null);
    const timeline = await (0, database_1.query)(`SELECT event, received_at,
            data->>'reference' AS reference,
            data->>'amount' AS amount,
            data->>'status' AS status
       FROM paystack_webhook_events
      WHERE data->>'reference' = $1
      ORDER BY received_at ASC
      LIMIT 100`, [ref]).catch(() => []);
    const paystack = {
        gateway_response: raw?.gateway_response || null,
        channel: raw?.channel || null,
        paid_at: raw?.paid_at || null,
        fees: raw?.fees != null ? Number(raw.fees) / 100 : null,
        ip_address: raw?.ip_address || null,
        card_brand: auth?.brand || null,
        card_bin: auth?.bin || null,
        card_last4: auth?.last4 || null,
        card_exp: auth?.exp_month && auth?.exp_year ? `${auth.exp_month}/${auth.exp_year}` : null,
        reusable: auth?.reusable ?? null,
    };
    const fare = fareBreakdownFor(ride);
    const summary = [];
    if (row.rider_name) {
        summary.push(`Rider ${row.rider_name} booked a trip on ${iso(ride?.created_at || row.created_at) || "an unknown date"}.`);
    }
    if (ride?.pickup_address || ride?.destination_address) {
        summary.push(`Route: ${ride.pickup_address || "—"} → ${ride.destination_address || "—"}.`);
    }
    if (ride?.driver_name) {
        summary.push(`Driver ${ride.driver_name}${ride.license_plate ? ` (${ride.license_plate})` : ""} accepted the trip${iso(ride.accepted_at) ? ` at ${iso(ride.accepted_at)}` : ""}.`);
    }
    if (ride?.status) {
        summary.push(`Trip status: ${ride.status}${iso(ride.completed_at) ? `, completed at ${iso(ride.completed_at)}` : ""}${iso(ride.cancelled_at) ? `, cancelled at ${iso(ride.cancelled_at)}` : ""}.`);
    }
    if (ride?.distance_km != null || ride?.duration_mins != null) {
        summary.push(`Recorded distance/duration: ${ride.distance_km ?? "—"} km / ${ride.duration_mins ?? "—"} min.`);
    }
    if (fare) {
        summary.push(`Fare R${(fare.fare_cents / 100).toFixed(2)} + 4% booking fee R${(fare.booking_fee_cents / 100).toFixed(2)} = rider total R${(fare.rider_total_cents / 100).toFixed(2)}.`);
    }
    summary.push(`Payment ${row.status || "unknown"} for R${money(row.amount).toFixed(2)} ${row.currency || "ZAR"}${row.reference ? `, Paystack reference ${row.reference}` : ""}.`);
    if (card?.last4) {
        summary.push(`Card ${card.card_type || "card"} ending ${card.last4}${card.bank ? ` (${card.bank})` : ""}${card.signature ? `, fingerprint ${card.signature}` : ""}.`);
    }
    if (ride?.promo_code) {
        summary.push(`Promo ${ride.promo_code} applied, discount R${money(ride.promo_discount).toFixed(2)}.`);
    }
    if (ride?.preauth_reference) {
        summary.push(`Preauthorization hold ${ride.preauth_reference}${ride.captured_amount != null ? `, captured R${money(ride.captured_amount).toFixed(2)}` : ""}.`);
    }
    if (timeline.length) {
        summary.push(`${timeline.length} verified Paystack webhook event(s) recorded for this reference.`);
    }
    return {
        generated_at: new Date().toISOString(),
        reference: ref,
        payment: {
            reference: row.reference,
            amount: money(row.amount),
            currency: row.currency || "ZAR",
            status: row.status,
            provider: row.provider,
            ride_id: row.ride_id || null,
            created_at: iso(row.created_at),
            updated_at: iso(row.updated_at),
        },
        rider: row.rider_id
            ? {
                id: row.rider_id,
                name: row.rider_name || null,
                email: row.rider_email ? (0, identity_1.maskEmail)(row.rider_email) : null,
                phone: row.rider_phone ? (0, identity_1.maskPhone)(row.rider_phone) : null,
                account_created_at: iso(row.rider_created_at),
            }
            : null,
        ride: ride
            ? (() => {
                // Never expose the Paystack authorization code: it can charge the
                // card again. The last4/fingerprint below is enough evidence.
                const { card_auth_code: _token, ...safe } = ride;
                return {
                    ...safe,
                    driver_phone: ride.driver_phone ? (0, identity_1.maskPhone)(ride.driver_phone) : null,
                };
            })()
            : null,
        fare,
        card: card
            ? {
                brand: card.card_type || null,
                last4: card.last4 || null,
                bank: card.bank || null,
                exp_month: card.exp_month != null ? Number(card.exp_month) : null,
                exp_year: card.exp_year != null ? Number(card.exp_year) : null,
                fingerprint: card.signature || null,
            }
            : null,
        paystack,
        timeline: timeline.map((event) => ({
            event: event.event,
            received_at: iso(event.received_at) || String(event.received_at),
            reference: event.reference,
            amount: event.amount,
            status: event.status,
        })),
        summary,
    };
}
//# sourceMappingURL=paymentEvidence.js.map
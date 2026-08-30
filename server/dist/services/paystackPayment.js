"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// Paystack hosted-payment adapter — SERVER-SIDE ONLY.
//
// Card registration:
//   1. POST /api/payments/card-register  → initializeTransaction() → returns an
//      authorization_url. The app opens it in a WebView; the rider enters card
//      details on Paystack's PCI-compliant page — never on our server.
//   2. Paystack redirects the browser to PAYSTACK_CALLBACK_URL with
//      ?reference=..., which the app's WebView intercepts.
//   3. GET /api/payments/verify?reference=... → verifyTransaction() returns the
//      transaction + reusable authorization.authorization_code, which we store
//      on the user's saved card as its token.
//
// Ride payment (card-on-file):
//   POST /api/payments/initiate → chargeAuthorization() charges the saved card
//   using the stored authorization_code. No re-entry of card details.
//
// Refunds:
//   POST /api/payments/refund → refundTransaction() reverses a Paystack charge.
//
// Credentials (server/.env, gitignored):
//   PAYMENTS_MODE         = mock | sandbox | live
//   PAYSTACK_SECRET_TEST  = secret key for the TEST (sandbox) Paystack business
//   PAYSTACK_SECRET_LIVE  = secret key for the LIVE Paystack business
//   PAYSTACK_CALLBACK_URL = redirect-back URL on this server, e.g.
//                           https://ridevura.com/api/payments/return
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentsMode = paymentsMode;
exports.paystackConfig = paystackConfig;
exports.isPaystackConfigured = isPaystackConfigured;
exports.initializeTransaction = initializeTransaction;
exports.verifyTransaction = verifyTransaction;
exports.chargeAuthorization = chargeAuthorization;
exports.refundTransaction = refundTransaction;
const PAYSTACK_BASE_URL = "https://api.paystack.co";
function paymentsMode() {
    const mode = process.env.PAYMENTS_MODE;
    if (mode === "sandbox" || mode === "live")
        return mode;
    return "mock";
}
function paystackConfig() {
    return {
        secretKey: paymentsMode() === "live"
            ? process.env.PAYSTACK_SECRET_LIVE || ""
            : process.env.PAYSTACK_SECRET_TEST || "",
        callbackUrl: process.env.PAYSTACK_CALLBACK_URL || "",
        baseUrl: PAYSTACK_BASE_URL,
    };
}
function isPaystackConfigured() {
    return Boolean(paystackConfig().secretKey);
}
async function paystackFetch(path, init = {}) {
    const cfg = paystackConfig();
    const res = await fetch(`${cfg.baseUrl}${path}`, {
        ...init,
        headers: {
            Authorization: `Bearer ${cfg.secretKey}`,
            "Content-Type": "application/json",
            ...(init.headers || {}),
        },
    });
    const json = (await res.json().catch(() => ({})));
    if (!res.ok || json.status === false) {
        throw new Error(`Paystack ${init.method || "GET"} ${path} failed: ${json.message || res.statusText || res.status}`);
    }
    return json;
}
/**
 * Creates a Paystack hosted-checkout transaction (card registration / one-off
 * payment). Returns the authorization_url for the WebView. In mock mode it
 * returns a fake URL so the UI can be tested end-to-end.
 */
async function initializeTransaction(input) {
    const cfg = paystackConfig();
    if (paymentsMode() === "mock") {
        return {
            reference: input.reference,
            authorizationUrl: cfg.callbackUrl
                ? `${cfg.callbackUrl}?reference=${input.reference}&result=success`
                : "",
            live: false,
        };
    }
    if (!isPaystackConfigured()) {
        throw new Error("Paystack is not configured. Add PAYSTACK_SECRET_TEST/LIVE and PAYSTACK_CALLBACK_URL to server/.env.");
    }
    const data = await paystackFetch("/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
            email: input.email || "rider@vura.com",
            amount: Math.round(input.amountRands * 100),
            reference: input.reference,
            currency: "ZAR",
            callback_url: cfg.callbackUrl || undefined,
        }),
    });
    return {
        reference: input.reference,
        authorizationUrl: data?.data?.authorization_url || "",
        live: paymentsMode() === "live",
    };
}
/**
 * Verifies a Paystack transaction. Returns the reusable authorization token
 * (authorization_code) plus the card details. Throws if Paystack is unreachable.
 */
async function verifyTransaction(reference) {
    if (paymentsMode() === "mock") {
        return {
            reference,
            status: "success",
            amountPaidRands: 1,
            authorization: {
                authorization_code: `MOCK_${reference.slice(-12)}`,
                last4: "4242",
                exp_month: 12,
                exp_year: 2030,
                card_type: "visa",
                bank: "MOCK BANK",
                bin: "408408",
                brand: "visa",
                reusable: true,
            },
        };
    }
    if (!isPaystackConfigured()) {
        throw new Error("Paystack is not configured.");
    }
    const data = await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`);
    const tx = data?.data;
    if (!tx)
        return null;
    const auth = tx.authorization;
    return {
        reference: tx.reference,
        status: tx.status,
        amountPaidRands: (tx.amount || 0) / 100,
        authorization: auth
            ? {
                authorization_code: auth.authorization_code,
                last4: auth.last4,
                exp_month: auth.exp_month,
                exp_year: auth.exp_year,
                card_type: auth.card_type,
                bank: auth.bank,
                bin: auth.bin,
                brand: auth.brand,
                reusable: Boolean(auth.reusable),
            }
            : undefined,
    };
}
/**
 * Charges a previously-tokenised card using its authorization_code.
 * Resolves to true on success, false when the bank declined/insufficient funds.
 */
async function chargeAuthorization(input) {
    if (paymentsMode() === "mock") {
        return {
            success: true,
            status: "success",
            message: "Mock payment approved",
            amountChargedRands: input.amountRands,
        };
    }
    if (!isPaystackConfigured()) {
        throw new Error("Paystack is not configured.");
    }
    const data = await paystackFetch("/transaction/charge_authorization", {
        method: "POST",
        body: JSON.stringify({
            email: input.email,
            amount: Math.round(input.amountRands * 100),
            reference: input.reference,
            authorization_code: input.authorizationCode,
            currency: "ZAR",
        }),
    });
    const tx = data?.data;
    const status = String(tx?.status || data?.status || "failed").toLowerCase();
    return {
        success: status === "success",
        status,
        message: tx?.gateway_response || data?.message,
        amountChargedRands: tx?.amount ? tx.amount / 100 : input.amountRands,
    };
}
/**
 * Refunds a Paystack transaction. amountRands is optional — Paystack refunds
 * the full amount when omitted.
 */
async function refundTransaction(transactionReference, amountRands) {
    if (paymentsMode() === "mock") {
        return { success: true, message: "Mock refund processed" };
    }
    if (!isPaystackConfigured()) {
        throw new Error("Paystack is not configured.");
    }
    const data = await paystackFetch("/refund", {
        method: "POST",
        body: JSON.stringify({
            transaction: transactionReference,
            ...(amountRands != null ? { amount: Math.round(amountRands * 100) } : {}),
        }),
    });
    return { success: true, message: data?.message };
}
//# sourceMappingURL=paystackPayment.js.map
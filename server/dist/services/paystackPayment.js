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
exports.paymentsMode = paymentsMode;
exports.paystackConfig = paystackConfig;
exports.isPaystackConfigured = isPaystackConfigured;
exports.initializeTransaction = initializeTransaction;
exports.verifyTransaction = verifyTransaction;
exports.chargeAuthorization = chargeAuthorization;
exports.preauthorizeRideCard = preauthorizeRideCard;
exports.getDefaultCardToken = getDefaultCardToken;
exports.createTransferRecipient = createTransferRecipient;
exports.transferFunds = transferFunds;
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
 * Pre-authorizes/verifies that a rider's saved card can cover a ride BEFORE a
 * driver is notified. It runs a full-fare charge against the tokenised card
 * and immediately refunds it, returning success only if Paystack approved the
 * amount. This is the "does the rider have enough balance / can they pay"
 * gate that runs at ride request time — on decline the ride is NOT created and
 * NO driver is notified.
 *
 * Returns:
 *   { ok: true,  chargeReference, amountRands }   — card can cover the fare
 *   { ok: false, reason: 'no_card' | 'declined' | 'error', message } — block booking
 */
async function preauthorizeRideCard(input) {
    if (paymentsMode() === "mock") {
        return { ok: true, message: "Mock pre-authorization approved", amountRands: input.amountRands };
    }
    if (!isPaystackConfigured()) {
        return { ok: false, reason: "error", message: "Paystack is not configured." };
    }
    const reference = `VURAPRE${Date.now().toString(36).toUpperCase()}` +
        `${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    let charge;
    try {
        charge = await chargeAuthorization({
            amountRands: input.amountRands,
            reference,
            email: input.email,
            authorizationCode: input.authorizationCode,
        });
    }
    catch (err) {
        return { ok: false, reason: "error", message: err.message || "Could not verify your card." };
    }
    if (!charge.success) {
        const msg = String(charge.message || "").toLowerCase();
        if (msg.includes("fraud") || msg.includes("declined")) {
            return {
                ok: false,
                reason: "declined",
                message: "Your card was declined. Please add another card or top up before booking.",
            };
        }
        if (msg.includes("insufficient")) {
            return {
                ok: false,
                reason: "declined",
                message: "Your card has insufficient funds for this ride. Add another card or top up first.",
            };
        }
        return {
            ok: false,
            reason: "declined",
            message: `Card payment was declined. ${charge.message || ""}`.trim(),
        };
    }
    // Card can cover the fare — refund it immediately so the rider is not
    // actually charged for the pre-check. The real charge happens at pickup.
    try {
        await refundTransaction(reference, input.amountRands);
    }
    catch (e) {
        console.warn("Pre-authorization refund failed (auto-refund may lag a few days):", e);
    }
    return { ok: true, chargeReference: reference, amountRands: input.amountRands };
}
/**
 * Resolves the user's default saved Paystack card token (authorization_code).
 * Returns null when the user has no tokenised card on file.
 */
async function getDefaultCardToken(userId) {
    const { queryOne } = await Promise.resolve().then(() => __importStar(require("../config/database")));
    return await queryOne(`SELECT transaction_index, last4 FROM saved_cards
     WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC LIMIT 1`, [userId]).catch(() => null);
}
// ─────────────────────────────────────────────────────────────────────────────
// Paystack Transfers (driver payouts) — bank-account transfers only. Paystack
// cannot "pay a card"; Transfers go to a driver's bank account.
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Resolves a bank account number/name via Paystack Transfers and creates (or
 * returns) a transfer recipient for repeated payouts.
 */
async function createTransferRecipient(input) {
    if (paymentsMode() === "mock") {
        return {
            recipient_code: `RCP_MOCK_${input.accountNumber.slice(-6)}`,
            account_name: input.name,
            bank_name: "Mock Bank",
        };
    }
    if (!isPaystackConfigured()) {
        throw new Error("Paystack is not configured.");
    }
    // Resolve the account name first so we can display + confirm it to the driver.
    const resolved = await paystackFetch(`/bank/resolve?account_number=${encodeURIComponent(input.accountNumber)}&bank_code=${encodeURIComponent(input.bankCode)}`);
    const recipient = await paystackFetch("/transferrecipient", {
        method: "POST",
        body: JSON.stringify({
            type: "nuban",
            name: resolved?.data?.account_name || input.name,
            account_number: input.accountNumber,
            bank_code: input.bankCode,
            currency: "ZAR",
        }),
    });
    return {
        recipient_code: recipient?.data?.recipient_code || "",
        account_name: resolved?.data?.account_name || input.name,
        bank_name: recipient?.data?.details?.bank_name,
    };
}
/**
 * Initiates a Paystack bank transfer (payout) of amountRands to a recipient.
 */
async function transferFunds(input) {
    if (paymentsMode() === "mock") {
        return { success: true, transferCode: `TRF_MOCK`, reference: input.reference };
    }
    if (!isPaystackConfigured()) {
        throw new Error("Paystack is not configured.");
    }
    const data = await paystackFetch("/transfer", {
        method: "POST",
        body: JSON.stringify({
            source: "balance",
            reason: input.reason || "Vura driver payout",
            amount: Math.round(input.amountRands * 100),
            reference: input.reference,
            recipient: input.recipientCode,
            currency: "ZAR",
        }),
    });
    const status = String(data?.data?.status || "").toLowerCase();
    return {
        success: status !== "failed" && status !== "pending",
        transferCode: data?.data?.transfer_code,
        reference: data?.data?.reference || input.reference,
        message: data?.message,
        ...(data?.data ? { bank_name: data.data.bank_type } : {}),
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
"use strict";
// ─────────────────────────────────────────────────────────────────────────────
// iVeri (Nedbank) LITE hosted-payment adapter — SERVER-SIDE ONLY.
//
// Matches the official iVeri Lite WooCommerce plugin field-for-field, so it
// works with just the two Application IDs Nedbank issues (TEST + LIVE). The
// customer's card details are entered on iVeri's hosted page — never here.
//
// Credentials (server/.env, gitignored):
//   PAYMENTS_MODE      = mock | sandbox | live
//   IVERI_GATEWAY_URL  = Nedbank SA: https://portal.nedsecure.co.za/Lite/Authorise.aspx
//   IVERI_APP_ID_TEST  = TEST Application ID
//   IVERI_APP_ID_LIVE  = LIVE Application ID
//   IVERI_RETURN_URL   = redirect-back URL on this server, e.g.
//                        https://ridevura.com/api/payments/return
// ─────────────────────────────────────────────────────────────────────────────
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentsMode = paymentsMode;
exports.iveriConfig = iveriConfig;
exports.isIveriConfigured = isIveriConfigured;
exports.buildIveriFormFields = buildIveriFormFields;
function paymentsMode() {
    const mode = process.env.PAYMENTS_MODE;
    if (mode === "sandbox" || mode === "live")
        return mode;
    return "mock";
}
function iveriConfig() {
    return {
        gatewayUrl: process.env.IVERI_GATEWAY_URL || "",
        appIdTest: process.env.IVERI_APP_ID_TEST || "",
        appIdLive: process.env.IVERI_APP_ID_LIVE || "",
        returnUrl: process.env.IVERI_RETURN_URL || "",
    };
}
function isIveriConfigured() {
    const c = iveriConfig();
    const live = paymentsMode() === "live";
    return Boolean(c.gatewayUrl && c.returnUrl && (live ? c.appIdLive : c.appIdTest));
}
/**
 * Builds the Lite form fields the app POSTs to the iVeri hosted payment page.
 * Amounts are in CENTS (iVeri Lite convention — the plugin multiplies by 100).
 * Returns null in mock mode so nothing real can be charged accidentally.
 */
function buildIveriFormFields(input) {
    const cfg = iveriConfig();
    if (paymentsMode() === "mock") {
        // Mock: return recognisable fields so the UI can be tested end-to-end.
        return {
            live: false,
            gatewayUrl: cfg.gatewayUrl,
            usesSavedCard: Boolean(input.transactionIndex),
            fields: {
                merchant_reference: input.merchantReference,
                amount: input.amountRands.toFixed(2),
                currency: "ZAR",
                checksum: "MOCK",
            },
        };
    }
    if (!isIveriConfigured()) {
        throw new Error("iVeri is not configured. Add IVERI_GATEWAY_URL, IVERI_RETURN_URL and IVERI_APP_ID_TEST/LIVE to server/.env.");
    }
    const live = paymentsMode() === "live";
    const amountCents = Math.round(input.amountRands * 100);
    const fields = {
        // iVeri Lite credentials
        Lite_Merchant_ApplicationID: live ? cfg.appIdLive : cfg.appIdTest,
        Lite_ConsumerOrderID_PreFix: "AUTOGENERATE",
        Ecom_ConsumerOrderID: input.merchantReference,
        Ecom_TransactionComplete: "FALSE",
        // Order total (cents)
        Lite_Order_Amount: String(amountCents),
        // Redirect-back URLs — the customer's browser (WebView) is sent here after
        // payment. Use the same configured IVERI_RETURN_URL as the S2S callback
        // (not a placeholder hostname). If the gateway page is HTTPS and this is
        // HTTP, Android may block the redirect — the WebView intercepts the URL in
        // onShouldStartLoadWithRequest before it loads, and the S2S callback below
        // is the reliable fallback that records the result server-side regardless.
        Lite_Website_Successful_Url: `${cfg.returnUrl}`,
        Lite_Website_Fail_Url: `${cfg.returnUrl}`,
        Lite_Website_TryLater_Url: `${cfg.returnUrl}`,
        Lite_Website_Error_Url: `${cfg.returnUrl}`,
        // Server-to-server callback: the gateway POSTs the payment result here
        // AFTER processing, regardless of the browser redirect outcome. This is
        // the reliable path when Android's WebView blocks HTTPS->HTTP redirects.
        Lite_Server_Server_Url: `${cfg.returnUrl}`,
        // Billing / customer details
        Ecom_BillTo_Postal_Name_First: input.userFirstName || "",
        Ecom_BillTo_Postal_Name_Last: input.userLastName || "",
        Ecom_BillTo_Online_Email: input.userEmail || "",
        Ecom_BillTo_Telecom_Phone_Number: input.userPhone || "",
        // Protocol + version (required by the gateway)
        Ecom_Payment_Card_Protocols: "iVeri",
        Lite_Version: "4.0",
        // Line items (required by Lite)
        Lite_Order_LineItems_Product_1: input.merchantReference,
        Lite_Order_LineItems_Quantity_1: "1",
        Lite_Order_LineItems_Amount_1: String(amountCents),
    };
    // Card-on-file: when a TransactionIndex from a previous successful payment
    // is available, tell the gateway to resolve the card from that token so the
    // cardholder is not asked to re-enter card details.
    if (input.transactionIndex) {
        fields["Lite_PanFormat"] = "TransactionIndex";
        fields["Lite_TransactionIndex"] = input.transactionIndex;
        if (input.cardNumberMasked) {
            fields["Ecom_Payment_Card_Number"] = input.cardNumberMasked;
        }
        if (input.cardExpMonth) {
            fields["Ecom_Payment_Card_ExpDate_Month"] = String(input.cardExpMonth).padStart(2, "0");
        }
        if (input.cardExpYear) {
            fields["Ecom_Payment_Card_ExpDate_Year"] = String(input.cardExpYear);
        }
    }
    return { fields, gatewayUrl: cfg.gatewayUrl, live, usesSavedCard: Boolean(input.transactionIndex) };
}
//# sourceMappingURL=iveriPayment.js.map
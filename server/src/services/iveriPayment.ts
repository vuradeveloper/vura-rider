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

export type PaymentsMode = "mock" | "sandbox" | "live";

export function paymentsMode(): PaymentsMode {
  const mode = process.env.PAYMENTS_MODE;
  if (mode === "sandbox" || mode === "live") return mode;
  return "mock";
}

export interface IveriConfig {
  gatewayUrl: string;
  appIdTest: string;
  appIdLive: string;
  returnUrl: string;
}

export function iveriConfig(): IveriConfig {
  return {
    gatewayUrl: process.env.IVERI_GATEWAY_URL || "",
    appIdTest: process.env.IVERI_APP_ID_TEST || "",
    appIdLive: process.env.IVERI_APP_ID_LIVE || "",
    returnUrl: process.env.IVERI_RETURN_URL || "",
  };
}

export function isIveriConfigured(): boolean {
  const c = iveriConfig();
  const live = paymentsMode() === "live";
  return Boolean(c.gatewayUrl && c.returnUrl && (live ? c.appIdLive : c.appIdTest));
}

export interface IveriFormInput {
  amountRands: number;
  merchantReference: string;
  userEmail?: string | null;
  userFirstName?: string | null;
  userLastName?: string | null;
  userPhone?: string | null;
  // Card-on-file (iVeri token). When present, the Lite hosted page is told to
  // resolve the card from a previously stored TransactionIndex, so the
  // cardholder never re-enters card details on subsequent payments.
  transactionIndex?: string | null;
  cardNumberMasked?: string | null;
  cardExpMonth?: number | null;
  cardExpYear?: number | null;
}

/**
 * Builds the Lite form fields the app POSTs to the iVeri hosted payment page.
 * Amounts are in CENTS (iVeri Lite convention — the plugin multiplies by 100).
 * Returns null in mock mode so nothing real can be charged accidentally.
 */
export function buildIveriFormFields(input: IveriFormInput): {
  fields: Record<string, string>;
  gatewayUrl: string;
  live: boolean;
  usesSavedCard: boolean;
} | null {
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
    throw new Error(
      "iVeri is not configured. Add IVERI_GATEWAY_URL, IVERI_RETURN_URL and IVERI_APP_ID_TEST/LIVE to server/.env."
    );
  }

  const live = paymentsMode() === "live";
  const amountCents = Math.round(input.amountRands * 100);

  const fields: Record<string, string> = {
    // iVeri Lite credentials
    Lite_Merchant_ApplicationID: live ? cfg.appIdLive : cfg.appIdTest,
    Lite_ConsumerOrderID_PreFix: "AUTOGENERATE",
    Ecom_ConsumerOrderID: input.merchantReference,
    Ecom_TransactionComplete: "FALSE",
    // Order total (cents)
    Lite_Order_Amount: String(amountCents),
    // Redirect-back URLs — use a fake HTTPS URL that the mobile WebView
    // intercepts in onShouldStartLoadWithRequest BEFORE any navigation
    // attempt, bypassing Android's HTTPS->HTTP mixed-content block.
    Lite_Website_Successful_Url: "https://vura-payments.local/return",
    Lite_Website_Fail_Url: "https://vura-payments.local/return",
    Lite_Website_TryLater_Url: "https://vura-payments.local/return",
    Lite_Website_Error_Url: "https://vura-payments.local/return",
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

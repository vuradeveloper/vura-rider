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

const PAYSTACK_BASE_URL = "https://api.paystack.co";

export type PaymentsMode = "mock" | "sandbox" | "live";

export function paymentsMode(): PaymentsMode {
  const mode = process.env.PAYMENTS_MODE;
  if (mode === "sandbox" || mode === "live") return mode;
  return "mock";
}

export interface PaystackConfig {
  secretKey: string;
  callbackUrl: string;
  baseUrl: string;
}

export function paystackConfig(): PaystackConfig {
  return {
    secretKey:
      paymentsMode() === "live"
        ? process.env.PAYSTACK_SECRET_LIVE || ""
        : process.env.PAYSTACK_SECRET_TEST || "",
    callbackUrl: process.env.PAYSTACK_CALLBACK_URL || "",
    baseUrl: PAYSTACK_BASE_URL,
  };
}

export function isPaystackConfigured(): boolean {
  return Boolean(paystackConfig().secretKey);
}

async function paystackFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cfg = paystackConfig();
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.secretKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || json.status === false) {
    throw new Error(
      `Paystack ${init.method || "GET"} ${path} failed: ${
        json.message || res.statusText || res.status
      }`
    );
  }
  return json as T;
}

export interface PaystackInitializeInput {
  amountRands: number;
  reference: string;
  email?: string | null;
}

export interface PaystackVerifyResult {
  reference: string;
  status: "success" | "failed" | "abandoned" | string;
  amountPaidRands: number;
  authorization?: {
    authorization_code: string;
    last4: string;
    exp_month: number;
    exp_year: number;
    card_type: string;
    bank: string;
    bin: string;
    brand: string;
    reusable: boolean;
  };
}

export interface PaystackChargeInput {
  amountRands: number;
  reference: string;
  email: string;
  authorizationCode: string;
}

/**
 * Creates a Paystack hosted-checkout transaction (card registration / one-off
 * payment). Returns the authorization_url for the WebView. In mock mode it
 * returns a fake URL so the UI can be tested end-to-end.
 */
export async function initializeTransaction(
  input: PaystackInitializeInput
): Promise<{ reference: string; authorizationUrl: string; live: boolean }> {
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
    throw new Error(
      "Paystack is not configured. Add PAYSTACK_SECRET_TEST/LIVE and PAYSTACK_CALLBACK_URL to server/.env."
    );
  }

  const data = await paystackFetch<any>("/transaction/initialize", {
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
export async function verifyTransaction(reference: string): Promise<PaystackVerifyResult | null> {
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

  const data = await paystackFetch<any>(`/transaction/verify/${encodeURIComponent(reference)}`);
  const tx = data?.data;
  if (!tx) return null;

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
export async function chargeAuthorization(input: PaystackChargeInput): Promise<{
  success: boolean;
  status: string;
  message?: string;
  amountChargedRands?: number;
}> {
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

  const data = await paystackFetch<any>("/transaction/charge_authorization", {
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
export async function preauthorizeRideCard(input: {
  amountRands: number;
  email: string;
  authorizationCode: string;
}): Promise<{
  ok: boolean;
  reason?: "no_card" | "declined" | "error";
  message?: string;
  chargeReference?: string;
  amountRands?: number;
}> {
  if (paymentsMode() === "mock") {
    return { ok: true, message: "Mock pre-authorization approved", amountRands: input.amountRands };
  }
  if (!isPaystackConfigured()) {
    return { ok: false, reason: "error", message: "Paystack is not configured." };
  }

  const reference =
    `VURAPRE${Date.now().toString(36).toUpperCase()}` +
    `${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  let charge;
  try {
    charge = await chargeAuthorization({
      amountRands: input.amountRands,
      reference,
      email: input.email,
      authorizationCode: input.authorizationCode,
    });
  } catch (err: any) {
    return { ok: false, reason: "error", message: err.message || "Could not verify your card." };
  }

  if (!charge.success) {
    const msg = String(charge.message || "").toLowerCase();
    if (msg.includes("fraud") || msg.includes("declined")) {
      return {
        ok: false,
        reason: "declined",
        message:
          "Your card was declined. Please add another card or top up before booking.",
      };
    }
    if (msg.includes("insufficient")) {
      return {
        ok: false,
        reason: "declined",
        message:
          "Your card has insufficient funds for this ride. Add another card or top up first.",
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
  } catch (e) {
    console.warn(
      "Pre-authorization refund failed (auto-refund may lag a few days):",
      e
    );
  }

  return { ok: true, chargeReference: reference, amountRands: input.amountRands };
}

/**
 * Resolves the user's default saved Paystack card token (authorization_code).
 * Returns null when the user has no tokenised card on file.
 */
export async function getDefaultCardToken(userId: string): Promise<{
  transaction_index: string;
  last4: string;
} | null> {
  const { queryOne } = await import("../config/database");
  return await queryOne<{ transaction_index: string; last4: string }>(
    `SELECT transaction_index, last4 FROM saved_cards
     WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC LIMIT 1`,
    [userId]
  ).catch(() => null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Paystack Transfers (driver payouts) — bank-account transfers only. Paystack
// cannot "pay a card"; Transfers go to a driver's bank account.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a bank account number/name via Paystack Transfers and creates (or
 * returns) a transfer recipient for repeated payouts.
 */
export async function createTransferRecipient(input: {
  bankCode: string;
  accountNumber: string;
  name: string;
}): Promise<{ recipient_code: string; account_name: string; bank_name?: string }> {
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
  const resolved = await paystackFetch<any>(
    `/bank/resolve?account_number=${encodeURIComponent(input.accountNumber)}&bank_code=${encodeURIComponent(input.bankCode)}`
  );

  const recipient = await paystackFetch<any>("/transferrecipient", {
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
export async function transferFunds(input: {
  recipientCode: string;
  amountRands: number;
  reference: string;
  reason?: string;
}): Promise<{ success: boolean; transferCode?: string; reference?: string; message?: string }> {
  if (paymentsMode() === "mock") {
    return { success: true, transferCode: `TRF_MOCK`, reference: input.reference };
  }
  if (!isPaystackConfigured()) {
    throw new Error("Paystack is not configured.");
  }

  const data = await paystackFetch<any>("/transfer", {
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
    ...((data as any)?.data ? { bank_name: data.data.bank_type } : {}),
  };
}

/**
 * Refunds a Paystack transaction. amountRands is optional — Paystack refunds
 * the full amount when omitted.
 */
export async function refundTransaction(
  transactionReference: string,
  amountRands?: number
): Promise<{ success: boolean; message?: string }> {
  if (paymentsMode() === "mock") {
    return { success: true, message: "Mock refund processed" };
  }

  if (!isPaystackConfigured()) {
    throw new Error("Paystack is not configured.");
  }

  const data = await paystackFetch<any>("/refund", {
    method: "POST",
    body: JSON.stringify({
      transaction: transactionReference,
      ...(amountRands != null ? { amount: Math.round(amountRands * 100) } : {}),
    }),
  });

  return { success: true, message: data?.message };
}

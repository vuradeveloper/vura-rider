export type PaymentsMode = "mock" | "sandbox" | "live";
export declare function paymentsMode(): PaymentsMode;
export interface PaystackConfig {
    secretKey: string;
    callbackUrl: string;
    baseUrl: string;
}
export declare function paystackConfig(): PaystackConfig;
export declare function isPaystackConfigured(): boolean;
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
export declare function initializeTransaction(input: PaystackInitializeInput): Promise<{
    reference: string;
    authorizationUrl: string;
    live: boolean;
}>;
/**
 * Verifies a Paystack transaction. Returns the reusable authorization token
 * (authorization_code) plus the card details. Throws if Paystack is unreachable.
 */
export declare function verifyTransaction(reference: string): Promise<PaystackVerifyResult | null>;
/**
 * Charges a previously-tokenised card using its authorization_code.
 * Resolves to true on success, false when the bank declined/insufficient funds.
 */
export declare function chargeAuthorization(input: PaystackChargeInput): Promise<{
    success: boolean;
    status: string;
    message?: string;
    amountChargedRands?: number;
}>;
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
export declare function preauthorizeRideCard(input: {
    amountRands: number;
    email: string;
    authorizationCode: string;
}): Promise<{
    ok: boolean;
    reason?: "no_card" | "declined" | "error";
    message?: string;
    chargeReference?: string;
    amountRands?: number;
}>;
/**
 * Resolves the user's default saved Paystack card token (authorization_code).
 * Returns null when the user has no tokenised card on file.
 */
export declare function getDefaultCardToken(userId: string): Promise<{
    transaction_index: string;
    last4: string;
} | null>;
/**
 * Resolves a bank account number/name via Paystack Transfers and creates (or
 * returns) a transfer recipient for repeated payouts.
 */
export declare function createTransferRecipient(input: {
    bankCode: string;
    accountNumber: string;
    name: string;
}): Promise<{
    recipient_code: string;
    account_name: string;
    bank_name?: string;
}>;
/**
 * Initiates a Paystack bank transfer (payout) of amountRands to a recipient.
 */
export declare function transferFunds(input: {
    recipientCode: string;
    amountRands: number;
    reference: string;
    reason?: string;
}): Promise<{
    success: boolean;
    transferCode?: string;
    reference?: string;
    message?: string;
}>;
/**
 * Refunds a Paystack transaction. amountRands is optional — Paystack refunds
 * the full amount when omitted.
 */
export declare function refundTransaction(transactionReference: string, amountRands?: number): Promise<{
    success: boolean;
    message?: string;
}>;
//# sourceMappingURL=paystackPayment.d.ts.map
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
 * Refunds a Paystack transaction. amountRands is optional — Paystack refunds
 * the full amount when omitted.
 */
export declare function refundTransaction(transactionReference: string, amountRands?: number): Promise<{
    success: boolean;
    message?: string;
}>;
//# sourceMappingURL=paystackPayment.d.ts.map
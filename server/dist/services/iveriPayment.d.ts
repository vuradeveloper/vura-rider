export type PaymentsMode = "mock" | "sandbox" | "live";
export declare function paymentsMode(): PaymentsMode;
export interface IveriConfig {
    gatewayUrl: string;
    appIdTest: string;
    appIdLive: string;
    returnUrl: string;
}
export declare function iveriConfig(): IveriConfig;
export declare function isIveriConfigured(): boolean;
export interface IveriFormInput {
    amountRands: number;
    merchantReference: string;
    userEmail?: string | null;
    userFirstName?: string | null;
    userLastName?: string | null;
    userPhone?: string | null;
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
export declare function buildIveriFormFields(input: IveriFormInput): {
    fields: Record<string, string>;
    gatewayUrl: string;
    live: boolean;
    usesSavedCard: boolean;
} | null;
//# sourceMappingURL=iveriPayment.d.ts.map
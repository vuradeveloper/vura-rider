export type PaymentsMode = "mock" | "live";
export declare function paymentsMode(): PaymentsMode;
export interface MandateInput {
    accountHolder: string;
    bankCode: string;
    accountNumber: string;
}
export interface MandateResult {
    mandateToken: string;
    bankVerified: boolean;
}
export declare function createMandate(input: MandateInput): Promise<MandateResult>;
export interface CardHoldResult {
    verified: boolean;
    holdReference: string;
}
export declare function validateCardHold(cardToken: string): Promise<CardHoldResult>;
export interface CollectResult {
    success: boolean;
    reference?: string;
    error?: string;
}
export declare function collectMandate(mandateToken: string, amount: number, reference: string): Promise<CollectResult>;
//# sourceMappingURL=iVerveService.d.ts.map
import { rideFareBreakdown } from "./fareFees";
/**
 * Chargeback / refund evidence pack for ONE payment reference.
 *
 * A bank dispute asks a simple question: "prove the cardholder authorised this
 * and received the service." This builds a factual, timestamped pack from data
 * Vura already stores — no invented narrative:
 *
 *   • the payment and its Paystack reference/status/amount
 *   • the rider account (email/phone masked; the admin already has a reveal path)
 *   • the trip, route, timestamps, distance/duration and final status
 *   • the Option A fare split the rider was charged
 *   • the card fingerprint/last4 and Paystack fee/authorization summary
 *   • every verified Paystack webhook for that reference, in order
 *
 * Read-only. Money movement stays in Paystack.
 */
export interface PaymentEvidence {
    generated_at: string;
    reference: string;
    payment: {
        reference: string;
        amount: number;
        currency: string;
        status: string;
        provider: string;
        ride_id: string | null;
        created_at: string | null;
        updated_at: string | null;
    } | null;
    rider: {
        id: string;
        name: string | null;
        email: string | null;
        phone: string | null;
        account_created_at: string | null;
    } | null;
    ride: Record<string, unknown> | null;
    fare: ReturnType<typeof rideFareBreakdown> | null;
    card: {
        brand: string | null;
        last4: string | null;
        bank: string | null;
        exp_month: number | null;
        exp_year: number | null;
        fingerprint: string | null;
    } | null;
    paystack: Record<string, unknown> | null;
    timeline: Array<{
        event: string;
        received_at: string;
        reference: string | null;
        amount: string | null;
        status: string | null;
    }>;
    summary: string[];
}
export declare function buildPaymentEvidence(reference: string): Promise<PaymentEvidence | null>;
//# sourceMappingURL=paymentEvidence.d.ts.map
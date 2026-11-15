import { type AdminActor } from "./adminAuth";
/** Tables this screen needs, created in place (no migration dependency). */
export declare function ensureAdminPayLaterSchema(): Promise<void>;
export interface PayLaterFunds {
    /** Vura's own revenue: commission + booking fee on completed rides. */
    platform_revenue_zar: number;
    /** Referral balances still owed as future ride discounts (a liability). */
    referral_liability_zar: number;
    /** What riders currently owe on Pay Later (money already lent). */
    paylater_outstanding_zar: number;
    /** Revenue not already promised away: the amount available to lend. */
    available_to_lend_zar: number;
    /** Card/cashless money actually collected through Paystack. */
    cash_collected_zar: number;
    /** Driver money already paid out. */
    driver_payouts_paid_zar: number;
    /** Driver net earnings not yet paid out (owed to drivers). */
    driver_earnings_owed_zar: number;
    /** Sum of every credit limit the console has activated. */
    paylater_granted_zar: number;
    /** Confirmed Pay Later repayments received. */
    paylater_repaid_zar: number;
    active_accounts: number;
    pending_accounts: number;
    eligible_waiting: number;
    /** Revenue cover for the outstanding book (1.0 = fully covered). */
    cover_ratio: number;
    as_of: string;
}
export declare function getPayLaterFunds(): Promise<PayLaterFunds>;
export interface EligibleRider {
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    rides_counted: number;
    rides_required: number;
    account_id: string | null;
    account_status: string | null;
    credit_limit: number;
    outstanding: number;
    available: number;
    terms_accepted_at: string | null;
    card_last4: string | null;
    last_ride_at: string | null;
    past_due: boolean;
    is_demo: boolean;
    state: "eligible" | "pending" | "active" | "frozen";
}
/** Automated eligibility detection — the list the admin reviews. */
export declare function getPayLaterEligibleRiders(limit?: number): Promise<EligibleRider[]>;
export interface PayLaterAccountRow extends EligibleRider {
    grants_count: number;
    last_grant_at: string | null;
    created_at: string | null;
}
export declare function getPayLaterAccounts(limit?: number): Promise<PayLaterAccountRow[]>;
export interface PayLaterDay {
    day: string;
    revenue_zar: number;
    collected_zar: number;
    advanced_zar: number;
    repaid_zar: number;
    granted_zar: number;
    outstanding_zar: number;
}
export declare function getPayLaterSeries(days?: number): Promise<PayLaterDay[]>;
export declare function getPayLaterAdminOverview(): Promise<{
    funds: PayLaterFunds;
    eligible: EligibleRider[];
    accounts: PayLaterAccountRow[];
    series: PayLaterDay[];
    config: {
        rides_to_unlock: number;
        default_grant_r: number;
        max_grant_r: number;
        admin_approval: boolean;
    };
    generated_at: string;
}>;
export declare class PayLaterGrantError extends Error {
    code: "not_eligible" | "insufficient_funds" | "bad_amount" | "not_found";
    funds?: PayLaterFunds;
    constructor(code: PayLaterGrantError["code"], message: string, funds?: PayLaterFunds);
}
export interface GrantPayLaterInput {
    riderId: string;
    amountRands?: number;
    reason?: string;
    idempotencyKey?: string;
    override?: boolean;
    actor: AdminActor;
}
export interface GrantPayLaterResult {
    success: true;
    already_granted: boolean;
    grant_id: string;
    amount: number;
    rider_id: string;
    account: {
        id: string;
        status: string;
        credit_limit: number;
        outstanding: number;
        available: number;
    };
    funds_before: PayLaterFunds;
    funds_after: PayLaterFunds;
}
/**
 * Grants (or tops up) one rider's Pay Later limit. The grant record is written
 * FIRST with a unique idempotency key, so a double-click (or a retry after a
 * dropped response) can never add the same R100 twice.
 */
export declare function grantPayLater(input: GrantPayLaterInput): Promise<GrantPayLaterResult>;
/** Freeze / reactivate an account without deleting its ledger. */
export declare function setPayLaterAccountStatus(riderId: string, status: "active" | "frozen", actor: AdminActor, reason?: string): Promise<{
    success: true;
    status: string;
}>;
/**
 * Seeds three clearly-labelled demo riders (plus two demo drivers) so the
 * console can be exercised end-to-end without touching a real rider:
 *   1. eligible, waiting for a grant;
 *   2. eligible with a pending account;
 *   3. active with R100 limit and R35 already owed.
 * Idempotent: running it again does not duplicate rides, cards or grants.
 */
export declare function seedPayLaterDemos(actor: AdminActor): Promise<{
    success: boolean;
    riders: number;
    drivers: 2;
    rider_ids: string[];
    demo_emails: string[];
}>;
/** Removes ONLY the demo users and their demo rides/accounts. */
export declare function clearPayLaterDemos(actor: AdminActor): Promise<{
    success: boolean;
    removed: number;
}>;
//# sourceMappingURL=adminPayLater.d.ts.map
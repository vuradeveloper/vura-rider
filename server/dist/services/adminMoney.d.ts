/** Day/week/month revenue + payment + payout + earnings aggregates. */
export declare function getMoneyOverview(): Promise<Record<string, unknown>>;
/** Recent payments, rider-masked, newest first. */
export declare function listPayments(limit?: number): Promise<any[]>;
/** Recent payouts to drivers, newest first. */
export declare function listPayouts(limit?: number): Promise<any[]>;
/** Per-driver earnings ledger totals (gross/fees/net + paid), read-only. */
export declare function listDriverEarnings(): Promise<any[]>;
//# sourceMappingURL=adminMoney.d.ts.map
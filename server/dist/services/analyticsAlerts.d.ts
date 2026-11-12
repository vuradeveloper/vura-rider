export type AlertSeverity = "good" | "warn" | "bad";
export interface AnalyticsAlert {
    id: string;
    kind: string;
    severity: AlertSeverity;
    title: string;
    metric: string;
    value: string;
    previous: string;
    delta: string;
    place: string;
    decision: string;
    email_status: string;
    created_at: string;
}
export declare function alertRecipients(): string[];
type Candidate = Omit<AnalyticsAlert, "id" | "email_status" | "created_at"> & {
    dedupe: string;
};
/** Build the alert candidates for the current moment. */
export declare function buildAlerts(): Promise<Candidate[]>;
export declare function listAlerts(limit?: number): Promise<AnalyticsAlert[]>;
export declare function sendAlertEmail(candidate: Candidate): Promise<{
    ok: boolean;
    error?: string;
}>;
/**
 * Run one scan. Safe to call repeatedly; dedupe is per kind per day.
 * Returns the alerts that were newly created.
 */
export declare function runAnalyticsScan(options?: {
    email?: boolean;
}): Promise<AnalyticsAlert[]>;
/** Send a test email to both inboxes (admin button). */
export declare function sendTestAnalyticsEmail(actorEmail: string): Promise<{
    ok: boolean;
    to: string[];
    error?: string;
}>;
/** Start the background worker. Interval in minutes via env (0 disables). */
export declare function startAnalyticsAlertWorker(): () => void;
export {};
//# sourceMappingURL=analyticsAlerts.d.ts.map
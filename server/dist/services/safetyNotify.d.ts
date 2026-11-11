/**
 * Safety alerts outside the admin console.
 *
 * The console is the responder, but an unopened tab must not be the only place
 * an SOS exists. These emails go to:
 *   • the rider/driver's saved emergency contacts (if they gave an email), and
 *   • SAFETY_ALERT_EMAIL (the on-call inbox), when configured.
 *
 * No emergency service is contacted automatically. The email says exactly that
 * and tells the contact what to do. Sending is best-effort: a mail failure must
 * never stop the SOS row from being recorded or the console from seeing it.
 */
export interface SafetyContact {
    name: string;
    phone: string | null;
    email: string | null;
}
export declare function notifySos(input: {
    payload: any;
    contacts: SafetyContact[];
    shareUrl: string | null;
}): Promise<{
    contacts_notified: number;
    safety_team_notified: boolean;
}>;
export declare function notifyCheckinTimeout(input: {
    rideId: string;
    payload: any;
    shareUrl: string | null;
}): Promise<void>;
//# sourceMappingURL=safetyNotify.d.ts.map
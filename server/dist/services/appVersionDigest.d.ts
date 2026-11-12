export interface OutdatedDriver {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    status: string | null;
    version: string | null;
    platform: string | null;
    last_seen: string;
    device: string | null;
}
export declare function digestRecipients(): string[];
/** "+27 82 123 4567" → "27821234567" for wa.me. */
export declare function whatsappNumber(phone: string | null): string | null;
export declare function whatsappMessage(name: string | null): string;
export declare function whatsappLink(driver: {
    name: string | null;
    phone: string | null;
}): string | null;
/** Live sessions in the last 30 days on an older build. */
export declare function listOutdatedDrivers(): Promise<OutdatedDriver[]>;
export declare function sendAppVersionDigest(): Promise<{
    ok: boolean;
    drivers: number;
    to: string[];
    error?: string;
}>;
/** Email one driver their personal update link. */
export declare function emailDriverUpdate(driver: OutdatedDriver): Promise<{
    ok: boolean;
    error?: string;
}>;
/** 08:00 Africa/Johannesburg, once per day. Returns a stop function. */
export declare function startAppVersionDigestWorker(): () => void;
//# sourceMappingURL=appVersionDigest.d.ts.map
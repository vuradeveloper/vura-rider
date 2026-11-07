export type LiveChatStatus = "open" | "pending" | "resolved" | "closed";
export type LiveChatAuthorRole = "rider" | "admin" | "system";
export interface LiveChatMessage {
    id: string;
    chat_id: string;
    author_role: LiveChatAuthorRole;
    author_email: string | null;
    message: string;
    is_internal: boolean;
    created_at: string;
}
export interface LiveChatRow {
    id: string;
    reference: string;
    rider_id: string | null;
    rider_name: string | null;
    rider_email: string | null;
    rider_phone: string | null;
    ride_id: string | null;
    status: LiveChatStatus;
    priority: string;
    assignee_email: string | null;
    created_at: string;
    updated_at: string;
    resolved_at: string | null;
    last_message?: string | null;
    last_author_role?: string | null;
    last_message_at?: string | null;
    messages?: LiveChatMessage[];
}
export declare function ensureLiveSupportSchema(): Promise<void>;
/** Latest chat for a rider — including resolved, so the app can show the outcome. */
export declare function getRiderChat(firebaseUid: string): Promise<any | null>;
/**
 * Send a rider message. Opens a new chat when there is no open one, so the
 * first message of a conversation is enough to call this endpoint.
 */
export declare function sendRiderMessage(input: {
    firebaseUid: string;
    message: string;
    rideId?: string | null;
}): Promise<any>;
/** Admin list: open first, newest activity first, with the last public message. */
export declare function listLiveChats(opts: {
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
}): Promise<{
    rows: LiveChatRow[];
    total: number;
}>;
export declare function getLiveChat(id: string): Promise<any | null>;
export declare function sendAdminMessage(input: {
    chatId: string;
    adminEmail: string;
    message: string;
    isInternal?: boolean;
}): Promise<any | null>;
export declare function updateLiveChat(id: string, patch: {
    status?: string;
    assignee_email?: string | null;
    priority?: string;
}): Promise<any | null>;
//# sourceMappingURL=liveSupport.d.ts.map
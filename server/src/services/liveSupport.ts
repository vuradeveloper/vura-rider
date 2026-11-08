// ─────────────────────────────────────────────────────────────────────────────
// Live Support — real one-to-one chat between a rider and the ops team.
//
// It is deliberately separate from the email-style `support_tickets` inbox:
//   • a rider starts a chat from the app (Help → Live support)
//   • ops sees it in Admin → Live Support (open first, newest activity first)
//   • replies are stored in live_chat_messages; the rider app polls while open
//   • resolving closes the chat; the rider can start a new one afterwards
//
// No new third-party service: Postgres is the source of truth, and the admin
// page polls every few seconds so it still feels live without a websocket.
// ─────────────────────────────────────────────────────────────────────────────
import { query, queryOne, execute } from "../config/database";

export type LiveChatStatus = "open" | "pending" | "resolved" | "closed";
export type LiveChatAuthorRole = "rider" | "driver" | "admin" | "system";

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
  user_role: "rider" | "driver";
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

let schemaReady: Promise<void> | null = null;

export async function ensureLiveSupportSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await execute(`
        CREATE TABLE IF NOT EXISTS live_chats (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          reference VARCHAR(24) UNIQUE NOT NULL,
          rider_id UUID REFERENCES users(id) ON DELETE SET NULL,
          rider_name VARCHAR(255),
          rider_email VARCHAR(255),
          rider_phone VARCHAR(50),
          ride_id UUID REFERENCES rides(id) ON DELETE SET NULL,
          status VARCHAR(20) DEFAULT 'open',
          priority VARCHAR(20) DEFAULT 'normal',
          assignee_email VARCHAR(255),
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          resolved_at TIMESTAMPTZ
        )
      `);
      await execute(`
        CREATE TABLE IF NOT EXISTS live_chat_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          chat_id UUID NOT NULL REFERENCES live_chats(id) ON DELETE CASCADE,
          author_role VARCHAR(20) NOT NULL,
          author_email VARCHAR(255),
          message TEXT NOT NULL,
          is_internal BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await execute(`ALTER TABLE live_chats ADD COLUMN IF NOT EXISTS user_role VARCHAR(20) DEFAULT 'rider'`);
      await execute(
        `CREATE INDEX IF NOT EXISTS idx_live_chats_status ON live_chats (status, updated_at DESC)`
      );
      await execute(
        `CREATE INDEX IF NOT EXISTS idx_live_chats_rider ON live_chats (rider_id, created_at DESC)`
      );
      await execute(
        `CREATE INDEX IF NOT EXISTS idx_live_chat_messages_chat ON live_chat_messages (chat_id, created_at)`
      );
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeReference(): string {
  let s = "";
  for (let i = 0; i < 6; i++) {
    s += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  }
  return `LIVE-${s}`;
}

function cleanMessage(value: unknown): string {
  return String(value || "").trim().slice(0, 4000);
}

async function riderUser(firebaseUid: string) {
  return await queryOne<{
    id: string;
    full_name: string | null;
    email: string | null;
    phone: string | null;
    role: string | null;
    has_driver_profile: boolean;
  }>(
    `SELECT u.id, u.full_name, u.email, u.phone, u.role,
            EXISTS (SELECT 1 FROM driver_profiles dp WHERE dp.user_id = u.id) AS has_driver_profile
       FROM users u WHERE u.firebase_uid = $1`,
    [firebaseUid]
  );
}

async function latestRideId(userId: string, role: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    role === "driver"
      ? `SELECT id FROM rides WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 1`
      : `SELECT id FROM rides WHERE passenger_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId]
  ).catch(() => null);
  return row?.id ?? null;
}

/** Latest chat for a rider — including resolved, so the app can show the outcome. */
export async function getRiderChat(firebaseUid: string): Promise<any | null> {
  await ensureLiveSupportSchema();
  const user = await riderUser(firebaseUid);
  if (!user) return null;

  const chat = await queryOne<LiveChatRow>(
    `SELECT c.*, r.pickup_address, r.destination_address, r.status AS ride_status,
            r.actual_fare, r.estimated_fare, r.distance_km, r.duration_mins,
            r.created_at AS ride_created_at, r.completed_at AS ride_completed_at
       FROM live_chats c
       LEFT JOIN rides r ON r.id = c.ride_id
      WHERE c.rider_id = $1
      ORDER BY c.created_at DESC
      LIMIT 1`,
    [user.id]
  );
  if (!chat) return null;

  const messages = await query<LiveChatMessage>(
    `SELECT id, chat_id, author_role, author_email, message, is_internal, created_at
       FROM live_chat_messages
      WHERE chat_id = $1 AND is_internal = false
      ORDER BY created_at ASC`,
    [chat.id]
  );
  return { ...chat, messages };
}

/**
 * Send a rider message. Opens a new chat when there is no open one, so the
 * first message of a conversation is enough to call this endpoint.
 */
export async function sendRiderMessage(input: {
  firebaseUid: string;
  message: string;
  rideId?: string | null;
}): Promise<any> {
  await ensureLiveSupportSchema();
  const user = await riderUser(input.firebaseUid);
  if (!user) throw new Error("User not found.");
  const message = cleanMessage(input.message);
  if (message.length < 1) throw new Error("Type a message first.");
  const userRole = user.role === "driver" || user.has_driver_profile ? "driver" : "rider";

  const openChat = await queryOne<LiveChatRow>(
    `SELECT * FROM live_chats
      WHERE rider_id = $1 AND status IN ('open', 'pending')
      ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );

  let chatId = openChat?.id;
  if (!chatId) {
    const rideId = input.rideId || (await latestRideId(user.id, userRole));
    for (let attempt = 0; attempt < 5; attempt++) {
      const reference = makeReference();
      try {
        const created = await queryOne<{ id: string }>(
          `INSERT INTO live_chats
             (reference, rider_id, rider_name, rider_email, rider_phone, user_role, ride_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')
           RETURNING id`,
          [reference, user.id, user.full_name, user.email, user.phone, userRole, rideId]
        );
        chatId = created?.id;
        break;
      } catch (err: any) {
        if (err?.code === "23505" && attempt < 4) continue; // reference collision
        throw err;
      }
    }
  }
  if (!chatId) throw new Error("Could not start a live chat.");

  await execute(
    `INSERT INTO live_chat_messages (chat_id, author_role, author_email, message)
     VALUES ($1, $2, $3, $4)`,
    [chatId, userRole, user.email, message]
  );
  await execute(
    `UPDATE live_chats
        SET status = 'open', user_role = $2, updated_at = NOW()
      WHERE id = $1`,
    [chatId, userRole]
  );
  return await getRiderChat(input.firebaseUid);
}

/** Admin list: open first, newest activity first, with the last public message. */
export async function listLiveChats(opts: {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ rows: LiveChatRow[]; total: number }> {
  await ensureLiveSupportSchema();
  const limit = Math.min(Math.max(opts.limit ?? 60, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const params: unknown[] = [];
  const where: string[] = ["TRUE"];

  if (opts.status && opts.status !== "all") {
    params.push(opts.status);
    where.push(`c.status = $${params.length}::varchar`);
  }
  if (opts.search?.trim()) {
    params.push(`%${opts.search.trim().toLowerCase()}%`);
    where.push(
      `(LOWER(COALESCE(c.rider_name, '')) LIKE $${params.length}
        OR LOWER(COALESCE(c.rider_email, '')) LIKE $${params.length}
        OR LOWER(COALESCE(c.rider_phone, '')) LIKE $${params.length}
        OR LOWER(c.reference) LIKE $${params.length})`
    );
  }
  const whereSql = where.join(" AND ");
  const count = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM live_chats c WHERE ${whereSql}`,
    params
  );
  params.push(limit, offset);
  const rows = await query<LiveChatRow>(
    `SELECT c.*,
            (SELECT m.message FROM live_chat_messages m
              WHERE m.chat_id = c.id AND m.is_internal = false
              ORDER BY m.created_at DESC LIMIT 1) AS last_message,
            (SELECT m.author_role FROM live_chat_messages m
              WHERE m.chat_id = c.id AND m.is_internal = false
              ORDER BY m.created_at DESC LIMIT 1) AS last_author_role,
            (SELECT m.created_at FROM live_chat_messages m
              WHERE m.chat_id = c.id AND m.is_internal = false
              ORDER BY m.created_at DESC LIMIT 1) AS last_message_at,
            (SELECT COUNT(*)::int FROM live_chat_messages m WHERE m.chat_id = c.id) AS messages
       FROM live_chats c
      WHERE ${whereSql}
      ORDER BY CASE c.status WHEN 'open' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
               c.updated_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { rows, total: Number(count?.count || 0) };
}

export async function getLiveChat(id: string): Promise<any | null> {
  await ensureLiveSupportSchema();
  const chat = await queryOne<LiveChatRow>(
    `SELECT c.*, r.pickup_address, r.destination_address, r.status AS ride_status,
            r.actual_fare, r.estimated_fare, r.distance_km, r.duration_mins,
            r.created_at AS ride_created_at, r.completed_at AS ride_completed_at
       FROM live_chats c
       LEFT JOIN rides r ON r.id = c.ride_id
      WHERE c.id = $1`,
    [id]
  );
  if (!chat) return null;
  const messages = await query<LiveChatMessage>(
    `SELECT id, chat_id, author_role, author_email, message, is_internal, created_at
       FROM live_chat_messages WHERE chat_id = $1 ORDER BY created_at ASC`,
    [id]
  );
  return { ...chat, messages };
}

export async function sendAdminMessage(input: {
  chatId: string;
  adminEmail: string;
  message: string;
  isInternal?: boolean;
}): Promise<any | null> {
  await ensureLiveSupportSchema();
  const message = cleanMessage(input.message);
  if (!message) throw new Error("Type a reply first.");
  const chat = await queryOne<{ id: string; status: string }>(
    `SELECT id, status FROM live_chats WHERE id = $1`,
    [input.chatId]
  );
  if (!chat) return null;
  if (chat.status === "closed") throw new Error("This chat is closed. Reopen it first.");

  await execute(
    `INSERT INTO live_chat_messages (chat_id, author_role, author_email, message, is_internal)
     VALUES ($1, 'admin', $2, $3, $4)`,
    [input.chatId, input.adminEmail, message, !!input.isInternal]
  );
  await execute(
    `UPDATE live_chats SET updated_at = NOW(),
        status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END
      WHERE id = $1`,
    [input.chatId]
  );
  return await getLiveChat(input.chatId);
}

export async function updateLiveChat(
  id: string,
  patch: { status?: string; assignee_email?: string | null; priority?: string }
): Promise<any | null> {
  await ensureLiveSupportSchema();
  const sets: string[] = [];
  const params: unknown[] = [id];

  if (patch.status) {
    const status = String(patch.status);
    if (!["open", "pending", "resolved", "closed"].includes(status)) {
      throw new Error("Invalid status.");
    }
    params.push(status);
    sets.push(`status = $${params.length}::varchar`);
    sets.push(
      status === "resolved" || status === "closed"
        ? `resolved_at = COALESCE(resolved_at, NOW())`
        : `resolved_at = NULL`
    );
  }
  if (patch.assignee_email !== undefined) {
    params.push(patch.assignee_email || null);
    sets.push(`assignee_email = $${params.length}`);
  }
  if (patch.priority) {
    params.push(patch.priority);
    sets.push(`priority = $${params.length}::varchar`);
  }
  if (sets.length === 0) return await getLiveChat(id);
  sets.push(`updated_at = NOW()`);
  await execute(`UPDATE live_chats SET ${sets.join(", ")} WHERE id = $1`, params);
  return await getLiveChat(id);
}

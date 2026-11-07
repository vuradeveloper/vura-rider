// duplicateDetection - stop one person creating several driver accounts.
//
// SIGNUP: a new account that reuses an existing phone number or ID number is
// refused with a clear 409. Near-identical emails (john@ vs jhon@, or
// john.doe+driver@ vs johndoe@) are created but queued for an admin decision,
// because an email typo alone is not proof.
//
// EXISTING DATA: a boot sweep flags accounts that already share a phone/ID or
// a near-identical email. The admin console lists them; clearing a flag is
// sticky, so a reviewed account is not re-queued on every restart.
import { execute, query, queryOne } from "../config/database";
import { writeAudit } from "./adminAuth";
import type { AdminActor } from "./adminAuth";
import {
  emailSimilarity,
  maskEmail,
  maskPhone,
  normaliseEmail,
  normaliseIdNumber,
  normalisePhone,
} from "../lib/identity";

export type DuplicateKind = "phone" | "id" | "email" | "email_near";

export interface DuplicateMatch {
  userId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  score: number;
  kind: DuplicateKind;
  reason: string;
}

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

let ensurePromise: Promise<void> | null = null;

export function ensureDuplicateSchema(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = doEnsure().catch((err) => {
      ensurePromise = null;
      throw err;
    });
  }
  return ensurePromise;
}

async function doEnsure(): Promise<void> {
  try {
    await execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_normalized VARCHAR(20)`);
    await execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS id_number_normalized VARCHAR(30)`);
    await execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS duplicate_of_user_id UUID`);
    await execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS duplicate_reason TEXT`);
    await execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS duplicate_score INTEGER`);
    await execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS duplicate_status VARCHAR(20)`);
    await execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS duplicate_detected_at TIMESTAMPTZ`);
    await execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS duplicate_reviewed_at TIMESTAMPTZ`);
    await execute(`ALTER TABLE users ADD COLUMN IF NOT EXISTS duplicate_reviewed_by TEXT`);
    await execute(
      `CREATE INDEX IF NOT EXISTS idx_users_phone_normalized
         ON users (phone_normalized)
       WHERE phone_normalized IS NOT NULL`
    );
    await execute(
      `CREATE INDEX IF NOT EXISTS idx_users_id_number_normalized
         ON users (id_number_normalized)
       WHERE id_number_normalized IS NOT NULL`
    );
    await execute(
      `CREATE INDEX IF NOT EXISTS idx_users_duplicate_open
         ON users (duplicate_status)
       WHERE duplicate_status = 'open'`
    );

    // Backfill from the raw columns. Last 9 digits is the canonical SA number.
    await execute(
      `UPDATE users
          SET phone_normalized = NULLIF(RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '\\D', '', 'g'), 9), '')
        WHERE phone IS NOT NULL AND phone <> ''`
    );
    await execute(
      `UPDATE users
          SET id_number_normalized = NULLIF(UPPER(REGEXP_REPLACE(COALESCE(id_number, ''), '[^0-9A-Za-z]', '', 'g')), '')
        WHERE id_number IS NOT NULL AND id_number <> ''`
    );
    console.log("[schema] duplicate account columns ready");
  } catch (err: any) {
    console.warn("[schema] duplicate account columns failed:", err?.message || err);
    throw err;
  }
}

/** Exact phone/ID matches and exact/near email matches, strongest first. */
export async function findDuplicateMatches(input: {
  userId?: string;
  phone?: unknown;
  idNumber?: unknown;
  email?: unknown;
}): Promise<DuplicateMatch[]> {
  await ensureDuplicateSchema().catch(() => {});
  const self = input.userId || NIL_UUID;
  const phone = normalisePhone(input.phone);
  const id = normaliseIdNumber(input.idNumber);
  const email = normaliseEmail(input.email);
  const out = new Map<string, DuplicateMatch>();

  const add = (row: any, score: number, kind: DuplicateKind, reason: string) => {
    if (!row?.id || String(row.id) === self) return;
    const prev = out.get(String(row.id));
    if (prev && prev.score >= score) return;
    out.set(String(row.id), {
      userId: String(row.id),
      fullName: row.full_name || null,
      email: row.email || null,
      phone: row.phone || null,
      score,
      kind,
      reason,
    });
  };

  if (phone) {
    const rows = await query<any>(
      `SELECT id, full_name, email, phone FROM users
        WHERE phone_normalized = $1 AND id <> $2::uuid
        LIMIT 5`,
      [phone, self]
    );
    for (const row of rows) {
      add(row, 100, "phone", `Same phone number (${maskPhone(row.phone)})`);
    }
  }

  if (id) {
    const rows = await query<any>(
      `SELECT id, full_name, email, phone FROM users
        WHERE id_number_normalized = $1 AND id <> $2::uuid
        LIMIT 5`,
      [id, self]
    );
    for (const row of rows) {
      add(row, 100, "id", "Same ID number");
    }
  }

  if (email.full) {
    const exact = await query<any>(
      `SELECT id, full_name, email, phone FROM users
        WHERE LOWER(email) = LOWER($1) AND id <> $2::uuid
        LIMIT 5`,
      [email.full, self]
    );
    for (const row of exact) {
      add(row, 90, "email", `Same email address (${maskEmail(row.email)})`);
    }

    if (email.domain) {
      const candidates = await query<any>(
        `SELECT id, full_name, email, phone FROM users
          WHERE email ILIKE $1 AND id <> $2::uuid
          LIMIT 200`,
        [`%@${email.domain}`, self]
      );
      for (const row of candidates) {
        const score = emailSimilarity(email.full, row.email);
        if (score >= 70) {
          add(row, score, "email_near", `Nearly identical email (${maskEmail(row.email)})`);
        }
      }
    }
  }

  return Array.from(out.values()).sort((a, b) => b.score - a.score).slice(0, 5);
}

/** Record a flag unless an admin already cleared or confirmed this account. */
export async function markUserDuplicate(userId: string, match: DuplicateMatch): Promise<boolean> {
  if (!userId || !match?.userId || userId === match.userId) return false;
  const res = await execute(
    `UPDATE users
        SET duplicate_of_user_id = $2::uuid,
            duplicate_reason = $3,
            duplicate_score = $4,
            duplicate_status = 'open',
            duplicate_detected_at = NOW()
      WHERE id = $1
        AND (duplicate_status IS NULL
          OR (duplicate_status = 'open'
              AND (duplicate_of_user_id IS DISTINCT FROM $2::uuid
                   OR duplicate_reason IS DISTINCT FROM $3)))`,
    [userId, match.userId, match.reason, match.score]
  );
  return (res.rowCount || 0) > 0;
}

/**
 * Boot sweep for accounts that already exist. Keeps the oldest account as the
 * reference and flags the later ones. Email typos are compared only within the
 * same domain, and only one edit apart.
 */
export async function sweepDuplicateUsers(limit = 1000): Promise<number> {
  await ensureDuplicateSchema().catch(() => {});
  let flagged = 0;

  const phoneGroups = await query<{ phone_normalized: string; ids: string[] }>(
    `SELECT phone_normalized, array_agg(id ORDER BY created_at ASC, id ASC) AS ids
       FROM users
      WHERE phone_normalized IS NOT NULL AND phone_normalized <> ''
      GROUP BY phone_normalized
     HAVING COUNT(*) > 1`
  ).catch(() => [] as any[]);
  for (const group of phoneGroups) {
    const ids = (group.ids || []) as string[];
    for (let i = 1; i < ids.length; i++) {
      const ok = await markUserDuplicate(ids[i], {
        userId: ids[0],
        fullName: null,
        email: null,
        phone: null,
        score: 100,
        kind: "phone",
        reason: "Same phone number as an older account",
      }).catch(() => false);
      if (ok) flagged++;
    }
  }

  const idGroups = await query<{ id_number_normalized: string; ids: string[] }>(
    `SELECT id_number_normalized, array_agg(id ORDER BY created_at ASC, id ASC) AS ids
       FROM users
      WHERE id_number_normalized IS NOT NULL AND id_number_normalized <> ''
      GROUP BY id_number_normalized
     HAVING COUNT(*) > 1`
  ).catch(() => [] as any[]);
  for (const group of idGroups) {
    const ids = (group.ids || []) as string[];
    for (let i = 1; i < ids.length; i++) {
      const ok = await markUserDuplicate(ids[i], {
        userId: ids[0],
        fullName: null,
        email: null,
        phone: null,
        score: 100,
        kind: "id",
        reason: "Same ID number as an older account",
      }).catch(() => false);
      if (ok) flagged++;
    }
  }

  const users = await query<any>(
    `SELECT id, full_name, email, phone FROM users
      WHERE email IS NOT NULL AND email <> ''
      ORDER BY created_at ASC
      LIMIT $1`,
    [limit]
  ).catch(() => []);
  const byDomain = new Map<string, any[]>();
  for (const row of users) {
    const e = normaliseEmail(row.email);
    if (!e.domain) continue;
    const list = byDomain.get(e.domain) || [];
    for (const prev of list) {
      const score = emailSimilarity(prev.email, row.email);
      if (score >= 70) {
        const ok = await markUserDuplicate(row.id, {
          userId: prev.id,
          fullName: prev.full_name || null,
          email: prev.email || null,
          phone: prev.phone || null,
          score,
          kind: "email_near",
          reason: `Nearly identical email (${maskEmail(prev.email)})`,
        }).catch(() => false);
        if (ok) {
          flagged++;
          break;
        }
      }
    }
    list.push(row);
    byDomain.set(e.domain, list);
  }

  if (flagged > 0) console.log(`[duplicates] flagged ${flagged} account(s) on boot`);
  return flagged;
}

/** Admin queue: open duplicate flags with both sides of the match. */
export async function listDuplicateFlags(): Promise<any[]> {
  await ensureDuplicateSchema().catch(() => {});
  return query<any>(
    `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.created_at,
            u.duplicate_of_user_id, u.duplicate_reason, u.duplicate_score,
            u.duplicate_detected_at,
            d.full_name AS match_name, d.email AS match_email,
            d.phone AS match_phone, d.role AS match_role
       FROM users u
       LEFT JOIN users d ON d.id = u.duplicate_of_user_id
      WHERE u.duplicate_status = 'open'
      ORDER BY u.duplicate_score DESC, u.duplicate_detected_at DESC
      LIMIT 200`
  );
}

export async function resolveDuplicate(
  userId: string,
  resolution: "cleared" | "confirmed",
  actor: AdminActor,
  note?: string
): Promise<any | null> {
  await ensureDuplicateSchema().catch(() => {});
  const before = await queryOne<any>(
    `SELECT duplicate_status, duplicate_of_user_id, duplicate_reason
       FROM users WHERE id = $1`,
    [userId]
  );
  if (!before) return null;
  await execute(
    `UPDATE users
        SET duplicate_status = $2,
            duplicate_reviewed_at = NOW(),
            duplicate_reviewed_by = $3
      WHERE id = $1`,
    [userId, resolution, actor.email]
  );
  await writeAudit(actor, {
    action: resolution === "confirmed" ? "user.duplicate_confirm" : "user.duplicate_clear",
    entityType: "users",
    entityId: userId,
    oldValue: {
      status: before.duplicate_status || null,
      duplicateOf: before.duplicate_of_user_id || null,
    },
    newValue: { status: resolution },
    reason: note?.trim() || undefined,
  });
  return queryOne<any>(
    `SELECT id, full_name, email, phone, duplicate_status, duplicate_of_user_id,
            duplicate_reason, duplicate_reviewed_at, duplicate_reviewed_by
       FROM users WHERE id = $1`,
    [userId]
  );
}

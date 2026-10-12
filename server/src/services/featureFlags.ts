// ─────────────────────────────────────────────────────────────────────────────
// FEATURE FLAGS — admin read/update for the three RC4 module switches.
//
// The brief: the operator must switch the new features ON for test accounts
// "without SQL", with one call, and see the exact current JSON. Three flags +
// their allowlists only — this service can NEVER touch fares, pricing, wallet
// or any money column (validated keys only, see SETTABLE).
//
//   matching         h3_matching_enabled, h3_rollout_mode (off|allowlist|
//                    percent|all), rider allowlist
//   destination      destination_matching_enabled, destination_rollout_mode
//                    (allowlist|all), driver allowlist
//   performance_tier performance_tier_enabled, performance_tier_rollout_mode
//                    (allowlist|all), driver allowlist
//
// A missing *_rollout_mode in the DB row means 'allowlist' — the pre-RC4
// behaviour, so turning destination/tier on FOR EVERYONE is the explicit
// act of writing 'all' (the one-call enable does it when no driver ids are
// given).
//
// Every write is read-modify-write on the app_config JSONB row (the seeded
// shape from migrations 001/002/003 is preserved), then invalidateConfigCache()
// so the change lands within the same second (the cache would otherwise wait
// up to 10 s). Every write is audited to stdout as one JSON line.
//
// Missing table/row ⇒ structured error (`no_row`), NOT a silent upsert: if the
// migration never ran, the honest answer is "run the migration", because an
// upserted row would believe 001/002/003 happened.
// ─────────────────────────────────────────────────────────────────────────────
import { query, queryOne, execute } from "../config/database";
import { invalidateConfigCache } from "./config";
import { getBuildCommit } from "./offerWorker";

export type FeatureKey = "matching" | "destination" | "performance_tier";
export const FEATURE_KEYS: FeatureKey[] = ["matching", "destination", "performance_tier"];

export class FeatureFlagError extends Error {
  code: "validation" | "no_row" | "not_found";
  constructor(code: FeatureFlagError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

type FieldType = "boolean" | "string[]" | "mode" | "percent";

/** THE allow-list of settable fields. Anything else ⇒ 400 validation error. */
const SETTABLE: Record<FeatureKey, Record<string, FieldType>> = {
  matching: {
    h3_matching_enabled: "boolean",
    h3_rollout_mode: "mode",
    h3_rollout_rider_ids: "string[]",
    h3_rollout_percent: "percent",
  },
  destination: {
    destination_matching_enabled: "boolean",
    destination_rollout_mode: "mode",
    destination_rollout_driver_ids: "string[]",
  },
  performance_tier: {
    performance_tier_enabled: "boolean",
    performance_tier_rollout_mode: "mode",
    performance_tier_rollout_driver_ids: "string[]",
  },
};

const H3_MODES = ["off", "allowlist", "percent", "all"];
/** destination / tier only need these two — no percent bucketing for drivers. */
const DRIVER_ROLLOUT_MODES = ["allowlist", "all"];

function isFeatureKey(k: unknown): k is FeatureKey {
  return typeof k === "string" && (FEATURE_KEYS as string[]).includes(k);
}

function normId(id: unknown): string {
  if (typeof id !== "string") throw new FeatureFlagError("validation", `invalid id: ${JSON.stringify(id)}`);
  const s = id.trim().toLowerCase();
  if (!s || s.length > 80) throw new FeatureFlagError("validation", `invalid id: ${JSON.stringify(id)}`);
  return s;
}

function normIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) throw new FeatureFlagError("validation", "allowlist must be an array of ids");
  if (ids.length > 500) throw new FeatureFlagError("validation", "allowlist too long (max 500)");
  return [...new Set(ids.map((x) => normId(x)))];
}

/** Validate one field against SETTABLE; throws FeatureFlagError on anything unexpected. */
export function validateField(key: FeatureKey, field: string, value: unknown): unknown {
  const type = SETTABLE[key]?.[field];
  if (!type) {
    throw new FeatureFlagError(
      "validation",
      `unknown field '${field}' for '${key}' — allowed: ${Object.keys(SETTABLE[key] || {}).join(", ")}`,
    );
  }
  switch (type) {
    case "boolean":
      if (typeof value !== "boolean") throw new FeatureFlagError("validation", `${field} must be true/false`);
      return value;
    case "string[]":
      return normIds(value);
    case "mode": {
      // matching keeps its four-step ladder; destination/tier only have
      // allowlist vs all (the enabled boolean is the kill switch).
      const modes = key === "matching" ? H3_MODES : DRIVER_ROLLOUT_MODES;
      if (typeof value !== "string" || !modes.includes(value)) {
        throw new FeatureFlagError("validation", `${field} must be one of ${modes.join("|")}`);
      }
      return value;
    }
    case "percent": {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
        throw new FeatureFlagError("validation", `${field} must be a number 0..100`);
      }
      return Math.floor(value);
    }
  }
}

/** One structured JSON audit line per write — greppable in CloudWatch. */
function audit(actor: string, action: string, detail: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      audit: "features",
      actor,
      action,
      ...detail,
    }),
  );
}

async function readRow(key: FeatureKey): Promise<Record<string, unknown> | null> {
  try {
    const row = await queryOne<{ value: any }>("SELECT value FROM app_config WHERE key = $1", [key]);
    if (!row) return null;
    return (row.value && typeof row.value === "object" ? row.value : {}) as Record<string, unknown>;
  } catch (err: any) {
    // app_config missing entirely (001 never ran) — same honest answer as no row.
    throw new FeatureFlagError("no_row", `app_config is not readable (${err?.message || err}) — run migrations with RUN_MIGRATIONS_ON_BOOT=true`);
  }
}

/** Project the raw JSONB row into the operator-facing section (or explain why absent). */
function section(key: FeatureKey, row: Record<string, unknown> | null): Record<string, unknown> {
  if (!row) return { exists: false, error: "config row missing — apply the migration" };
  if (key === "matching") {
    return {
      exists: true,
      h3_matching_enabled: row.h3_matching_enabled === true,
      h3_rollout_mode: typeof row.h3_rollout_mode === "string" ? row.h3_rollout_mode : "off",
      h3_rollout_rider_ids: Array.isArray(row.h3_rollout_rider_ids) ? row.h3_rollout_rider_ids : [],
      h3_rollout_percent: typeof row.h3_rollout_percent === "number" ? row.h3_rollout_percent : 0,
    };
  }
  if (key === "destination") {
    return {
      exists: true,
      destination_matching_enabled: row.destination_matching_enabled === true,
      destination_rollout_mode:
        row.destination_rollout_mode === "all" || row.destination_rollout_mode === "allowlist"
          ? row.destination_rollout_mode
          : "allowlist",
      destination_rollout_driver_ids: Array.isArray(row.destination_rollout_driver_ids)
        ? row.destination_rollout_driver_ids
        : [],
    };
  }
  return {
    exists: true,
    performance_tier_enabled: row.performance_tier_enabled === true,
    performance_tier_rollout_mode:
      row.performance_tier_rollout_mode === "all" || row.performance_tier_rollout_mode === "allowlist"
        ? row.performance_tier_rollout_mode
        : "allowlist",
    performance_tier_rollout_driver_ids: Array.isArray(row.performance_tier_rollout_driver_ids)
      ? row.performance_tier_rollout_driver_ids
      : [],
  };
}

/** Last 5 rides' matching paths (Item 1b.4) — path + reason + radius per ride. */
async function recentMatchingPaths(): Promise<Array<Record<string, unknown>>> {
  try {
    const rows = await query<{
      ride_id: string;
      detail: any;
      created_at: string;
    }>(
      `SELECT ride_id, detail, created_at FROM (
         SELECT DISTINCT ON (ride_id) ride_id, detail, created_at, id
           FROM ride_events
          WHERE event = 'trace:matching_path'
          ORDER BY ride_id, id DESC
       ) t
       ORDER BY id DESC
       LIMIT 5`,
    );
    return rows.map((r) => ({
      ride_id: r.ride_id,
      path: r.detail?.path ?? null,
      reason: r.detail?.reason ?? null,
      radius_km: r.detail?.radius_km ?? null,
      at: r.created_at,
    }));
  } catch {
    // ride_events missing (fresh DB) — no paths to show, never an error.
    return [];
  }
}

/** Full operator view: all three flags/allowlists + last rides + server build. */
export async function readFeatures(): Promise<Record<string, unknown>> {
  const [m, d, t] = await Promise.all([readRow("matching"), readRow("destination"), readRow("performance_tier")]);
  return {
    server_build: getBuildCommit(),
    flags: {
      matching: section("matching", m),
      destination: section("destination", d),
      performance_tier: section("performance_tier", t),
    },
    recent_matching_paths: await recentMatchingPaths(),
  };
}

/** Read-modify-write one app_config row with validated patches; audit + invalidate. */
async function writeFeatureValue(
  key: FeatureKey,
  patch: Record<string, unknown>,
  actor: string,
  action: string,
): Promise<Record<string, unknown>> {
  const row = await readRow(key);
  if (!row) throw new FeatureFlagError("no_row", `app_config row '${key}' missing — run migrations first (RUN_MIGRATIONS_ON_BOOT=true)`);
  const next = { ...row, ...patch };
  await execute("UPDATE app_config SET value = $2::jsonb WHERE key = $1", [
    key,
    JSON.stringify(next),
  ]);
  invalidateConfigCache();
  audit(actor, action, { key, patch });
  return section(key, next);
}

/** Validate + apply one flag update. Validated keys only — never a money column. */
export async function updateFeature(
  key: unknown,
  changes: unknown,
  actor: string,
): Promise<Record<string, unknown>> {
  if (!isFeatureKey(key)) {
    throw new FeatureFlagError("validation", `key must be one of ${FEATURE_KEYS.join(", ")}`);
  }
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
    throw new FeatureFlagError("validation", "changes must be an object like {\"h3_matching_enabled\": true}");
  }
  const entries = Object.entries(changes as Record<string, unknown>);
  if (entries.length === 0) throw new FeatureFlagError("validation", "changes is empty");
  const patch: Record<string, unknown> = {};
  for (const [field, value] of entries) patch[field] = validateField(key, field, value);
  const updated = await writeFeatureValue(key, patch, actor, "update");
  return { server_build: getBuildCommit(), flags: { [key]: updated } };
}

// ── One-call enable for test accounts (Item 1b.3) ────────────────────────────

function normEmails(v: unknown): string[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new FeatureFlagError("validation", "emails must be an array");
  return [...new Set(v.map((e) => String(e ?? "").trim().toLowerCase()).filter((e) => e.includes("@") && e.length < 254))];
}

function normPhones(v: unknown): string[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new FeatureFlagError("validation", "phones must be an array");
  return [
    ...new Set(
      v
        .map((p) => String(p ?? "").replace(/[^0-9]/g, ""))
        .filter((p) => p.length >= 7 && p.length <= 15),
    ),
  ];
}

/** Resolve emails/phones to users.id — so the operator never needs raw ids. */
async function resolveUsers(emails: string[], phones: string[]): Promise<Array<{ id: string; role: string; email: string | null }>> {
  if (emails.length === 0 && phones.length === 0) return [];
  try {
    return await query(
      `SELECT id, role, lower(email) AS email
         FROM users
        WHERE lower(coalesce(email, '')) = ANY($1::text[])
           OR regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = ANY($2::text[])`,
      [emails, phones],
    );
  } catch (err: any) {
    throw new FeatureFlagError("validation", `user lookup failed: ${err?.message || err}`);
  }
}

export interface EnableInput {
  driverIds?: string[];
  riderIds?: string[];
  driverEmails?: string[];
  driverPhones?: string[];
  riderEmails?: string[];
  riderPhones?: string[];
  /** Subset of the three keys; default = all three. */
  features?: string[];
}

async function mergedIds(key: FeatureKey, field: string, extra: string[]): Promise<string[]> {
  const row = await readRow(key);
  const existing = Array.isArray(row?.[field]) ? (row![field] as unknown[]).map((x) => String(x).toLowerCase()) : [];
  return [...new Set([...existing, ...extra])];
}

/**
 * ONE call: turn all three features OFF for everyone — the exact inverse of
 * enableForAccounts. Restores the seed posture: matching kill switch off +
 * mode 'off'; destination/tier kill switches off + modes back to 'allowlist'.
 * Recorded allowlists are left alone: with the switches off they cover
 * nobody, and keeping them makes re-enabling the same test accounts one call.
 * Like everything in this service, it can never touch a money column.
 */
export async function disableAllFeatures(actor: string): Promise<Record<string, unknown>> {
  const flags: Record<string, unknown> = {};
  flags.matching = await writeFeatureValue(
    "matching",
    { h3_matching_enabled: false, h3_rollout_mode: "off" },
    actor,
    "disable",
  );
  flags.destination = await writeFeatureValue(
    "destination",
    { destination_matching_enabled: false, destination_rollout_mode: "allowlist" },
    actor,
    "disable",
  );
  flags.performance_tier = await writeFeatureValue(
    "performance_tier",
    { performance_tier_enabled: false, performance_tier_rollout_mode: "allowlist" },
    actor,
    "disable",
  );
  return { server_build: getBuildCommit(), flags };
}
/**
 * One call: turn the three features ON for the given test accounts — or, with
 * no account ids at all, FOR EVERYONE:
 * matching  → enabled; rider ids ⇒ rollout 'allowlist' (those riders), no
 *             rider ids ⇒ rollout 'all' (H3 for every rider).
 * destination / performance_tier → enabled; driver ids ⇒ mode 'allowlist'
 *             with the ids merged in, no driver ids ⇒ mode 'all' (every
 *             driver). Returns the exact JSON that GET /features reads back.
 */
export async function enableForAccounts(input: EnableInput, actor: string): Promise<Record<string, unknown>> {
  const features = Array.isArray(input.features) && input.features.length > 0 ? input.features : FEATURE_KEYS;
  for (const f of features) {
    if (!isFeatureKey(f)) throw new FeatureFlagError("validation", `unknown feature '${f}' — allowed: ${FEATURE_KEYS.join(", ")}`);
  }
  const dUsers = await resolveUsers(normEmails(input.driverEmails), normPhones(input.driverPhones));
  const rUsers = await resolveUsers(normEmails(input.riderEmails), normPhones(input.riderPhones));
  const allDriverIds = [...new Set([...normIds(input.driverIds ?? []), ...dUsers.map((u) => u.id.toLowerCase())])];
  const allRiderIds = [...new Set([...normIds(input.riderIds ?? []), ...rUsers.map((u) => u.id.toLowerCase())])];

  const flags: Record<string, unknown> = {};
  if (features.includes("matching")) {
    const patch: Record<string, unknown> = { h3_matching_enabled: true };
    if (allRiderIds.length > 0) {
      patch.h3_rollout_mode = "allowlist";
      patch.h3_rollout_rider_ids = await mergedIds("matching", "h3_rollout_rider_ids", allRiderIds);
    } else {
      patch.h3_rollout_mode = "all";
    }
    flags.matching = await writeFeatureValue("matching", patch, actor, "enable");
  }
  if (features.includes("destination")) {
    const patch: Record<string, unknown> = { destination_matching_enabled: true };
    if (allDriverIds.length > 0) {
      patch.destination_rollout_mode = "allowlist";
      patch.destination_rollout_driver_ids = await mergedIds(
        "destination",
        "destination_rollout_driver_ids",
        allDriverIds,
      );
    } else {
      patch.destination_rollout_mode = "all";
    }
    flags.destination = await writeFeatureValue("destination", patch, actor, "enable");
  }
  if (features.includes("performance_tier")) {
    const patch: Record<string, unknown> = { performance_tier_enabled: true };
    if (allDriverIds.length > 0) {
      patch.performance_tier_rollout_mode = "allowlist";
      patch.performance_tier_rollout_driver_ids = await mergedIds(
        "performance_tier",
        "performance_tier_rollout_driver_ids",
        allDriverIds,
      );
    } else {
      patch.performance_tier_rollout_mode = "all";
    }
    flags.performance_tier = await writeFeatureValue("performance_tier", patch, actor, "enable");
  }

  return {
    server_build: getBuildCommit(),
    resolved: {
      driver_users: dUsers,
      rider_users: rUsers,
      driver_ids: allDriverIds,
      rider_ids: allRiderIds,
    },
    flags,
  };
}
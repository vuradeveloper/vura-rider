// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER SEAMS — every external map/geocode/route provider the SERVER calls,
// resolved from env in ONE place, with one rule:
//
//   PRODUCTION NEVER USES A PUBLIC DEMO ENDPOINT.
//
//   • env var set            -> use it (source: "env")
//   • unset, NOT production  -> today's public demo URL (source: "public-demo")
//                               so local/dev flows keep working unchanged
//   • unset, production      -> null (source: "none"): the caller FAILS HONEST
//                               (503 / empty answer) instead of silently
//                               leaning on a server whose usage policy bans
//                               production traffic (router.project-osrm.org,
//                               nominatim.openstreetmap.org, tile.openstreetmap.org)
//
// Boot prints the whole table once via logProviderSeams() (index.ts, next to
// logEtaProviderStatus), so an operator can read from the log EXACTLY which
// provider every seam will use — and whether a required env var is missing —
// without reading this file. The ETA seam (ROUTE_PROVIDER_URL for road ETA)
// lives in services/eta.ts and logs separately; route.ts reuses this module
// for the rider-route seam of the SAME env var.
// ─────────────────────────────────────────────────────────────────────────────

export type SeamSource = "env" | "public-demo" | "none";

export interface SeamDecision {
  /** null only when production has no env var — never a silent demo fallback. */
  url: string | null;
  source: SeamSource;
}

const PUBLIC_OSRM_DEMO = "https://router.project-osrm.org";
const PUBLIC_NOMINATIM = "https://nominatim.openstreetmap.org";
const PUBLIC_OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

type EnvLike = Record<string, string | undefined>;

function envUrl(env: EnvLike, key: string): string | null {
  const raw = env[key];
  const v = typeof raw === "string" ? raw.trim() : "";
  return v ? v.replace(/\/+$/, "") : null;
}

function isProduction(nodeEnv: string | undefined): boolean {
  return nodeEnv === "production";
}

/** GET /api/route upstream (OSRM-compatible). */
export function routeProvider(
  env: EnvLike = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV
): SeamDecision {
  const url = envUrl(env, "ROUTE_PROVIDER_URL");
  if (url) return { url, source: "env" };
  if (isProduction(nodeEnv)) return { url: null, source: "none" };
  return { url: PUBLIC_OSRM_DEMO, source: "public-demo" };
}

/** Nominatim-compatible geocoder behind the search fallback. */
export function geocoderProvider(
  env: EnvLike = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV
): SeamDecision {
  const url = envUrl(env, "NOMINATIM_URL");
  if (url) return { url, source: "env" };
  if (isProduction(nodeEnv)) return { url: null, source: "none" };
  return { url: PUBLIC_NOMINATIM, source: "public-demo" };
}

/** Raster tiles for the rider trip-share page (server-rendered Leaflet). */
export function shareTileProvider(
  env: EnvLike = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV
): SeamDecision {
  const url = envUrl(env, "SHARE_TILE_URL");
  if (url) return { url, source: "env" };
  if (isProduction(nodeEnv)) return { url: null, source: "none" };
  return { url: PUBLIC_OSM_TILES, source: "public-demo" };
}

export type SearchChoice = "here_then_nominatim" | "here_only" | "nominatim_only";

/**
 * SEARCH_PROVIDER (documented in deploy/SELFHOST-MAPS.md — this is the code
 * that actually reads it):
 *   unset / other -> HERE first, Nominatim fallback (today's behaviour)
 *   "here"        -> HERE only; an empty HERE answer stays empty (no OSM leg)
 *   "nominatim"   -> skip HERE entirely (self-hosted-geocoder deployments)
 */
export function searchProviderChoice(env: EnvLike = process.env): SearchChoice {
  const v = String(env.SEARCH_PROVIDER ?? "").trim().toLowerCase();
  if (v === "nominatim") return "nominatim_only";
  if (v === "here") return "here_only";
  return "here_then_nominatim";
}

/** One human line per seam — the boot log and its unit test share this. */
function seamLine(name: string, decision: SeamDecision): string {
  if (decision.source === "env") return `${name}: ${decision.url} (env)`;
  if (decision.source === "public-demo") {
    return `${name}: ${decision.url} (public demo — dev only, never production)`;
  }
  return `${name}: NOT CONFIGURED — production needs the env var; calls fail honestly (503) instead of using the public demo`;
}

/** The full boot table, as plain lines (pure — tests assert on this). */
export function describeProviderSeams(
  env: EnvLike = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV
): string[] {
  return [
    seamLine("ROUTE_PROVIDER_URL (rider route + matching ETA)", routeProvider(env, nodeEnv)),
    seamLine("NOMINATIM_URL (geocode fallback)", geocoderProvider(env, nodeEnv)),
    seamLine("SHARE_TILE_URL (trip-share page tiles)", shareTileProvider(env, nodeEnv)),
    `SEARCH_PROVIDER: ${searchProviderChoice(env)}${env.HERE_API_KEY ? " (HERE_API_KEY present)" : " (HERE_API_KEY absent)"}`,
  ];
}

/** Print the seam table ONCE at boot (index.ts calls this). */
export function logProviderSeams(
  env: EnvLike = process.env,
  nodeEnv: string | undefined = process.env.NODE_ENV
): void {
  console.log("[providers] external provider seams (env-driven; no public demo in production):");
  for (const line of describeProviderSeams(env, nodeEnv)) {
    console.log(`[providers]   ${line}`);
  }
}

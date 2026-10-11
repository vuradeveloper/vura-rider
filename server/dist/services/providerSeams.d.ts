export type SeamSource = "env" | "public-demo" | "none";
export interface SeamDecision {
    /** null only when production has no env var — never a silent demo fallback. */
    url: string | null;
    source: SeamSource;
}
type EnvLike = Record<string, string | undefined>;
/** GET /api/route upstream (OSRM-compatible). */
export declare function routeProvider(env?: EnvLike, nodeEnv?: string | undefined): SeamDecision;
/** Nominatim-compatible geocoder behind the search fallback. */
export declare function geocoderProvider(env?: EnvLike, nodeEnv?: string | undefined): SeamDecision;
/** Raster tiles for the rider trip-share page (server-rendered Leaflet). */
export declare function shareTileProvider(env?: EnvLike, nodeEnv?: string | undefined): SeamDecision;
export type SearchChoice = "here_then_nominatim" | "here_only" | "nominatim_only";
/**
 * SEARCH_PROVIDER (documented in deploy/SELFHOST-MAPS.md — this is the code
 * that actually reads it):
 *   unset / other -> HERE first, Nominatim fallback (today's behaviour)
 *   "here"        -> HERE only; an empty HERE answer stays empty (no OSM leg)
 *   "nominatim"   -> skip HERE entirely (self-hosted-geocoder deployments)
 */
export declare function searchProviderChoice(env?: EnvLike): SearchChoice;
/** The full boot table, as plain lines (pure — tests assert on this). */
export declare function describeProviderSeams(env?: EnvLike, nodeEnv?: string | undefined): string[];
/** Print the seam table ONCE at boot (index.ts calls this). */
export declare function logProviderSeams(env?: EnvLike, nodeEnv?: string | undefined): void;
export {};
//# sourceMappingURL=providerSeams.d.ts.map
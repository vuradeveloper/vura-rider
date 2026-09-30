declare const router: import("express-serve-static-core").Router;
/**
 * WeGo's list is HERE's own relevance order - which is already proximity-aware because we
 * always send `at` - with the distance shown as a badge. Re-ranking here was tempting and
 * wrong: any heuristic that promotes "nearest" can bury the place the rider meant (the
 * canonical Fourways Farmers Market lost to a small shop 60 km out when we sorted by
 * distance alone). So the provider's order is preserved, exactly.
 */
export interface SearchBias {
    lat: number;
    lng: number;
    /** client | last_ride | last_search - shown in the response so this is never a mystery. */
    source: string;
}
export default router;
//# sourceMappingURL=search.d.ts.map
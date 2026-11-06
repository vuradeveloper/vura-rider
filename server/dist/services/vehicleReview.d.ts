import type { TierAssignment } from "../lib/tier-classifier";
import type { AdminActor } from "./adminAuth";
export interface VehicleReviewResult {
    assignments: TierAssignment[];
    primary_tier: string | null;
    needs_review: boolean;
    review_reason: string | null;
    categories: string[];
}
export declare function vehicleReviewKey(p: {
    vehicle_make?: unknown;
    vehicle_model?: unknown;
    vehicle_year?: unknown;
}): string;
/**
 * A confident catalog match still needs ride classes for dispatch. CarScan
 * normally supplies them; when it did not, map the classifier tier onto the
 * canonical tokens. Explicit CarScan classes always win, so this only fills an
 * empty list.
 */
export declare function categoriesForTier(tier: string | null, assignments: TierAssignment[]): string[];
/**
 * Create the additive columns and flag rows that already have no ride classes.
 * Safe to call on every boot and on every route; the first call does the work.
 */
export declare function ensureVehicleReviewSchema(): Promise<void>;
/**
 * Classify the car currently stored on the driver's profile and persist the
 * result. Returns null when the driver has no profile row.
 *
 * Missing details are a review reason, not a crash: an admin can set the ride
 * classes even when the scan omitted the body type or year.
 */
export declare function classifyDriverVehicle(driverId: string): Promise<VehicleReviewResult | null>;
/**
 * One boot-time pass over cars that have never been reviewed. This is what
 * turns the existing fleet into a real review queue instead of only flagging
 * cars saved after this feature ships. Small and bounded; failures on one car
 * never stop the rest.
 */
export declare function sweepVehicleClassification(limit?: number): Promise<number>;
/** Admin action: set the ride classes and close the review. Audited. */
export declare function saveVehicleClasses(driverId: string, rawCategories: unknown, actor: AdminActor, note?: string): Promise<any | null>;
/** Admin action: suspend or reactivate one vehicle. Audited. */
export declare function setVehicleSuspended(driverId: string, suspended: boolean, actor: AdminActor, reason?: string): Promise<any | null>;
/** Admin action: set the expiry of the latest vehicle document of one type. */
export declare function setVehicleDocExpiry(driverId: string, docType: string, expiresAt: string | null, actor: AdminActor): Promise<any | null>;
//# sourceMappingURL=vehicleReview.d.ts.map
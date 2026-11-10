import { Request, Response } from "express";
declare const router: import("express-serve-static-core").Router;
/**
 * A completed/cancelled trip (or a rider who pressed "Stop sharing") must never
 * expose the driver's live position. The page also hides the car marker, but the
 * API is the real boundary: no coordinates leave the server once the trip is
 * over. Pure function so the privacy rule is unit-testable.
 */
export declare function shareLocationHidden(status: unknown, sharingEnded: boolean): boolean;
/** Build the public payload, stripping live coordinates as soon as the trip is over. */
export declare function shareRidePayload(ride: any, sharingEnded: boolean): {
    id: any;
    status: string;
    tripDone: boolean;
    hasDriver: boolean;
    pickupAddress: any;
    pickup: number[] | null;
    destinationAddress: any;
    destination: number[] | null;
    createdAt: any;
    driverName: any;
    driverPhotoUrl: any;
    driverRating: number;
    vehicleMake: any;
    vehicleModel: any;
    vehicleColor: any;
    vehicleImageUrl: any;
    licensePlate: any;
    driverLat: number | null;
    driverLng: number | null;
    driverHeading: number | null;
    sharingEnded: boolean;
};
export declare function sharePage(req: Request, res: Response): Promise<void>;
export default router;
//# sourceMappingURL=share.d.ts.map
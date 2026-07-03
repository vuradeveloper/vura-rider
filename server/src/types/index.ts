export interface User {
  id: string;
  firebase_uid: string;
  role: "driver" | "passenger";
  full_name: string | null;
  email: string | null;
  phone: string | null;
  profile_photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface DriverProfile {
  id: string;
  user_id: string;
  license_number: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  license_plate: string | null;
  is_online: boolean;
  is_verified: boolean;
  current_lat: number | null;
  current_lng: number | null;
  current_heading: number | null;
  current_speed: number | null;
  total_rides: number;
  average_rating: number;
  created_at: string;
  updated_at: string;
}

export type UserWithDriver = User & {
  driver_profile: DriverProfile | null;
};

export type RideStatus =
  | "searching"
  | "accepted"
  | "driver_arrived"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface Ride {
  id: string;
  passenger_id: string;
  driver_id: string | null;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  destination_address: string;
  destination_lat: number;
  destination_lng: number;
  status: RideStatus;
  fare: number | null;
  distance_km: number | null;
  duration_mins: number | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface RideWithDetails extends Ride {
  passenger_name: string | null;
  passenger_phone: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  driver_vehicle: string | null;
  driver_license_plate: string | null;
  driver_lat: number | null;
  driver_lng: number | null;
  driver_heading: number | null;
}

export interface DriverEarning {
  id: string;
  driver_id: string;
  ride_id: string;
  gross_fare: number;
  service_fee: number;
  net_earnings: number;
  distance_km: number;
  duration_mins: number;
  created_at: string;
}

export interface Rating {
  id: string;
  ride_id: string;
  passenger_id: string;
  driver_id: string;
  score: number;
  comment: string | null;
  created_at: string;
}

export interface EarningsSummary {
  totals: {
    rides: number;
    gross: number;
    fee: number;
    net: number;
  };
  breakdown: {
    date: string;
    rides: number;
    gross: number;
    fee: number;
    net: number;
  }[];
}

export interface DriverStats {
  today: { rides: number; earned: number };
  thisMonth: { rides: number; earned: number };
  allTime: { rides: number; earned: number };
  rating: { average: number; total: number };
}

export interface PaymentMethod {
  id: string;
  user_id: string;
  authorization_code: string;
  card_type: string | null;
  last4: string | null;
  bank: string | null;
  is_default: boolean;
  created_at: string;
}

export interface Payment {
  id: string;
  ride_id: string;
  user_id: string;
  amount: number;
  reference: string;
  status: "pending" | "success" | "failed";
  paid_at: string | null;
  created_at: string;
}

export interface DriverPayout {
  id: string;
  driver_id: string;
  amount: number;
  reference: string | null;
  ride_count: number;
  status: "pending" | "processing" | "paid" | "failed";
  failure_reason: string | null;
  period_start: string | null;
  period_end: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface RideRequestPayload {
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
}

export interface AuthRequest extends Express.Request {
  user?: {
    firebase_uid: string;
    dbUser: User;
  };
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        firebase_uid: string;
        dbUser: User;
      };
    }
  }
}

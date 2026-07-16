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
  waypoints: Waypoint[] | null;
  status: RideStatus;
  fare: number | null;
  ride_request_fee: number | null;
  distance_km: number | null;
  duration_mins: number | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RideWithDetails extends Ride {
  passenger_name: string | null;
  passenger_phone: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  driver_license_plate: string | null;
  driver_lat: number | null;
  driver_lng: number | null;
  driver_heading: number | null;
  my_rating?: number | null;
  rating_score?: number | null;
  rating_comment?: string | null;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface RideHistoryResponse {
  rides: RideWithDetails[];
  pagination: Pagination;
}

export interface DriverStats {
  today: { rides: number; earned: number };
  thisMonth: { rides: number; earned: number };
  allTime: { rides: number; earned: number };
  rating: { average: number; total: number };
}

export interface EarningsSummary {
  totals: {
    rides: number;
    gross: number;
    fee: number;
    request_fee: number;
    net: number;
  };
  breakdown: {
    date: string;
    rides: number;
    gross: number;
    fee: number;
    request_fee: number;
    net: number;
  }[];
}

export interface SavedCard {
  id: string;
  card_type: string | null;
  last4: string | null;
  bank: string | null;
  is_default: boolean;
}

export interface PendingEarnings {
  total_rides: number;
  total_earnings: number;
}

export interface Waypoint {
  address: string;
  lat: number;
  lng: number;
}

export interface RecentSearch {
  id: string;
  name: string;
  addr: string;
  lat: number;
  lng: number;
  created_at: string;
}

export interface NearbyDriver {
  id: string;
  full_name: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_color: string | null;
  license_plate: string | null;
  current_lat: number | null;
  current_lng: number | null;
  current_heading: number | null;
  average_rating: number;
}

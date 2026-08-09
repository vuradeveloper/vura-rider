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

export interface RideReceipt {
  id: string;
  ride_id: string;
  receipt_number: string;
  driver_name: string;
  driver_phone: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  license_plate: string | null;
  pickup_address: string;
  destination_address: string;
  distance_km: number;
  duration_mins: number;
  fare: number;
  ride_request_fee: number;
  payment_method: string | null;
  payment_status: string;
  created_at: string;
  completed_at: string;
}

export interface ChatMessage {
  id: string;
  ride_id: string;
  sender_id: string;
  sender_role: "rider" | "driver";
  message: string;
  created_at: string;
}

export interface TipOption {
  amount: number;
  label: string;
}

export interface TipData {
  ride_id: string;
  tip_amount: number;
  payment_method_id?: string;
}

export interface SplitFare {
  id: string;
  ride_id: string;
  inviter_id: string;
  invitee_id: string;
  invitee_email: string;
  amount: number;
  status: "pending" | "accepted" | "declined" | "paid";
  created_at: string;
  updated_at: string;
}

export interface SplitFareInvite {
  ride_id: string;
  inviter_name: string;
  inviter_email: string;
  amount: number;
  split_id: string;
}

export interface ScheduledRide {
  id: string;
  passenger_id: string;
  pickup_address: string;
  pickup_lat: number;
  pickup_lng: number;
  destination_address: string;
  destination_lat: number;
  destination_lng: number;
  waypoints: Waypoint[] | null;
  scheduled_at: string;
  status: "pending" | "accepted" | "in_progress" | "completed" | "cancelled";
  tier: string;
  driver_id: string | null;
  driver_name: string | null;
  created_at: string;
}

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relationship: string;
}

export interface SafetyEvent {
  id: string;
  ride_id: string;
  type: "sos" | "ridecheck" | "share_started" | "share_ended";
  data: any;
  created_at: string;
}

export interface Dispute {
  id: string;
  ride_id: string;
  type: "cancellation_fee" | "lost_item" | "refund" | "rating" | "other";
  reason: string;
  description: string;
  status: "open" | "investigating" | "resolved" | "rejected";
  resolution: string | null;
  created_at: string;
  updated_at: string;
}

export interface LostItemReport {
  id: string;
  ride_id: string;
  item_name: string;
  item_description: string;
  driver_contacted: boolean;
  status: "reported" | "found" | "closed";
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

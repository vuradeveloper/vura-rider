import { apiFetch } from "@/lib/api";
import type { ScheduledRide } from "@/lib/types";

export const scheduleRide = async (data: {
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  destinationAddress: string;
  destinationLat: number;
  destinationLng: number;
  waypoints?: { address: string; lat: number; lng: number }[];
  scheduledAt: string;
  tier: string;
}) =>
  apiFetch<{ ride: ScheduledRide }>("/api/rides/schedule", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const getScheduledRides = async () =>
  apiFetch<{ rides: ScheduledRide[] }>("/api/rides/scheduled");

export const cancelScheduledRide = async (id: string) =>
  apiFetch(`/api/rides/scheduled/${id}/cancel`, { method: "POST" });

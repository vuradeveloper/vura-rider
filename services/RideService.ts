import { apiFetch } from "@/lib/api";
import type {
  RideHistoryResponse,
  RideWithDetails,
  RideReceipt,
} from "@/lib/types";

export const getActiveRide = async () =>
  apiFetch<{ ride: RideWithDetails | null }>("/api/rides/me/active");

export const getRideHistory = async (page = 1, limit = 20) =>
  apiFetch<RideHistoryResponse>(
    `/api/rides/history?page=${page}&limit=${limit}`
  );

export const getRide = async (id: string) =>
  apiFetch<{ ride: RideWithDetails }>(`/api/rides/${id}`);

export const getRideReceipt = async (rideId: string) =>
  apiFetch<{ receipt: RideReceipt }>(`/api/rides/${rideId}/receipt`);

export const submitRating = async (
  rideId: string,
  score: number,
  comment?: string
) =>
  apiFetch("/api/ratings", {
    method: "POST",
    body: JSON.stringify({ rideId, score, comment }),
  });

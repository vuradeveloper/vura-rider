import { apiFetch } from "@/lib/api";
import type {
  DriverStats,
  EarningsSummary,
  NearbyDriver,
} from "@/lib/types";

export const getDriverStats = async () =>
  apiFetch<DriverStats>("/api/drivers/stats");

export const getEarnings = async (
  period: "today" | "week" | "month" | "year" = "week"
) => apiFetch<EarningsSummary>(`/api/earnings?period=${period}`);

export const getNearbyDrivers = async (
  lat: number,
  lng: number,
  radius = 10
) =>
  apiFetch<{ drivers: NearbyDriver[] }>(
    `/api/drivers/nearby?lat=${lat}&lng=${lng}&radius=${radius}`
  );

export const updateDriverProfile = async (profile: {
  license_number?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_year?: number;
  vehicle_color?: string;
  license_plate?: string;
}) =>
  apiFetch("/api/drivers/profile", {
    method: "PATCH",
    body: JSON.stringify(profile),
  });

import { apiFetch } from "@/lib/api";

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  rideId: string | null;
  createdAt: string;
}

export const getNotifications = async () =>
  apiFetch<{ notifications: AppNotification[] }>("/api/notifications/history");
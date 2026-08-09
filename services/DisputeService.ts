import { apiFetch } from "@/lib/api";
import type { Dispute, LostItemReport } from "@/lib/types";

export const submitDispute = async (data: {
  rideId: string;
  type: string;
  reason: string;
  description: string;
}) =>
  apiFetch<{ dispute: Dispute }>("/api/disputes", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const getDisputes = async () =>
  apiFetch<{ disputes: Dispute[] }>("/api/disputes");

export const reportLostItem = async (data: {
  rideId: string;
  itemName: string;
  itemDescription: string;
}) =>
  apiFetch<{ report: LostItemReport }>("/api/disputes/lost-item", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const getLostItemReports = async () =>
  apiFetch<{ reports: LostItemReport[] }>("/api/disputes/lost-items");

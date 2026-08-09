import { apiFetch } from "@/lib/api";

export const submitTip = async (rideId: string, amount: number) =>
  apiFetch("/api/tips", {
    method: "POST",
    body: JSON.stringify({ rideId, amount }),
  });

export const getTipSuggestions = (fare: number): { amount: number; label: string }[] => [
  { amount: Math.round(fare * 0.1 * 100) / 100, label: "10%" },
  { amount: Math.round(fare * 0.15 * 100) / 100, label: "15%" },
  { amount: Math.round(fare * 0.2 * 100) / 100, label: "20%" },
  { amount: Math.round(fare * 0.25 * 100) / 100, label: "25%" },
];

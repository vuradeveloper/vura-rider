import { apiFetch } from "@/lib/api";

export const submitTip = async (rideId: string, amount: number, paymentMethodId?: string) =>
  apiFetch<{ success: boolean; amount: number; reference?: string }>("/api/tips", {
    method: "POST",
    body: JSON.stringify({ rideId, amount, paymentMethodId }),
  });

// Saved cards available for tipping. Used on the receipt screen so a rider who
// paid cash can pick which card the tip is charged to.
export const getSavedCards = async () =>
  apiFetch<Array<{ id: string; card_type?: string; last4?: string; is_default?: boolean }>>(
    "/api/payments/methods"
  ).catch(() => []);

export const getTipSuggestions = (fare: number): { amount: number; label: string }[] => [
  { amount: Math.round(fare * 0.1 * 100) / 100, label: "10%" },
  { amount: Math.round(fare * 0.15 * 100) / 100, label: "15%" },
  { amount: Math.round(fare * 0.2 * 100) / 100, label: "20%" },
  { amount: Math.round(fare * 0.25 * 100) / 100, label: "25%" },
];

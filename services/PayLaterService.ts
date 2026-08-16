import { apiFetch } from "@/lib/api";

export const getPayLaterStatus = async () =>
  apiFetch<any>("/api/payments/pay-later/status");

export const enrollPayLater = async (data: {
  accountHolder: string;
  bankCode: string;
  accountNumber: string;
  cardToken?: string;
  identityFingerprint?: string;
}) =>
  apiFetch<any>("/api/payments/pay-later/enroll", {
    method: "POST",
    body: JSON.stringify(data),
  });

export const refreshPayLater = async () =>
  apiFetch<any>("/api/payments/pay-later/refresh", {
    method: "POST",
  });

export const payLaterRide = async (rideId: string) =>
  apiFetch<any>(`/api/payments/pay-later/${rideId}/pay`, {
    method: "POST",
  });

// Dev helpers (mock mode only)
export const simulatePayLaterRide = async (rideId: string) =>
  apiFetch<any>("/api/payments/pay-later/dev/simulate", {
    method: "POST",
    body: JSON.stringify({ rideId }),
  });

export const runPayLaterCollection = async () =>
  apiFetch<any>("/api/payments/pay-later/collect", {
    method: "POST",
  });

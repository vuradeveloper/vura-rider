import { apiFetch } from "@/lib/api";

export const inviteToSplit = async (rideId: string, inviteeEmail: string, amount: number) =>
  apiFetch("/api/split/invite", {
    method: "POST",
    body: JSON.stringify({ rideId, inviteeEmail, amount }),
  });

export const respondToSplit = async (splitId: string, accept: boolean) =>
  apiFetch("/api/split/respond", {
    method: "POST",
    body: JSON.stringify({ splitId, accept }),
  });

export const getSplitStatus = async (rideId: string) =>
  apiFetch<{ splits: any[] }>(`/api/split/status?rideId=${rideId}`);

export const getPendingSplits = async () =>
  apiFetch<{ splits: any[] }>("/api/split/pending");

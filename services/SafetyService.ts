import { apiFetch } from "@/lib/api";
import type { EmergencyContact, SafetyEvent } from "@/lib/types";

export const getEmergencyContacts = async () =>
  apiFetch<{ contacts: EmergencyContact[] }>("/api/safety/contacts");

export const saveEmergencyContact = async (contact: {
  name: string;
  phone: string;
  relationship: string;
}) =>
  apiFetch("/api/safety/contacts", {
    method: "POST",
    body: JSON.stringify(contact),
  });

export const deleteEmergencyContact = async (id: string) =>
  apiFetch(`/api/safety/contacts/${id}`, { method: "DELETE" });

export const triggerSOS = async (rideId: string) =>
  apiFetch("/api/safety/sos", {
    method: "POST",
    body: JSON.stringify({ rideId }),
  });

export const shareTrip = async (rideId: string) =>
  apiFetch<{ shareToken: string; shareUrl: string }>("/api/safety/share", {
    method: "POST",
    body: JSON.stringify({ rideId }),
  });

export const stopSharingTrip = async (rideId: string) =>
  apiFetch("/api/safety/share/stop", {
    method: "POST",
    body: JSON.stringify({ rideId }),
  });

export const getSafetyEvents = async (rideId: string) =>
  apiFetch<{ events: SafetyEvent[] }>(`/api/safety/events?rideId=${rideId}`);

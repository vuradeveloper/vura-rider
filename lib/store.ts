import { create } from "zustand";
import type { RideWithDetails, Waypoint, NearbyDriver, EmergencyContact, ScheduledRide } from "./types";

interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  photoURL: string | null;
}

interface AppState {
  user: UserProfile | null;
  activeRide: RideWithDetails | null;
  pickup: [number, number] | null;
  pickupAddress: string | null;
  destination: [number, number] | null;
  destinationAddress: string | null;
  waypoints: Waypoint[];
  nearbyDrivers: NearbyDriver[];
  tipAmount: number | null;
  scheduledRides: ScheduledRide[];
  emergencyContacts: EmergencyContact[];
  splitFareId: string | null;
  isSharingTrip: boolean;
  shareToken: string | null;
  
  // Actions
  setUser: (user: UserProfile | null) => void;
  setActiveRide: (ride: RideWithDetails | null) => void;
  setPickup: (coords: [number, number] | null, address: string | null) => void;
  setDestination: (coords: [number, number] | null, address: string | null) => void;
  setWaypoints: (waypoints: Waypoint[]) => void;
  setNearbyDrivers: (drivers: NearbyDriver[]) => void;
  setTipAmount: (amount: number | null) => void;
  setScheduledRides: (rides: ScheduledRide[]) => void;
  addScheduledRide: (ride: ScheduledRide) => void;
  setEmergencyContacts: (contacts: EmergencyContact[]) => void;
  setSplitFareId: (id: string | null) => void;
  setTripSharing: (isSharing: boolean, token?: string | null) => void;
  resetRideState: () => void;
}

export const useAppStore = create<AppState>()((set) => ({
  user: null,
  activeRide: null,
  pickup: null,
  pickupAddress: null,
  destination: null,
  destinationAddress: null,
  waypoints: [],
  nearbyDrivers: [],
  tipAmount: null,
  scheduledRides: [],
  emergencyContacts: [],
  splitFareId: null,
  isSharingTrip: false,
  shareToken: null,

  setUser: (user) => set({ user }),
  setActiveRide: (activeRide) => set({ activeRide }),
  setPickup: (pickup, pickupAddress) => set({ pickup, pickupAddress }),
  setDestination: (destination, destinationAddress) => set({ destination, destinationAddress }),
  setWaypoints: (waypoints) => set({ waypoints }),
  setNearbyDrivers: (nearbyDrivers) => set({ nearbyDrivers }),
  setTipAmount: (tipAmount) => set({ tipAmount }),
  setScheduledRides: (scheduledRides) => set({ scheduledRides }),
  addScheduledRide: (ride) =>
    set((state) => ({ scheduledRides: [...state.scheduledRides, ride] })),
  setEmergencyContacts: (emergencyContacts) => set({ emergencyContacts }),
  setSplitFareId: (splitFareId) => set({ splitFareId }),
  setTripSharing: (isSharingTrip, shareToken = null) => set({ isSharingTrip, shareToken }),
  resetRideState: () =>
    set({
      activeRide: null,
      pickup: null,
      pickupAddress: null,
      destination: null,
      destinationAddress: null,
      waypoints: [],
      tipAmount: null,
      splitFareId: null,
      isSharingTrip: false,
      shareToken: null,
    }),
}));

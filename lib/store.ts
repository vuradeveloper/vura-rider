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
  rideMinimized: boolean;
  savedDemoRide: {
    status: string;
    driver_name?: string | null;
    driver_license_plate?: string | null;
    vehicle_make?: string | null;
    vehicle_model?: string | null;
    vehicle_color?: string | null;
    driverLoc: { lat: number; lng: number; bearing: number } | null;
    route: { latitude: number; longitude: number }[];
    step: number;
    phase: string;
  } | null;
  
  // Actions
  setUser: (user: UserProfile | null) => void;
  setActiveRide: (ride: RideWithDetails | null) => void;
  setRideMinimized: (minimized: boolean) => void;
  setSavedDemoRide: (saved: AppState["savedDemoRide"]) => void;
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
  rideMinimized: false,
  savedDemoRide: null,

  setUser: (user) => set({ user }),
  setActiveRide: (activeRide) => set({ activeRide }),
  setRideMinimized: (rideMinimized) => set({ rideMinimized }),
  setSavedDemoRide: (savedDemoRide) => set({ savedDemoRide }),
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
      rideMinimized: false,
      savedDemoRide: null,
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

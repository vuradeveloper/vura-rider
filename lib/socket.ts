import { io, Socket } from "socket.io-client";
import { auth } from "./firebase";
import { getApiBaseUrl } from "./config";
import type { ChatMessage } from "./types";

// ── Typed event maps ──

export interface ServerToClientEvents {
  "ride:requested:ack": (data: {
    success: boolean;
    rideId?: string;
    reason?: string;
  }) => void;
  "ride:no:drivers": () => void;
  "ride:expired": () => void;
  "ride:accepted": (data: {
    id?: string;
    driver_name?: string;
    vehicle_color?: string;
    vehicle_make?: string;
    vehicle_model?: string;
    driver_license_plate?: string;
    driver?: {
      name?: string;
      vehicle?: string;
      license_plate?: string;
      rating?: number;
    };
  }) => void;
  "ride:driver:arrived": () => void;
  "ride:started": () => void;
  "ride:driver:location": (data: {
    lat: number;
    lng: number;
    bearing?: number;
    heading?: number;
  }) => void;
  "ride:completed": (data: { riderTotal?: number; fare?: number }) => void;
  "ride:cancelled": (data: { reason?: string }) => void;
  "ride:pickup:updated": (data: {
    address: string;
    lat: number;
    lng: number;
  }) => void;
  "ride:pickup:updated:ack": (data: { success: boolean; error?: string }) => void;
  "chat:message": (msg: ChatMessage) => void;
  "chat:history": (history: ChatMessage[]) => void;
  "split:invite": (data: {
    splitId: string;
    rideId: string;
    inviterName: string;
    inviterEmail: string;
    amount: number;
  }) => void;
  "split:accepted": (data: { splitId: string; inviteeName: string }) => void;
  "split:declined": (data: { splitId: string }) => void;
  "tip:received": (data: { rideId: string; amount: number }) => void;
  "safety:ridecheck:alert": (data: {
    rideId: string;
    reason: string;
  }) => void;
  "safety:sos:dispatched": (data: {
    rideId: string;
    message: string;
  }) => void;
}

export interface ClientToServerEvents {
  "passenger:connect": () => void;
  "passenger:ride:request": (data: {
    pickupAddress: string;
    pickupLat: number;
    pickupLng: number;
    destinationAddress: string;
    destinationLat: number;
    destinationLng: number;
    waypoints: Array<{ address: string; lat: number; lng: number }>;
    tier?: string;
    scheduledAt?: string;
  }) => void;
  "passenger:ride:cancel": (data: { rideId: string; reason: string }) => void;
  "passenger:ride:update_pickup": (data: {
    rideId: string;
    address: string;
    lat: number;
    lng: number;
  }) => void;
  "chat:join": (data: { rideId: string }) => void;
  "chat:leave": (data: { rideId: string }) => void;
  "chat:send": (data: { rideId: string; message: string }) => void;
  "split:invite": (data: {
    rideId: string;
    inviteeEmail: string;
    amount: number;
  }) => void;
  "split:respond": (data: {
    splitId: string;
    accept: boolean;
  }) => void;
  "safety:sos": (data: { rideId: string }) => void;
  "safety:ridecheck:ok": (data: { rideId: string }) => void;
  "share:generate": (data: { rideId: string }) => void;
}

export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// ── Singleton ──

let socket: TypedSocket | null = null;

type ConnectionListener = (connected: boolean) => void;
const connectionListeners = new Set<ConnectionListener>();

function notifyListeners(connected: boolean) {
  connectionListeners.forEach((fn) => fn(connected));
}

export function onConnectionChange(fn: ConnectionListener) {
  connectionListeners.add(fn);
  return () => connectionListeners.delete(fn);
}

export async function getSocket(): Promise<TypedSocket> {
  if (socket?.connected) return socket;

  let token = "";
  if (auth.currentUser) {
    try {
      token = await auth.currentUser.getIdToken();
    } catch {
      throw new Error("Your session expired. Please sign in again.");
    }
  }

  if (socket) {
    socket.auth = { token };
    socket.connect();
    return socket;
  }

  socket = io(getApiBaseUrl(), {
    auth: { token },
    transports: ["websocket"],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  }) as TypedSocket;

  socket.on("connect", () => notifyListeners(true));

  socket.on("disconnect", () => notifyListeners(false));
  socket.on("connect_error", () => notifyListeners(false));

  return socket;
}

export function getConnectedSocket(): TypedSocket | null {
  return socket?.connected ? socket : null;
}

export function disconnectSocket() {
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  notifyListeners(false);
}

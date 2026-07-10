import { io, Socket } from "socket.io-client";
import { auth } from "./firebase";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000";

let socket: Socket | null = null;

export async function getSocket(): Promise<Socket> {
  if (socket && socket.connected) return socket;

  let token = "";
  if (auth.currentUser) {
    try {
      token = await auth.currentUser.getIdToken();
    } catch {
      // continue without token; server will reject
    }
  }

  if (socket) {
    socket.auth = { token };
    socket.connect();
    return socket;
  }

  socket = io(API_BASE, {
    auth: { token },
    transports: ["websocket"],
    autoConnect: true,
    reconnection: true,
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

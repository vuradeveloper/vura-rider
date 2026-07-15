import { io, Socket } from "socket.io-client";
import { auth } from "./firebase";
import { getApiBaseUrl } from "./config";

let socket: Socket | null = null;

export async function getSocket(): Promise<Socket> {
  if (socket && socket.connected) return socket;

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
  });

  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

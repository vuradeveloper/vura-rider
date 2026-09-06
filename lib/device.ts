import AsyncStorage from "@react-native-async-storage/async-storage";

const DEVICE_KEY = "vura.device.id";

// Returns a stable per-install device id (UUID v4) used by the server for
// self-collusion / multi-account fraud detection. It is generated once and
// cached in AsyncStorage so every ride request / accept from this device
// carries the SAME id.
export async function getDeviceId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
  } catch {}
  const id = uuid();
  try {
    await AsyncStorage.setItem(DEVICE_KEY, id);
  } catch {}
  return id;
}

function uuid(): string {
  const s = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return s.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
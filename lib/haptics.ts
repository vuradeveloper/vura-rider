// ─────────────────────────────────────────────────────────────────────────────
// Haptics (phone vibration) helper — expo-haptics (SDK 57+).
//
// Used to buzz the rider's phone when the driver arrives / a ride milestone
// happens, even if the rider is NOT on the track screen. Wrapped in try/catch
// so a haptics failure never breaks a ride flow.
// ─────────────────────────────────────────────────────────────────────────────

import * as Haptics from "expo-haptics";

let lastMs = 0;

/**
 * Fire a short, noticeable vibration. Debounced so rapid socket events
 * (e.g. server car-sim broadcasting) never cause a constant buzz.
 */
export function buzzArrival(): void {
  const now = Date.now();
  if (now - lastMs < 3000) return; // at most once every 3s
  lastMs = now;
  try {
    void Haptics.notificationAsync();
  } catch {
    /* ignore */
  }
}

/** A lighter "tick" for in-ride milestones (accepted, started, completed). */
export function buzzMilestone(): void {
  const now = Date.now();
  if (now - lastMs < 1500) return;
  lastMs = now;
  try {
    void Haptics.selectionAsync();
  } catch {
    /* ignore */
  }
}
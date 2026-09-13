import { execute, queryOne } from "../config/database";

// ── Server-side car simulation: DISABLED ─────────────────────────────────────
// Product decision (Sept 2026): NO SIMULATION. Riders see the driver's REAL
// position only. The driver app streams its actual GPS via `driver:location`
// (socket/handlers.ts persists it and broadcasts `ride:driver:location` to the
// ride room). These no-op stubs keep existing import sites (rides.ts, handlers.ts)
// compiling, but no fake car motion is ever generated server-side.

export function markDriverLivePing(_rideId: string): void {}
export function syncSimToDriver(_rideId: string, _lat: number, _lng: number): void {}
export function stopServerRideSim(_rideId: string): void {}
export function startServerRideSim(_rideId: string, _route: { latitude: number; longitude: number }[]): void {}

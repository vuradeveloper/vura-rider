"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markDriverLivePing = markDriverLivePing;
exports.syncSimToDriver = syncSimToDriver;
exports.stopServerRideSim = stopServerRideSim;
exports.startServerRideSim = startServerRideSim;
// ── Server-side car simulation: DISABLED ─────────────────────────────────────
// Product decision (Sept 2026): NO SIMULATION. Riders see the driver's REAL
// position only. The driver app streams its actual GPS via `driver:location`
// (socket/handlers.ts persists it and broadcasts `ride:driver:location` to the
// ride room). These no-op stubs keep existing import sites (rides.ts, handlers.ts)
// compiling, but no fake car motion is ever generated server-side.
function markDriverLivePing(_rideId) { }
function syncSimToDriver(_rideId, _lat, _lng) { }
function stopServerRideSim(_rideId) { }
function startServerRideSim(_rideId, _route) { }
//# sourceMappingURL=rideSim.js.map
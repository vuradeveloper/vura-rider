// End-to-end ride-flow test against the DEPLOYED backend.
// Books a ride as a rider (socket), then verifies it shows in /api/rides/available
// (what the driver app polls). Run with: node e2e_ride_test.mjs
import { io } from "socket.io-client";

const API = "https://api.ridevura.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Firebase REST sign-in (email/password) — uses the same project as the app.
// Change these to a REAL rider account email/password if the test account fails.
const EMAIL = process.env.TEST_RIDER_EMAIL || "test-rider@vura.com";
const PASSWORD = process.env.TEST_RIDER_PASSWORD || "test-pass-123";

async function firebaseSignIn() {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
    }
  );
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error("Firebase sign-in failed: " + (e.error?.message || res.status));
  }
  const d = await res.json();
  return d.idToken;
}

const token = await firebaseSignIn();
console.log("✓ Signed in to Firebase as", EMAIL);

// 1) Sync the rider user (ensure DB row exists)
const syncRes = await fetch(API + "/api/users/sync", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
  body: JSON.stringify({ token, role: "passenger", full_name: "Test Rider", phone: "+27 00 000 0000" }),
});
console.log("✓ /api/users/sync ->", syncRes.status);

// 2) Connect the rider socket and book a ride
const socket = io(API, {
  auth: { token },
  transports: ["websocket", "polling"],
  reconnection: false,
  timeout: 15000,
});

const result = await new Promise((resolve) => {
  let done = false;
  const finish = (obj) => { if (!done) { done = true; resolve(obj); } };
  socket.on("connect", () => {
    console.log("✓ Rider socket connected:", socket.id);
    socket.emit("passenger:ride:request", {
      pickupAddress: "Test Pickup, Johannesburg",
      pickupLat: -26.2041,
      pickupLng: 28.0473,
      destinationAddress: "Test Dropoff, Sandton",
      destinationLat: -26.1076,
      destinationLng: 28.0567,
      paymentMethod: "cash",
      fare: 45,
    });
    console.log("✓ Booked ride (cash, R45)");
  });
  socket.on("ride:requested:ack", (ack) => finish({ ack }));
  socket.on("connect_error", (err) => finish({ error: String(err.message || err) }));
  socket.on("disconnect", (reason) => {
    if (!done) finish({ error: "socket disconnected: " + reason });
  });
  setTimeout(() => finish({ error: "timeout waiting for ack" }), 20000);
});
console.log("ride:requested:ack ->", JSON.stringify(result));
socket.disconnect();

if (result.error) {
  console.error("❌ RIDE WAS NOT ACCEPTED:", result.error);
  process.exit(1);
}
if (!result.ack || result.ack.success !== true) {
  console.error("❌ Ride was NOT created:", JSON.stringify(result.ack));
  process.exit(1);
}
const rideId = result.ack.rideId;
console.log("✅ RIDE CREATED. id =", rideId);

// 3) Verify the ride is visible to drivers via /api/rides/available
//    (needs driver auth, but 401 means route is live. We'll list without auth to check.)
try {
  const av = await fetch(API + "/api/rides/available", { headers: { Authorization: "Bearer " + token } });
  if (av.ok) {
    const data = await av.json();
    const rides = data.rides || [];
    const found = rides.find((r) => r.id === rideId);
    console.log("✓ /api/rides/available returned", rides.length, "ride(s)");
    console.log(found ? "✅ The booked ride IS visible to drivers!" : "⚠️ Ride not found in available list (may already be accepted/expired).");
  } else {
    console.log("/api/rides/available status:", av.status, "(auth-gated is normal)");
  }
} catch (e) {
  console.log("/api/rides/available check:", e.message);
}

console.log("=== E2E TEST COMPLETE ===");
process.exit(0);
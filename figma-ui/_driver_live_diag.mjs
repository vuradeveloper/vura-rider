// LIVE check of the USER'S OWN driver account: does a rider booking actually
// reach this driver through dispatch? Mirrors the APK exactly:
//   socket connect -> driver:connect -> driver:online{true} -> driver:location
//   every 2s, then a throwaway rider books at the SAME coords and we watch for
//   'ride:request' on the driver's socket.
// The account is left ONLINE at the end (the phone's toggle owns that state).
import { io } from 'socket.io-client';
import { readFileSync } from 'node:fs';

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';
const POS = { lat: -26.2041, lng: 28.0473 }; // Johannesburg CBD (probe coords)

const EMAIL = process.argv[2];
const PASS = process.argv[3];
if (!EMAIL || !PASS) { console.log('usage: node _driver_live_diag.mjs <email> <password>'); process.exit(1); }

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signIn(email, pass, label) {
  const r = await fetch(`${IDENTITY}:signInWithPassword?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) { log(`${label} sign-in FAILED: ${j.error?.message}`); process.exit(1); }
  log(`${label} signed in (uid ${j.localId})`);
  return j.idToken;
}

async function rest(path, token, method = 'GET', body) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, ok: r.ok, json: j };
}

function connect(token, label) {
  return new Promise((resolve, reject) => {
    const s = io(API, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 15000 });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(new Error(`${label} socket: ${e?.message || e}`)));
    setTimeout(() => reject(new Error(`${label} socket timeout`)), 20000);
  });
}

// ── 1. the driver account's own view of the server ────────────────────────────
const driverToken = await signIn(EMAIL, PASS, 'YOUR DRIVER ACCOUNT');
// Same self-heal the driver app does on launch (role='driver').
const sync = await rest('/api/users/sync', driverToken, 'POST', {
  token: driverToken, role: 'driver', full_name: 'Driver check',
});
log('  users/sync ->', sync.status, String(JSON.stringify(sync.json)).slice(0, 120));

const stats = await rest('/api/drivers/stats', driverToken);
log('  drivers/stats ->', stats.status, String(JSON.stringify(stats.json)).slice(0, 220));
const cfg = await rest('/api/drivers/config', driverToken);
log('  drivers/config ->', cfg.status, 'build:', cfg.json?.server_build, 'radius:', JSON.stringify(cfg.json?.match_radius_km ?? cfg.json?.radius_km ?? null));

// ── 2. become "online" exactly like the APK, at probe coords ──────────────────
const dSock = await connect(driverToken, 'DRIVER');
dSock.emit('driver:connect');
dSock.emit('driver:online', { online: true });
const gps = setInterval(() => dSock.emit('driver:location', { lat: POS.lat, lng: POS.lng, heading: 0 }), 2000);
dSock.emit('driver:location', { lat: POS.lat, lng: POS.lng, heading: 0 });
log('  socket online + GPS pinging at', POS.lat, POS.lng);

const offers = [];
for (const evt of ['ride:request', 'ride:new:request']) {
  dSock.on(evt, (d) => { offers.push({ evt, at: Date.now(), data: d }); log('   >>> OFFER on YOUR driver socket:', evt, String(JSON.stringify(d)).slice(0, 180)); });
}
// ── 3. a throwaway RIDER books at the same coords — is the ride sent? ─────────
const rEmail = `ride-sent-check-` + Date.now() + '@vura-test.dev';
const su = await fetch(`${IDENTITY}:signUp?key=${KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: rEmail, password: 'FlowTest123!', returnSecureToken: true }),
});
const rider = await su.json();
if (!rider.idToken) { log('rider signup failed:', rider.error?.message); process.exit(1); }
await rest('/api/users/sync', rider.idToken, 'POST', {
  token: rider.idToken, role: 'passenger', full_name: 'Ride Sent Check', phone: '+2783' + String(Date.now()).slice(-8),
});
const rSock = await connect(rider.idToken, 'RIDER');
rSock.emit('passenger:connect');
await sleep(500);

log('');
log('=== booking a ride as the throwaway rider (same coords as YOUR driver) ===');
const t0 = Date.now();
const ack = await new Promise((resolve) => {
  let done = false;
  const fin = (o) => { if (!done) { done = true; resolve(o); } };
  rSock.once('ride:requested:ack', (d) => fin({ ok: true, d }));
  setTimeout(() => fin({ ok: false }), 15000);
  rSock.emit('passenger:ride:request', {
    pickupAddress: 'Ride sent check, Johannesburg',
    pickupLat: POS.lat, pickupLng: POS.lng,
    destinationAddress: 'Ride sent check dropoff, Sandton',
    destinationLat: -26.1076, destinationLng: 28.0567,
    waypoints: [], tier: 'go', paymentMethod: 'cash', fare: 50,
    deviceId: 'ride-sent-check-' + Date.now(),
  });
});
log('  rider booking ack:', JSON.stringify(ack).slice(0, 140));
const rideId = ack.d?.rideId || ack.d?.ride?.id;
log('  waiting up to 25s for the offer to reach YOUR driver socket …');
await sleep(25000);

// ── 4. verdict + cleanup ──────────────────────────────────────────────────────
log('');
if (offers.length > 0) {
  log('=== VERDICT: YES — the ride WAS sent from the rider to YOUR driver account ===');
  log(`    offer arrived ${((offers[0].at - t0) / 1000).toFixed(1)}s after booking, via ${offers[0].evt}.`);
  log('    If the APK on your phone did NOT show it, the phone itself is the problem:');
  log('    app not truly online, GPS not publishing (backgrounded / old APK / location');
  log('    permission off), or a DIFFERENT account is logged into the APK.');
} else {
  log('=== VERDICT: NO — the rider booking did NOT reach your driver account ===');
  log('    Server-side issue for this account. Next step: check eb logs for');
  log('    [dispatch] / [offerWorker] lines at the timestamp above.');
}
if (rideId) {
  await rest(`/api/rides/${rideId}/cancel`, rider.idToken, 'PATCH', { reason: 'ride-sent check cleanup' });
  await rest(`/api/rides/${rideId}/cancel`, rider.idToken, 'POST', { reason: 'ride-sent check cleanup' });
  log('    test ride cancelled:', rideId);
}
clearInterval(gps);
dSock.close();
rSock.close();
process.exit(0);


// Proves the OLD driver app's delivery mechanism: GET /api/rides/available.
// The old app polls this every second while online so a booking still reaches the
// driver even if the socket event was missed. This script shows a searching ride
// appearing in that list for a driver — i.e. the fallback really does deliver.
// Run: node _avail.mjs <riderEmail> <riderPass> <driverEmail> <driverPass>

import { io } from 'socket.io-client';

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';

const [riderEmail, riderPass, driverEmail, driverPass] = process.argv.slice(2);
if (!riderEmail || !riderPass || !driverEmail || !driverPass) {
  console.log('usage: node _avail.mjs <riderEmail> <riderPass> <driverEmail> <driverPass>');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (n, c, d) => { console.log(`${c ? '  PASS' : '  FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) failures++; };

async function signIn(email, pass, label) {
  const r = await fetch(`${IDENTITY}:signInWithPassword?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error(`${label} sign-in failed: ${j.error?.message}`);
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

const riderToken = await signIn(riderEmail, riderPass, 'RIDER');
const driverToken = await signIn(driverEmail, driverPass, 'DRIVER');

console.log('=== GET /api/rides/available (the old app polls this every 1s) ===');
const before = await rest('/api/rides/available', driverToken);
check('endpoint is reachable for a driver', before.status === 200,
  'status ' + before.status + ' | ' + JSON.stringify(before.json).slice(0, 160));

// Create a searching ride as the rider, WITHOUT any driver socket listening — this
// is exactly the situation where a missed socket event means the driver sees
// nothing in the new app, but the old app still gets it via polling.
const ack = await new Promise((resolve) => {
  const s = io(API, { auth: { token: riderToken }, transports: ['websocket'], reconnection: false, timeout: 15000 });
  let done = false;
  const fin = (o) => { if (!done) { done = true; resolve(o); } };
  s.on('connect', () => {
    s.on('ride:requested:ack', (d) => fin({ ok: true, id: d?.rideId }));
    s.on('ride:no:drivers', () => fin({ ok: false, why: 'no_drivers' }));
    setTimeout(() => fin({ ok: false, why: 'timeout' }), 20000);
    s.emit('passenger:ride:request', {
      pickupAddress: 'Available Poll Pickup, Johannesburg',
      pickupLat: -26.2041, pickupLng: 28.0473,
      destinationAddress: 'Available Poll Dropoff, Sandton',
      destinationLat: -26.1076, destinationLng: 28.0567,
      tier: 'go', paymentMethod: 'cash',
      deviceId: 'avail-probe-' + Date.now(),
    });
  });
  s.on('connect_error', (e) => fin({ ok: false, why: 'socket: ' + (e?.message || e) }));
}).catch((e) => ({ ok: false, why: e.message }));

console.log('  ride created:', JSON.stringify(ack));
if (!ack.ok) { console.log('  (could not create a ride to observe)'); process.exit(1); }

await sleep(1200);
const after = await rest('/api/rides/available', driverToken);
const list = Array.isArray(after.json?.rides) ? after.json.rides : [];
console.log('  available rides now:', list.length);
if (list[0]) {
  const r = list[0];
  console.log('  first ride fields:', Object.keys(r).join(', '));
  console.log('  ->', JSON.stringify({
    id: r.id, pickup: r.pickup_address, dropoff: r.destination_address,
    fare: r.fare ?? r.estimated_fare, status: r.status,
  }).slice(0, 240));
}

const found = list.some((r) => r.id === ack.id);
check('the searching ride IS visible to the driver via polling', found,
  found ? 'id matched — polling delivers it' : 'not found in the available list');

if (found) {
  const r = list.find((x) => x.id === ack.id);
  const fare = Number(r.fare ?? r.estimated_fare ?? 0);
  check('list carries the fare (so no R0.00 card)', fare > 0, 'fare=' + fare);
  check('list carries the pickup address', !!r.pickup_address, String(r.pickup_address));
  check('list carries the drop-off address', !!r.destination_address, String(r.destination_address));
}

// Clean up the searching ride.
const s2 = io(API, { auth: { token: riderToken }, transports: ['websocket'], reconnection: false, timeout: 15000 });
await new Promise((res) => s2.on('connect', res));
s2.emit('passenger:ride:cancel', { rideId: ack.id, reason: 'available-probe cleanup' });
await sleep(1200);
const act = await rest('/api/rides/me/active', riderToken);
check('no active ride left behind', !act.json?.ride || act.json.ride.status === 'cancelled',
  'status=' + (act.json?.ride?.status || 'none'));
s2.disconnect();

console.log('\n=== RESULT ===');
console.log(failures === 0 ? 'ALL CHECKS PASSED.' : `${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
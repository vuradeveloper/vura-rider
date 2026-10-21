// BOOKING → OFFER LATENCY MEASUREMENT against the LIVE server.
//
//   1 throwaway rider + 1 throwaway driver (Johannesburg, ~30 m apart, both
//   sockets on THIS machine — no phone, no backgrounding involved).
//   5 runs with driver destination OFF, then 5 runs with driver destination
//   SET (fitting). Per run we record:
//     emit → ride:requested:ack          (booking round-trip)
//     ack  → ride:offer on the driver    (server dispatch pipeline)
//     emit → ride:offer                  (what the RIDER waits through)
//
// Run: node figma-ui/_latency_probe.mjs
import { io } from 'socket.io-client';

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const ID = 'https://identitytoolkit.googleapis.com/v1/accounts';

const PICKUP = { lat: -26.2041, lng: 28.0473, address: 'Latency Test Pickup, Johannesburg' };
const DEST = { lat: -26.1076, lng: 28.0567, address: 'Latency Test Dropoff, Sandton' };
const DPOS = { lat: -26.2043, lng: 28.0475 };

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signUp(role, name) {
  const email = `latency-${role}-${Date.now()}@vura-test.dev`;
  const r = await fetch(`${ID}:signUp?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'FlowTest123!', returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error(`${role} signup failed: ${j.error?.message}`);
  await fetch(API + '/api/users/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + j.idToken },
    body: JSON.stringify({ token: j.idToken, role, full_name: name, phone: '+2782' + String(Date.now()).slice(-8) }),
  });
  log(`${role} ready: ${email}`);
  return j.idToken;
}

function connect(token, label) {
  return new Promise((resolve, reject) => {
    const s = io(API, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 15000 });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(new Error(`${label}: ${e?.message}`)));
    setTimeout(() => reject(new Error(`${label}: socket timeout`)), 20000);
  });
}

function waitFor(sock, event, ms = 25000) {
  return new Promise((resolve) => {
    const on = (d) => { clearTimeout(to); sock.off(event, on); resolve(d ?? {}); };
    const to = setTimeout(() => { sock.off(event, on); resolve(null); }, ms);
    sock.on(event, on);
  });
}

async function rest(path, token, method = 'GET', body) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: t }; }
}

const riderToken = await signUp('passenger', 'Latency Rider');
const driverToken = await signUp('driver', 'Latency Driver');
const rider = await connect(riderToken, 'rider');
const driver = await connect(driverToken, 'driver');
rider.emit('passenger:connect');
await sleep(400);
log('sockets connected\n');

// Driver stays fresh (server discards drivers silent for 20 s) — exactly what
// the real driver app's 3–5 s GPS loop does while foregrounded.
driver.emit('driver:online', { online: true });
driver.emit('driver:location', { lat: DPOS.lat, lng: DPOS.lng, heading: 0 });
const refresher = setInterval(() => {
  driver.emit('driver:location', { lat: DPOS.lat, lng: DPOS.lng, heading: 0 });
}, 5000);
await sleep(800);

// Persistent offer listener: stamps every arrival for the CURRENT run.
let runStart = 0;
let offerArrival = null;
driver.on('ride:offer', () => { if (runStart && !offerArrival) offerArrival = performance.now(); });

const results = [];
async function oneRun(tag, expectOffer = true) {
  offerArrival = null;
  runStart = performance.now();
  const ackP = waitFor(rider, 'ride:requested:ack', 20000);
  rider.emit('passenger:ride:request', {
    pickupAddress: `${PICKUP.address} ${tag}`, pickupLat: PICKUP.lat, pickupLng: PICKUP.lng,
    destinationAddress: DEST.address, destinationLat: DEST.lat, destinationLng: DEST.lng,
    paymentMethod: 'cash', fare: 45, deviceId: `latency-${tag}`, waypoints: [],
  });
  const ack = await ackP;
  const ackAt = performance.now();
  const rideId = ack?.rideId || null;
  if (!rideId) { log(`  ${tag}: NO ACK ${JSON.stringify(ack)}`); results.push({ tag, emitAck: -1, ackOffer: -1, total: -1 }); return null; }

  // wait up to 12s for the offer
  for (let i = 0; i < 120 && !offerArrival; i++) await sleep(100);

  const emitAck = Math.round(ackAt - runStart);
  const ackOffer = offerArrival ? Math.round(offerArrival - ackAt) : -1;
  const total = offerArrival ? Math.round(offerArrival - runStart) : -1;
  results.push({ tag, emitAck, ackOffer, total });
  log(`  ${tag}: ack ${emitAck} ms | ack→offer ${ackOffer === -1 ? 'NO OFFER in 12s' : ackOffer + ' ms'} | total ${total === -1 ? '—' : total + ' ms'}`);

  await sleep(600);
  await rest(`/api/rides/${rideId}/cancel`, riderToken, 'POST', { reason: 'latency probe' });
  await sleep(1600);
  return rideId;
}

log('=== PHASE 1: driver destination NOT set — 5 runs ===');
for (let i = 1; i <= 5; i++) await oneRun(`noDest-${i}`);

log('');
log('=== PHASE 2: driver destination SET (fitting) — 5 runs ===');
const destAck = waitFor(driver, 'driver:destination:set:ack', 8000);
driver.emit('driver:destination:set', { lat: DEST.lat, lng: DEST.lng, label: 'Latency probe destination' });
const dAck = await destAck;
log('  destination set ack:', JSON.stringify(dAck)?.slice(0, 120));
await sleep(1000);
for (let i = 1; i <= 5; i++) await oneRun(`destSet-${i}`);

// ── summary ──
clearInterval(refresher);
try {
  const clearAck = waitFor(driver, 'driver:destination:clear:ack', 5000);
  driver.emit('driver:destination:clear');
  await clearAck;
} catch {}
driver.emit('driver:online', { online: false });
await sleep(400);
rider.disconnect(); driver.disconnect();

log('');
const ok = results.filter((r) => r.total >= 0);
const avg = (arr, k) => arr.length ? Math.round(arr.reduce((s, r) => s + r[k], 0) / arr.length) : -1;
const max = (arr, k) => arr.length ? Math.max(...arr.map((r) => r[k])) : -1;
const p1 = ok.filter((r) => r.tag.startsWith('noDest'));
const p2 = ok.filter((r) => r.tag.startsWith('destSet'));
log('================ LATENCY SUMMARY ================');
for (const r of results) {
  log(`  ${r.tag.padEnd(10)} ack ${String(r.emitAck).padStart(6)}ms | ack→offer ${r.ackOffer === -1 ? '   NO OFFER' : String(r.ackOffer).padStart(6) + 'ms'} | total ${r.total === -1 ? '—' : r.total + 'ms'}`);
}
log('');
log(`  Phase 1 (no destination)   avg total ${avg(p1, 'total')}ms   max ${max(p1, 'total')}ms   (offers: ${p1.length}/5)`);
log(`  Phase 2 (destination set)  avg total ${avg(p2, 'total')}ms   max ${max(p2, 'total')}ms   (offers: ${p2.length}/5)`);
const slow = results.filter((r) => r.total > 3000 || r.total === -1);
log(slow.length === 0
  ? '  VERDICT: server dispatch is FAST for every run (<=3s) → any phone-side delay is app/backgrounding, not dispatch.'
  : `  VERDICT: ${slow.length} SLOW/MISSING run(s) above 3s → server-side dispatch problem to dig into.`);
process.exit(0);


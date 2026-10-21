// PROOF: a driver silent for >20s (LOCATION_FRESH_SECONDS) is EXCLUDED from
// dispatch — then recovers on the next ping + 2s worker tick. This is exactly
// what a backgrounded driver app on the same phone does.
import { io } from 'socket.io-client';

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const ID = 'https://identitytoolkit.googleapis.com/v1/accounts';
const PICKUP = { lat: -26.2041, lng: 28.0473 };
const DEST = { lat: -26.1076, lng: 28.0567 };
const DPOS = { lat: -26.2043, lng: 28.0475 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function signUp(role) {
  const email = `stale-${role}-${Date.now()}@vura-test.dev`;
  const r = await fetch(`${ID}:signUp?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'FlowTest123!', returnSecureToken: true }) });
  const j = await r.json();
  await fetch(API + '/api/users/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + j.idToken }, body: JSON.stringify({ token: j.idToken, role, full_name: 'Stale ' + role, phone: '+2782' + String(Date.now()).slice(-8) }) });
  return j.idToken;
}
const connect = (token, label) => new Promise((res, rej) => {
  const s = io(API, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 15000 });
  s.on('connect', () => res(s));
  s.on('connect_error', (e) => rej(new Error(label + ': ' + e?.message)));
  setTimeout(() => rej(new Error(label + ': timeout')), 20000);
});
const waitFor = (sock, ev, ms = 25000) => new Promise((resolve) => {
  const on = (d) => { clearTimeout(t); sock.off(ev, on); resolve(d ?? {}); };
  const t = setTimeout(() => { sock.off(ev, on); resolve(null); }, ms);
  sock.on(ev, on);
});
async function rest(path, token, method = 'GET', body) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try { return { json: JSON.parse(await r.text()) }; } catch { return { json: {} }; }
}

const riderToken = await signUp('passenger');
const driverToken = await signUp('driver');
const rider = await connect(riderToken, 'rider');
const driver = await connect(driverToken, 'driver');
rider.emit('passenger:connect');
driver.emit('driver:online', { online: true });
driver.emit('driver:location', { lat: DPOS.lat, lng: DPOS.lng, heading: 0 });
await sleep(1500);
log('driver online with 1 fresh ping');

let pinging = false;
let offerAt = null;
let resumeAt = 0;
driver.on('ride:offer', () => { if (!offerAt) offerAt = performance.now(); });
const loop = setInterval(() => { if (pinging) driver.emit('driver:location', { lat: DPOS.lat, lng: DPOS.lng, heading: 0 }); }, 2000);

log('driver STOPS pinging (simulates app backgrounded) — waiting 26s …');
pinging = false;
await sleep(26000);

log('rider books while driver is stale …');
const t0 = performance.now();
const ackP = waitFor(rider, 'ride:requested:ack', 20000);
rider.emit('passenger:ride:request', {
  pickupAddress: 'Stale proof pickup', pickupLat: PICKUP.lat, pickupLng: PICKUP.lng,
  destinationAddress: 'Stale proof dropoff', destinationLat: DEST.lat, destinationLng: DEST.lng,
  paymentMethod: 'cash', fare: 45, deviceId: 'stale-proof', waypoints: [],
});
const ack = await ackP;
log(`  ack after ${Math.round(performance.now() - t0)} ms, rideId=${ack?.rideId}`);

for (let i = 0; i < 10 && !offerAt; i++) await sleep(1000);
log(offerAt
  ? `  offer arrived DURING staleness after ${Math.round(offerAt - t0)} ms (unexpected)`
  : '  NO offer in the first 10s while driver is stale → driver was excluded (freshness window)');

log('driver app comes BACK (pings resume) …');
resumeAt = performance.now();
pinging = true;
for (let i = 0; i < 15 && !offerAt; i++) await sleep(500);
log(offerAt
  ? `  offer arrived ${Math.round(offerAt - resumeAt)} ms after the app resumed (next ping + 2s worker tick)`
  : '  still no offer after 7.5s — investigate further');

clearInterval(loop);
driver.emit('driver:online', { online: false });
if (ack?.rideId) await rest(`/api/rides/${ack.rideId}/cancel`, riderToken, 'POST', { reason: 'stale proof' });
rider.disconnect(); driver.disconnect();
process.exit(0);

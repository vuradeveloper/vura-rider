// Does the rider's LIVE ride payload carry the approved photo of the actual car?
//
//   node _veh_live.mjs                          <- mints a throwaway rider + driver
//   node _veh_live.mjs <driverEmail> <driverPass> [riderEmail] [riderPass]
//
// The rider card can only show a photo the SERVER attaches to the ride: the car is
// stamped onto the ride at accept and the photo is matched from vehicle_images on
// make+model+year+colour. This probe exercises exactly that, and it saves the car
// with the deliberate spelling drift that used to make the photo vanish:
//
//   saved:  vehicle_make "VW"  model "Polo"  year 2019  colour "red"
//   photo:  vehicle_images.cache_key = volkswagen-polo-2017-2020-red
//
// PASS needs all three: the ride payload has vehicle_image_url, it is an absolute
// https URL (a relative /api/... URL can never load in the WebView), and HEAD on it
// answers 200 image/webp.
//
// Safe to re-run: new throwaway accounts each time, the probe ride is cancelled and
// the driver is put back offline before it exits.
import { io } from 'socket.io-client';

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';
const PASSWORD = 'FlowTest123!';

const [argDriverEmail, argDriverPass, argRiderEmail, argRiderPass] = process.argv.slice(2);

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
  if (!ok) failures += 1;
};

const PICKUP = { lat: -26.1076, lng: 28.0567, address: 'Veh probe pickup, Sandton' };
const DEST = { lat: -26.1450, lng: 28.0400, address: 'Veh probe dropoff, Rosebank' };
const DRIVER_POS = { lat: -26.1080, lng: 28.0570 }; // ~50 m from pickup

async function signIn(email, pass, label) {
  const r = await fetch(`${IDENTITY}:signInWithPassword?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error(`${label} sign-in failed: ${j.error?.message}`);
  log(`${label} signed in`);
  return j.idToken;
}

/** Mirrors _mkaccounts.mjs: Firebase sign-up, then create the row via /api/users/sync. */
async function mint(role, label, name, phone) {
  const email = `${label}-${Date.now()}@vura-test.dev`;
  const su = await fetch(`${IDENTITY}:signUp?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const j = await su.json();
  if (!j.idToken) throw new Error(`${label} sign-up failed: ${j.error?.message}`);
  const sync = await fetch(API + '/api/users/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + j.idToken },
    body: JSON.stringify({ token: j.idToken, role, full_name: name, phone }),
  });
  const sj = await sync.json().catch(() => ({}));
  if (sync.status >= 300) throw new Error(`${label} sync failed: ${sync.status} ${JSON.stringify(sj).slice(0, 200)}`);
  log(`${label} minted: ${email} (role ${sj?.user?.role})`);
  return { email, token: j.idToken };
}

function connect(token, label) {
  return new Promise((resolve, reject) => {
    const s = io(API, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 15000 });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(new Error(`${label} socket: ${e?.message || e}`)));
    setTimeout(() => reject(new Error(`${label} socket timeout`)), 20000);
  });
}

async function rest(path, token, method = 'GET', body) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const t = await r.text();
  let j = null;
  try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, ok: r.ok, json: j };
}

function waitFor(sock, event, ms = 25000) {
  return new Promise((resolve) => {
    const on = (data) => { clearTimeout(to); sock.off(event, on); resolve(data ?? {}); };
    const to = setTimeout(() => { sock.off(event, on); resolve(null); }, ms);
    sock.on(event, on);
  });
}

// ── accounts ────────────────────────────────────────────────────────────────
let driverEmail = argDriverEmail;
let driverPass = argDriverPass;
let riderEmail = argRiderEmail;
let riderPass = argRiderPass;
let mintedDriver = null;
let mintedRider = null;

if (!driverEmail || !driverPass) {
  mintedDriver = await mint('driver', 'veh-probe-driver', 'Veh Probe Driver', '+27820000041')
    .catch((e) => { log(String(e)); process.exit(2); });
  driverEmail = mintedDriver.email; driverPass = PASSWORD;
}
if (!riderEmail || !riderPass) {
  mintedRider = await mint('passenger', 'veh-probe-rider', 'Veh Probe Rider', '+27820000042')
    .catch((e) => { log(String(e)); process.exit(2); });
  riderEmail = mintedRider.email; riderPass = PASSWORD;
}

const driverToken = mintedDriver?.token || await signIn(driverEmail, driverPass, 'DRIVER');
const riderToken = mintedRider?.token || await signIn(riderEmail, riderPass, 'RIDER');

// ── 1. give the driver the car (the "VW" spelling drift on purpose) ─────────
log('=== 1. save the car: make "VW", model "Polo", 2019, colour "red" ===');
const save = await rest('/api/drivers/profile', driverToken, 'PATCH', {
  vehicle_make: 'VW', vehicle_model: 'Polo', vehicle_year: 2019, vehicle_color: 'red',
  vehicle_type: 'Hatchback', license_plate: 'VURA PROBE',
});
check('PATCH /api/drivers/profile accepted', save.ok, `${save.status} ${JSON.stringify(save.json).slice(0, 160)}`);
const prof = await rest('/api/drivers/profile', driverToken);
const p = prof.json?.profile ?? prof.json?.driver_profile ?? {};
log(`  stored: make=${JSON.stringify(p.vehicle_make)} model=${JSON.stringify(p.vehicle_model)} ` +
    `year=${JSON.stringify(p.vehicle_year)} colour=${JSON.stringify(p.vehicle_color ?? p.vehicle_colour)} ` +
    `body=${JSON.stringify(p.body_type ?? p.vehicle_body_type)}`);

// ── 2. online with GPS, book, get the offer, accept ────────────────────────
const rider = await connect(riderToken, 'rider');
const driver = await connect(driverToken, 'driver');
rider.emit('passenger:connect');
await sleep(400);

log('=== 2. driver online + GPS ===');
driver.emit('driver:online', { online: true });
await sleep(500);
driver.emit('driver:location', { lat: DRIVER_POS.lat, lng: DRIVER_POS.lng, heading: 0 });
await sleep(600);
const refresher = setInterval(() => {
  driver.emit('driver:location', { lat: DRIVER_POS.lat, lng: DRIVER_POS.lng, heading: 0 });
}, 10000);

log('=== 3. rider books ===');
const offerWatch = waitFor(driver, 'ride:offer', 20000);
const ack = await (async () => {
  const a = waitFor(rider, 'ride:requested:ack', 20000);
  rider.emit('passenger:ride:request', {
    pickupAddress: PICKUP.address, pickupLat: PICKUP.lat, pickupLng: PICKUP.lng,
    destinationAddress: DEST.address, destinationLat: DEST.lat, destinationLng: DEST.lng,
    waypoints: [], tier: 'go', paymentMethod: 'cash', fare: 42.5,
    deviceId: 'veh-probe-' + Date.now(),
  });
  return await a;
})();
const rideId = ack?.rideId;
check('booking ack carries the rideId', ack?.success === true && !!rideId, `rideId=${rideId}`);

const offer = rideId ? await offerWatch : null;
check('driver received ride:offer', !!offer?.offerId, `offerId=${offer?.offerId} round=${offer?.round}`);
if (offer) log(`  offer keys: ${Object.keys(offer).join(', ')}`);

log('=== 4. driver accepts (REST) ===');
const acc = rideId ? await rest(`/api/rides/${rideId}/accept`, driverToken, 'POST') : { json: null, status: 0 };
check('accept ok', acc.json?.ok === true, `${acc.status} ${JSON.stringify(acc.json).slice(0, 160)}`);
await sleep(1800);

// ── 5. what does the RIDER actually receive? ───────────────────────────────
log('=== 5. rider live-ride payload ===');
if (rideId) {
  const active = await rest('/api/rides/me/active', riderToken);
  const ride = active.json?.ride ?? null;
  if (!ride) {
    check('rider /api/rides/me/active returns the ride', false, `${active.status} ${JSON.stringify(active.json).slice(0, 200)}`);
  } else {
    check('rider /api/rides/me/active returns the ride', true, `status=${ride.status} id=${ride.id}`);
    log(`  ride keys: ${Object.keys(ride).join(', ')}`);
    for (const k of Object.keys(ride)) {
      if (/make|model|year|colou?r|body|plate|vehicle|image|photo/i.test(k)) log(`  ${k} = ${JSON.stringify(ride[k])}`);
    }
    const url = ride.vehicle_image_url ?? ride.image_url ?? null;
    check('payload carries a car photo URL', !!url, `vehicle_image_url=${JSON.stringify(ride.vehicle_image_url)}`);
    if (url) {
      check('the URL is absolute (a WebView can load it)', /^https?:\/\//i.test(String(url)), String(url));
      const head = await fetch(String(url), { method: 'HEAD' }).catch(() => ({ status: 0, headers: { get: () => null } }));
      const ctype = head.headers?.get?.('content-type') || '';
      check('photo URL downloads as an image', head.status === 200 && /image\//.test(ctype), `HTTP ${head.status} ${ctype}`);
    }
    const one = await rest(`/api/rides/${rideId}`, riderToken);
    const rideOne = one.json?.ride ?? one.json;
    log(`  /api/rides/:id also carries it: ${JSON.stringify(rideOne?.vehicle_image_url ?? rideOne?.image_url ?? null)}`);
  }
}

// ── 6. cleanup ─────────────────────────────────────────────────────────────
log('=== cleanup ===');
if (rideId) {
  rider.emit('passenger:ride:cancel', { rideId, reason: 'vehicle-photo probe' });
  await sleep(1500);
  const after = await rest('/api/rides/me/active', riderToken);
  log(`  after cancel: ride=${JSON.stringify(after.json?.ride?.status ?? null)}`);
}
clearInterval(refresher);
driver.emit('driver:online', { online: false });
await sleep(600);
rider.disconnect(); driver.disconnect();
log(`\n${failures === 0 ? 'ALL CHECKS PASSED - the rider payload carries the real car photo'
  : failures + ' CHECK(S) FAILED - the photo is not reaching the rider payload'}`);
process.exit(failures === 0 ? 0 : 1);


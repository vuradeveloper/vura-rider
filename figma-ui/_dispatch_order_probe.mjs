// LIVE proof of the driver-offer loop against PROD (api.ridevura.com), in the
// user's EXACT order: rider books FIRST (nobody online) -> driver comes online AFTER.
//
//   Phase A — TWO accounts: the waiting ride must be revived + offered within
//             seconds of the driver going online.
//   Phase B — ONE account (the booker "goes online" as driver): the server
//             excludes the ride's own passenger from candidates by design
//             (dispatch.ts: u.id <> passenger_id) -> the offer NEVER arrives.
//
// Throwaway probe accounts only; rides are cancelled at the end.
import { io } from 'socket.io-client';

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';
const POS = { lat: -26.2041, lng: 28.0473 }; // Johannesburg CBD — same as other probes

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function signUp(label) {
  const email = `dispatch-diag-${label}-` + Date.now() + '@vura-test.dev';
  const r = await fetch(`${IDENTITY}:signUp?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'FlowTest123!', returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error(`${label} signup failed: ${j.error?.message}`);
  return { token: j.idToken, email };
}

async function sync(token, role, name) {
  const r = await fetch(API + '/api/users/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ token, role, full_name: name, phone: '+2782' + String(Date.now()).slice(-8) }),
  });
  if (!r.ok) throw new Error(`sync(${role}) ${r.status}: ${await r.text()}`);
}

function connect(token, label) {
  return new Promise((resolve, reject) => {
    const s = io(API, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 15000 });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(new Error(`${label} socket: ${e?.message || e}`)));
    setTimeout(() => reject(new Error(`${label} socket timeout`)), 20000);
  });
}

async function bookRide(riderSock, tag) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (o) => { if (!done) { done = true; resolve(o); } };
    riderSock.once('ride:requested:ack', (d) => fin({ kind: 'ack', d }));
    setTimeout(() => fin({ kind: 'timeout' }), 15000);
    riderSock.emit('passenger:ride:request', {
      pickupAddress: `Dispatch diag ${tag}, Johannesburg`,
      pickupLat: POS.lat, pickupLng: POS.lng,
      destinationAddress: 'Dispatch diag dropoff, Sandton',
      destinationLat: -26.1076, destinationLng: 28.0567,
      waypoints: [], tier: 'go', paymentMethod: 'cash', fare: 50,
      deviceId: `dispatch-diag-${tag}-` + Date.now(),
    });
  });
}

async function cancelRide(token, rideId) {
  for (const method of ['PATCH', 'POST']) {
    await fetch(`${API}/api/rides/${rideId}/cancel`, {
      method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ reason: 'dispatch diag cleanup' }),
    }).catch(() => {});
  }
}

// pings driver:location every 2s — the freshness the candidate query requires
function startGps(sock) {
  const iv = setInterval(() => {
    sock.emit('driver:location', { lat: POS.lat, lng: POS.lng, heading: 0 });
  }, 2000);
  sock.emit('driver:location', { lat: POS.lat, lng: POS.lng, heading: 0 });
  return () => clearInterval(iv);
}

// ── Phase A: TWO accounts, book FIRST then the driver comes online ────────────
log('=== PHASE A — two accounts, rider books BEFORE the driver is online ===');
const riderA = await signUp('riderA'); await sync(riderA.token, 'passenger', 'Diag Rider A');
const driverB = await signUp('driverB'); await sync(driverB.token, 'driver', 'Diag Driver B');
log('riderA:', riderA.email, '\ndriverB:', driverB.email);

const riderSockA = await connect(riderA.token, 'RIDER-A');
riderSockA.emit('passenger:connect');
await sleep(500);

const ackA = await bookRide(riderSockA, 'phaseA');
log('  booking ack:', JSON.stringify(ackA).slice(0, 160));
const rideA = ackA.d?.rideId;
if (!rideA) { log('  FATAL: no ride created'); process.exit(1); }
log('  ride', rideA, 'searching with NO driver online yet …');
await sleep(3000); // let dispatch run its first round with nobody there

// NOW the driver comes online — exactly like the app: connect, online, GPS loop.
const driverSockB = await connect(driverB.token, 'DRIVER-B');
driverSockB.emit('driver:connect');
driverSockB.emit('driver:online', { online: true });
const stopGpsB = startGps(driverSockB);
log('  driver B ONLINE + pinging GPS — waiting up to 30s for the revived offer …');

const offerB = await new Promise((resolve) => {
  const t0 = Date.now();
  let done = false;
  const fin = (o) => { if (!done) { done = true; resolve(o); } };
  for (const evt of ['ride:request', 'ride:new:request']) {
    driverSockB.on(evt, (d) => fin({ got: true, evt, ms: Date.now() - t0, data: d }));
  }
  setTimeout(() => fin({ got: false }), 30000);
});
log(offerB.got
  ? `  OK  OFFER ARRIVED after ${offerB.ms} ms via ${offerB.evt}`
  : '  XX  NO OFFER within 30s — server-side regression');
if (offerB.got) log('  offer payload:', String(JSON.stringify(offerB.data)).slice(0, 200));

stopGpsB();
driverSockB.emit('driver:online', { online: false });
driverSockB.close();
await cancelRide(riderA.token, rideA);
await sleep(2000);

// ── Phase B: ONE account — the booker "goes online" as driver ─────────────────
log('');
log('=== PHASE B — SAME account books, then goes online as the driver ===');
const solo = await signUp('solo'); await sync(solo.token, 'passenger', 'Diag Solo');
const soloSock = await connect(solo.token, 'SOLO');
soloSock.emit('passenger:connect');
await sleep(500);

const ackB = await bookRide(soloSock, 'phaseB');
log('  booking ack:', JSON.stringify(ackB).slice(0, 160));
const rideB = ackB.d?.rideId;
await sleep(2000);

// The same socket now tries to be the driver — same phone, same account.
soloSock.emit('driver:connect');
soloSock.emit('driver:online', { online: true });
const stopGpsSolo = startGps(soloSock);
log('  same account ONLINE as driver + pinging GPS — waiting 25s for its own ride …');

const offerSolo = await new Promise((resolve) => {
  let done = false;
  const fin = (o) => { if (!done) { done = true; resolve(o); } };
  for (const evt of ['ride:request', 'ride:new:request']) {
    soloSock.on(evt, (d) => fin({ got: true, evt, data: d }));
  }
  setTimeout(() => fin({ got: false }), 25000);
});
log(offerSolo.got
  ? '  UNEXPECTED: offer arrived even for the same account'
  : '  OK  NO OFFER for the same account — the server excludes the ride\'s own passenger by design');
stopGpsSolo();
soloSock.emit('driver:online', { online: false });
await cancelRide(solo.token, rideB);
soloSock.close();

log('');
log('=== VERDICT ===');
log('Phase A = dispatch loop with your exact ordering (book first, driver online after).');
log('Phase B = the rider account trying to drive its own ride (same-account test).');
process.exit(0);


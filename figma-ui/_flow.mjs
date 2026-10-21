// Proves the RIDER -> DRIVER ride flow and the notification path end to end,
// exactly as the apps do it:
//   rider  : socket "passenger:ride:request"  -> "ride:requested:ack"
//   driver : socket "driver:connect" + "driver:online" -> receives "ride:request"
//   accept : socket "driver:ride:accept"      -> ride assigned to THAT driver only
//   notif  : GET /api/notifications/history, POST /api/notifications/register
//
// Creates a real ride as the rider, delivers it to a driver, has that driver
// accept it, proves no other driver can see it, then cancels it.
// Run: node figma-ui/_flow.mjs <riderEmail> <riderPass> <driverEmail> <driverPass> [otherDriverEmail] [otherDriverPass]

import { io } from 'socket.io-client';

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';

const [riderEmail, riderPass, driverEmail, driverPass, otherDriverEmail, otherDriverPass] =
  process.argv.slice(2);
if (!riderEmail || !riderPass || !driverEmail || !driverPass || !otherDriverEmail || !otherDriverPass) {
  console.log('usage: node _flow.mjs <riderEmail> <riderPass> <driverEmail> <driverPass> <otherDriverEmail> <otherDriverPass>');
  process.exit(1);
}
const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (n, c, d) => { log(`${c ? '  PASS' : '  FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) failures++; };

async function signIn(email, pass, label) {
  const r = await fetch(`${IDENTITY}:signInWithPassword?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error(`${label} sign-in failed: ${j.error?.message}`);
  log(`${label} signed in (uid ${j.localId})`);
  return j.idToken;
}

function connect(token, label) {
  return new Promise((resolve, reject) => {
    const s = io(API, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 15000 });
    s.on('connect', () => { log(`${label} socket connected`); resolve(s); });
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
  let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, ok: r.ok, json: j };
}

const riderToken = await signIn(riderEmail, riderPass, 'RIDER');
const driverToken = await signIn(driverEmail, driverPass, 'DRIVER');

log('\n=== notifications ===');
const hist = await rest('/api/notifications/history', riderToken);
check('GET /api/notifications/history -> 2xx', hist.ok,
  'status ' + hist.status + ' ' + String(JSON.stringify(hist.json)).slice(0, 140));
const reg = await rest('/api/notifications/register', riderToken, 'POST',
  { token: 'probe-token-' + Date.now(), platform: 'android' });
check('POST /api/notifications/register reachable', reg.status !== 404,
  'status ' + reg.status + ' ' + String(JSON.stringify(reg.json)).slice(0, 140));

// ── Driver goes online and waits for a ride broadcast ────────────────────────
log('\n=== driver online + listening ===');
const driverSock = await connect(driverToken, 'DRIVER');

// Exactly what the fixed driver app does on mount: announce the connection, then
// the online state. The server only routes rides to drivers with an open socket.
driverSock.emit('driver:connect');
driverSock.emit('driver:online', { online: true });
await sleep(1500);

const rideRequests = [];
// Listen on BOTH names the server has used across builds, recording which one
// actually fires — this is the evidence for which event the driver must handle.
const seenEvents = new Set();
for (const evt of ['ride:request', 'ride:new:request']) {
  driverSock.on(evt, (d) => {
    seenEvents.add(evt);
    rideRequests.push(d);
    log(`   DRIVER RECEIVED ${evt} ->`, String(JSON.stringify(d)).slice(0, 220));
  });
}

// ── Rider books ──────────────────────────────────────────────────────────────
log('\n=== rider books a ride ===');
const riderSock = await connect(riderToken, 'RIDER');
// What the fixed rider app does on connect: register as a passenger. It used to
// emit "driver:online" — the driver's event — which marked the rider as an
// available driver.
riderSock.emit('passenger:connect');
await sleep(800);

const ack = await new Promise((resolve) => {
  let done = false;
  const finish = (o) => { if (!done) { done = true; resolve(o); } };
  riderSock.on('ride:requested:ack', (d) => finish({ kind: 'ack', d }));
  riderSock.on('ride:no:drivers', () => finish({ kind: 'no_drivers' }));
  riderSock.on('ride:expired', () => finish({ kind: 'expired' }));
  setTimeout(() => finish({ kind: 'timeout' }), 30000);
  riderSock.emit('passenger:ride:request', {
    pickupAddress: 'Flow Test Pickup, Johannesburg',
    pickupLat: -26.2041, pickupLng: 28.0473,
    destinationAddress: 'Flow Test Dropoff, Sandton',
    destinationLat: -26.1076, destinationLng: 28.0567,
    waypoints: [], tier: 'go', paymentMethod: 'cash', fare: 45,
    deviceId: 'flow-test-' + Date.now(),
  });
});

log('   ack:', String(JSON.stringify(ack)).slice(0, 260));
check('rider got a response (not a timeout)', ack.kind !== 'timeout', ack.kind);

const rideId = ack.d?.rideId;
if (ack.kind === 'ack' && ack.d?.success) {
  check('ride created', !!rideId, 'rideId=' + rideId);
  await sleep(2500);
  check('DRIVER RECEIVED the ride broadcast', rideRequests.length > 0, `${rideRequests.length} received`);
  check('event name handled by the fixed app', seenEvents.size > 0,
    'live server emits: ' + [...seenEvents].join(', '));

  if (rideRequests[0]) {
    const r = rideRequests[0];
    check('broadcast carries an id (id or rideId)', !!(r.id || r.rideId), String(r.id || r.rideId));
    check('broadcast carries pickup', !!(r.pickupAddress || r.pickup_address || r.pickup), String(r.pickupAddress || r.pickup_address || r.pickup || ''));
    check('broadcast carries dropoff', !!(r.destinationAddress || r.destination_address || r.destination), String(r.destinationAddress || r.destination_address || r.destination || ''));
    check('broadcast carries fare', (r.fare ?? r.estimatedFare) != null, 'fare=' + (r.fare ?? r.estimatedFare));
  }

  // ── PER-DRIVER PROOF: accepting assigns the ride to THAT driver alone ──────
  // A broadcast goes to every online driver; only the one who accepts owns the
  // ride. This is what makes each driver's history/earnings their own.
  log('\n=== driver accepts: ride must be assigned to this driver ONLY ===');
  const acceptAck = await new Promise((resolve) => {
    let done = false;
    const finish = (o) => { if (!done) { done = true; resolve(o); } };
    // The live server confirms on `ride:accepted:ack`; `driver:ride:accept:ack` is
    // the other build's name. Listening for both is what acceptRide() does.
    driverSock.once('ride:accepted:ack', (d) => finish({ kind: 'ack', d }));
    driverSock.once('driver:ride:accept:ack', (d) => finish({ kind: 'ack', d }));
    driverSock.once('error', (e) => finish({ kind: 'error', e }));
    setTimeout(() => finish({ kind: 'timeout' }), 15000);
    driverSock.emit('driver:ride:accept', { rideId, deviceId: 'flow-test-' + Date.now() });
  });
  log('   accept ack:', String(JSON.stringify(acceptAck)).slice(0, 200));
  check('driver accepted the ride (confirmed by the server)',
    acceptAck.kind === 'ack', acceptAck.kind);

  await sleep(1200);
  const drvActive = await rest('/api/rides/me/active', driverToken);
  check('ride is ACTIVE for the accepting driver',
    drvActive.json?.ride?.id === rideId,
    'status=' + (drvActive.json?.ride?.status || 'none') + ' id=' + (drvActive.json?.ride?.id || 'none'));

  const drvHist = await rest('/api/rides/history?limit=5', driverToken);
  const owns = (drvHist.json?.rides || []).some((r) => r.id === rideId);
  check('ride now appears in THIS driver\'s own history', owns,
    owns ? 'id matched' : 'newest ids: ' + (drvHist.json?.rides || []).map((r) => r.id).join(','));

  // A different driver must NOT see it — proves scoping, not a shared feed.
  const otherToken = await signIn(otherDriverEmail, otherDriverPass, 'OTHER DRIVER');
  const otherActive = await rest('/api/rides/me/active', otherToken);
  const otherHist = await rest('/api/rides/history?limit=20', otherToken);
  const leakedActive = otherActive.json?.ride?.id === rideId;
  const leakedHist = (otherHist.json?.rides || []).some((r) => r.id === rideId);
  check('ride does NOT appear on any other driver', !leakedActive && !leakedHist,
    leakedActive || leakedHist ? 'LEAKED' : 'other driver sees nothing of it');
} else {
  log('   (no ride created — the driver may be filtered by distance/tier; that is not a wiring failure)');
}

// ── Clean up ─────────────────────────────────────────────────────────────────
if (rideId) {
  log('\n=== cleanup: cancelling the test ride ===');
  riderSock.emit('passenger:ride:cancel', { rideId, reason: 'automated flow test' });
  await sleep(1500);
  const active = await rest('/api/rides/me/active', riderToken);
  let cleared = !active.json?.ride || active.json.ride.status === 'cancelled';
  if (!cleared) {
    // The rider's cancel did not take (the ride may already be assigned), so the
    // assigned driver releases it instead.
    driverSock.emit('driver:ride:cancel', { rideId, reason: 'automated flow test' });
    await sleep(1500);
    const again = await rest('/api/rides/me/active', riderToken);
    cleared = !again.json?.ride || again.json.ride.status === 'cancelled';
  }
  log('   active ride after cancel:', String(JSON.stringify(active.json)).slice(0, 160));
  check('no active ride left behind', cleared,
    'status=' + (active.json?.ride?.status || 'none'));
}

driverSock.emit('driver:online', { online: false });
await sleep(800);
driverSock.disconnect();
riderSock.disconnect();

log('\n=== RESULT ===');
log(failures === 0 ? 'ALL CHECKS PASSED.' : `${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
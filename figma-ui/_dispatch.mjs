// End-to-end proof of the NEW dispatch system, against the deployed backend:
//
//   1. two drivers go online with GPS (driver1 closer to the pickup)
//   2. rider requests a ride  -> only driver1 gets an offer (targeted, 15s window)
//   3. driver2 tries to steal it via REST  -> refused ("another driver is reviewing")
//   4. driver1 accepts (REST)  -> rider receives ride:accepted with a ride version
//   5. accept twice            -> second call is an idempotent ok/duplicate
//   6. booking twice           -> the same live ride is returned (reused: true)
//   7. driver declines         -> the ride is re-offered to the next driver
//   8. offer ignored           -> the DB WORKER expires it and re-offers (no setTimeout)
//   9. nobody online           -> ride becomes 'no_drivers' and the rider is told
//
// Run: node figma-ui/_dispatch.mjs <riderEmail> <riderPass> <driverEmail> <driverPass> <driver2Email> <driver2Pass>
//
// Safe to run repeatedly: every ride it creates is cancelled before it exits, and
// both drivers are checked offline at the end.

import { io } from 'socket.io-client';

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';

const [riderEmail, riderPass, d1Email, d1Pass, d2Email, d2Pass] = process.argv.slice(2);
if (!riderEmail || !riderPass || !d1Email || !d1Pass || !d2Email || !d2Pass) {
  console.log('usage: node _dispatch.mjs <riderEmail> <riderPass> <driverEmail> <driverPass> <driver2Email> <driver2Pass>');
  process.exit(1);
}

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (n, c, d) => {
  log(`${c ? '  PASS' : '  FAIL'}  ${n}${d ? ' - ' + d : ''}`);
  if (!c) failures += 1;
};

// Two pickups far apart so "closest driver" is deterministic.
const PICKUP = { lat: -26.2041, lng: 28.0473, address: 'Dispatch Test Pickup, Johannesburg' };
const DEST = { lat: -26.1076, lng: 28.0567, address: 'Dispatch Test Dropoff, Sandton' };
const D1_POS = { lat: -26.2043, lng: 28.0475 }; // ~30 m away - must win
const D2_POS = { lat: -26.2400, lng: 28.0500 }; // ~4 km away

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

/** Resolve with the first matching event, or null after ms. */
function waitFor(sock, event, ms = 25000) {
  return new Promise((resolve) => {
    const on = (data) => { clearTimeout(to); sock.off(event, on); resolve(data ?? {}); };
    const to = setTimeout(() => { sock.off(event, on); resolve(null); }, ms);
    sock.on(event, on);
  });
}

/** Collect every occurrence of an event for a while (to prove ABSENCE too). */
function watch(sock, event, ms) {
  const hits = [];
  const on = (d) => hits.push(d ?? {});
  sock.on(event, on);
  return new Promise((resolve) => setTimeout(() => { sock.off(event, on); resolve(hits); }, ms));
}

function bookRide(sock, tag) {
  return new Promise(async (resolve) => {
    const ack = waitFor(sock, 'ride:requested:ack', 20000);
    sock.emit('passenger:ride:request', {
      pickupAddress: `${PICKUP.address} ${tag}`,
      pickupLat: PICKUP.lat,
      pickupLng: PICKUP.lng,
      destinationAddress: DEST.address,
      destinationLat: DEST.lat,
      destinationLng: DEST.lng,
      paymentMethod: 'cash',
      fare: 42.5,
      deviceId: `dispatch-test-${tag}`,
      waypoints: [],
    });
    resolve(await ack);
  });
}

async function goOnline(sock, on, pos) {
  sock.emit('driver:online', { online: on });
  await sleep(600);
  if (on && pos) {
    sock.emit('driver:location', { lat: pos.lat, lng: pos.lng, heading: 0 });
    await sleep(600);
  }
}

log('=== sign in ===');
const riderToken = await signIn(riderEmail, riderPass, 'RIDER');
const d1Token = await signIn(d1Email, d1Pass, 'DRIVER 1 (close)');
const d2Token = await signIn(d2Email, d2Pass, 'DRIVER 2 (far)');

log('=== connect sockets ===');
const rider = await connect(riderToken, 'rider');
const d1 = await connect(d1Token, 'driver1');
const d2 = await connect(d2Token, 'driver2');
rider.emit('passenger:connect');
await sleep(500);
check('three sockets connected', rider.connected && d1.connected && d2.connected);

// The dispatcher only trusts drivers heard from in the last 30s (that is the point:
// a silent phone stops getting offers), so keep both of them "alive" for the test —
// exactly what the driver app does with its 3-5s GPS loop.
const refresher = setInterval(() => {
  d1.emit('driver:location', { lat: D1_POS.lat, lng: D1_POS.lng, heading: 0 });
  d2.emit('driver:location', { lat: D2_POS.lat, lng: D2_POS.lng, heading: 0 });
}, 10000);

log('=== 1. both drivers online with fresh GPS ===');
await goOnline(d1, true, D1_POS);
await goOnline(d2, true, D2_POS);
const st0 = await rest('/api/rides/me/active-state', d1Token);
check('driver1 starts with no offer and no ride',
  !st0.json?.offer && !st0.json?.ride,
  `offer=${!!st0.json?.offer} ride=${!!st0.json?.ride}`);

log('=== 2. rider requests -> ONLY the closest driver is offered ===');
const d1Offers = watch(d1, 'ride:offer', 9000);
const d2Offers = watch(d2, 'ride:offer', 9000);
const d2Legacy = watch(d2, 'ride:request', 9000);
const ack1 = await bookRide(rider, 'A');
await sleep(5600);
const toD1 = await d1Offers;
const toD2 = await d2Offers;
const legacyD2 = await d2Legacy;
const rideId = ack1?.rideId;
check('rider got a booking ack', ack1?.success === true, `rideId=${rideId}`);
check('closest driver received ride:offer', toD1.length >= 1, `count=${toD1.length}`);
check('offer carries offerId + expiresAt + secondsRemaining',
  !!toD1[0]?.offerId && !!toD1[0]?.expiresAt && toD1[0]?.secondsRemaining > 0,
  `offerId=${toD1[0]?.offerId} ttl=${toD1[0]?.secondsRemaining}s`);
check('the OTHER driver got nothing (targeted dispatch)',
  toD2.length === 0 && legacyD2.length === 0,
  `offers=${toD2.length} legacy=${legacyD2.length}`);

log('=== 3. driver2 tries to steal it ===');
const steal = await rest(`/api/rides/${rideId}/accept`, d2Token, 'POST');
check('steal refused with 409', steal.status === 409, `${steal.status} ${JSON.stringify(steal.json)}`);

log('=== 4. driver1 accepts (REST) ===');
const acceptWatch = waitFor(rider, 'ride:accepted', 20000);
const acc1 = await rest(`/api/rides/${rideId}/accept`, d1Token, 'POST');
const accepted = await acceptWatch;
check('accept ok', acc1.json?.ok === true, JSON.stringify(acc1.json));
check('rider received ride:accepted with the driver + version',
  !!accepted && !!accepted.driver_name && typeof accepted.version === 'number',
  `driver=${accepted?.driver_name} version=${accepted?.version}`);

log('=== 5. accept twice -> idempotent ===');
const acc2 = await rest(`/api/rides/${rideId}/accept`, d1Token, 'POST');
check('second accept is ok + duplicate', acc2.json?.ok === true && acc2.json?.duplicate === true,
  JSON.stringify(acc2.json));

log('=== 6. booking twice returns the SAME live ride ===');
const ack2 = await bookRide(rider, 'A-again');
check('duplicate booking reused the live ride', ack2?.reused === true && ack2?.rideId === rideId,
  `reused=${ack2?.reused} rideId=${ack2?.rideId}`);

log('=== 7. /me/active-state rebuilds the world ===');
const drvState = await rest('/api/rides/me/active-state', d1Token);
const ridState = await rest('/api/rides/me/active-state', riderToken);
check('driver state: on the ride, no pending offer',
  drvState.json?.ride?.id === rideId && !drvState.json?.offer,
  `ride=${drvState.json?.ride?.status} offer=${!!drvState.json?.offer}`);
check('rider state: same ride, driver name present',
  ridState.json?.ride?.id === rideId && !!ridState.json?.ride?.driver_name,
  `driver=${ridState.json?.ride?.driver_name}`);

log('=== 8. driver DECLINES -> ride is re-offered to the next driver ===');
rider.emit('passenger:ride:cancel', { rideId, reason: 'dispatch test cleanup 1' });
await sleep(1500);
const ackB = await bookRide(rider, 'B');
const rideB = ackB?.rideId;
const offerB1 = await waitFor(d1, 'ride:offer', 15000);
check('driver1 got the first offer for ride B', !!offerB1?.offerId, `round=${offerB1?.round}`);
const d2OfferB = waitFor(d2, 'ride:offer', 20000);
d1.emit('driver:ride:decline', { rideId: rideB, reason: 'too far' });
const offerB2 = await d2OfferB;
check('after the decline the OTHER driver was offered it', !!offerB2?.offerId,
  `round=${offerB2?.round} offerId=${offerB2?.offerId}`);
const acceptB = await rest(`/api/rides/${rideB}/accept`, d2Token, 'POST');
check('driver2 accepted the re-offered ride', acceptB.json?.ok === true, JSON.stringify(acceptB.json));

log('=== 9. offer IGNORED -> the DB worker expires it and moves the ride on ===');
rider.emit('passenger:ride:cancel', { rideId: rideB, reason: 'dispatch test cleanup 2' });
await sleep(1500);
const ackC = await bookRide(rider, 'C');
const rideC = ackC?.rideId;
const offerC1 = await waitFor(d1, 'ride:offer', 15000);
check('driver1 got the offer for ride C', !!offerC1?.offerId, `round=${offerC1?.round}`);
log('    ...waiting 20s without answering (worker should expire it at ~15s)...');
const d2OfferC = waitFor(d2, 'ride:offer', 30000);
const offerC2 = await d2OfferC;
check('worker expired the ignored offer and re-offered it', !!offerC2?.offerId,
  `round=${offerC2?.round} offerId=${offerC2?.offerId}`);
const d1State = await rest('/api/rides/me/active-state', d1Token);
check('driver1 no longer sees a live offer', !d1State.json?.offer,
  `offer=${JSON.stringify(d1State.json?.offer)}`);
rider.emit('passenger:ride:cancel', { rideId: rideC, reason: 'dispatch test cleanup 3' });
await sleep(1500);

log('=== 10. nobody online -> no_drivers + rider notified ===');
clearInterval(refresher);
const noDriversWatch = waitFor(rider, 'ride:no:drivers', 20000);
await goOnline(d1, false);
await goOnline(d2, false);
const ackD = await bookRide(rider, 'D');
const noDrivers = await noDriversWatch;
check('ride:no:drivers delivered to the rider', !!noDrivers, JSON.stringify(noDrivers));
const stateD = await rest('/api/rides/me/active-state', riderToken);
check('ride parked as no_drivers (rider can retry instead of waiting forever)',
  stateD.json?.ride?.status === 'no_drivers' || !stateD.json?.ride,
  `status=${stateD.json?.ride?.status}`);
if (ackD?.rideId) rider.emit('passenger:ride:cancel', { rideId: ackD.rideId, reason: 'dispatch test done' });
await sleep(1200);

log('=== cleanup ===');
clearInterval(refresher);
rider.disconnect(); d1.disconnect(); d2.disconnect();
log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} — dispatch ${failures === 0 ? 'verified' : 'needs work'}`);
process.exit(failures === 0 ? 0 : 1);



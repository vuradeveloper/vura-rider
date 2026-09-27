// Determines whether the LIVE server can actually persist trip STOPS, and under
// which key. The booking screen sends `waypoints` (the documented field), but a
// live booking came back with waypoints=null, so this probes the alternatives
// before we promise the rider that stops reach the driver.
// Run: node _stops.mjs <riderEmail> <riderPass>

import { io } from 'socket.io-client';

const API = process.env.VURA_API || 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';

const [email, pass] = process.argv.slice(2);
if (!email || !pass) { console.log('usage: node _stops.mjs <riderEmail> <riderPass>'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sr = await fetch(`${IDENTITY}:signInWithPassword?key=${KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: pass, returnSecureToken: true }),
});
const sj = await sr.json();
if (!sj.idToken) { console.log('sign-in failed:', sj.error?.message); process.exit(1); }
const token = sj.idToken;

const rest = async (path, method = 'GET', body) => {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, json: j };
};

const sock = await new Promise((resolve, reject) => {
  const s = io(API, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 15000 });
  s.on('connect', () => resolve(s));
  s.on('connect_error', (e) => reject(new Error(e?.message || String(e))));
  setTimeout(() => reject(new Error('socket timeout')), 20000);
});

const stops = [
  { address: 'Stop One, Rosebank', lat: -26.1450, lng: 28.0400 },
  { address: 'Stop Two, Midrand', lat: -26.0000, lng: 28.1300 },
];

/** Books one ride with a given extra payload, then reports the stored columns. */
async function probe(label, extra) {
  const ack = await new Promise((resolve) => {
    let done = false;
    const fin = (o) => { if (!done) { done = true; resolve(o); } };
    sock.once('ride:requested:ack', (d) => fin({ ok: true, d }));
    sock.once('ride:no:drivers', () => fin({ ok: false, why: 'no_drivers' }));
    setTimeout(() => fin({ ok: false, why: 'timeout' }), 20000);
    sock.emit('passenger:ride:request', {
      pickupAddress: 'Probe pickup',
      pickupLat: -26.2041, pickupLng: 28.0473,
      destinationAddress: 'Probe dropoff',
      destinationLat: -26.1076, destinationLng: 28.0567,
      tier: 'go',
      deviceId: 'stops-probe-' + Date.now(),
      ...extra,
    });
  });

  if (!ack.ok) { console.log(`  ${label.padEnd(26)} -> could not book (${ack.why})`); return; }

  await sleep(900);
  const active = await rest('/api/rides/me/active');
  const ride = active.json?.ride;
  const w = ride?.waypoints;
  const r = ride?.route_data;
  console.log(`  ${label.padEnd(26)} -> ${active.status} waypoints=${JSON.stringify(w)}  route_data=${JSON.stringify(r)?.slice(0, 60)}`);

  sock.emit('passenger:ride:cancel', { rideId: ack.d.rideId, reason: 'stops probe' });
  await sleep(1200);
}

console.log('=== which key, if any, persists STOPS? ===');
await probe('waypoints: [obj]', { waypoints: stops });
await probe('waypoints: JSON string', { waypoints: JSON.stringify(stops) });
await probe('stops: [obj]', { stops });
await probe('route_data: {stops}', { route_data: { stops } });
await probe('route: [obj]', { route: stops });
await probe('no stops (baseline)', {});

console.log('\n=== REST alternative: POST /api/rides/schedule ===');
// NOTE: there is no plain POST /api/rides — reservations go through /schedule
// (>=30 min lead time). Unlike the socket probes this needs no driver online.
const when = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
const r1 = await rest('/api/rides/schedule', 'POST', {
  pickupAddress: 'Probe pickup', pickupLat: -26.2041, pickupLng: 28.0473,
  destinationAddress: 'Probe dropoff', destinationLat: -26.1076, destinationLng: 28.0567,
  scheduledAt: when, waypoints: stops, tier: 'go',
});
console.log('  POST /api/rides/schedule -> status', r1.status, '|', JSON.stringify(r1.json)?.slice(0, 220));
const schedId = r1.json?.ride?.id;
if (schedId) {
  const g = await rest('/api/rides/' + schedId);
  const w = g.json?.ride?.waypoints ?? g.json?.waypoints;
  console.log('  GET  /api/rides/:id -> status', g.status, 'waypoints =', JSON.stringify(w));
  if (g.status !== 200) {
    // A non-200 here is a SERVER problem, not a stops problem — e.g. "column
    // r.route_data does not exist" when the DB was created by an older bootstrap.
    // Saying "still null" in that case once sent us hunting the wrong bug.
    console.log('  !! non-200 from /api/rides/:id — check the server schema/logs before');
    console.log('     concluding anything about stops (boot migration creates the columns).');
  }
  const c = await rest('/api/rides/scheduled/' + schedId + '/cancel', 'POST', { reason: 'probe' });
  console.log('  cancel -> status', c.status);
}

sock.disconnect();
process.exit(0);

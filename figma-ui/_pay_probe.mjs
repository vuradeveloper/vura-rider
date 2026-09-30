// Live probe: books a card ride EXACTLY like the new rider APK does
// (paymentMethod 'card' + fare 0.2) and prints the server's ack.
//
// Why: with no saved card the live server used to answer
//   { success: false, reason: "You need a saved card to book this ride..." }
// and RETURN BEFORE CREATING THE RIDE — so no driver was ever offered it.
// Run: node _pay_probe.mjs <riderEmail> <riderPass>
import { io } from 'socket.io-client';

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';

const [email, pass] = process.argv.slice(2);
if (!email || !pass) { console.log('usage: node _pay_probe.mjs <riderEmail> <riderPass>'); process.exit(1); }

const r = await fetch(`${IDENTITY}:signInWithPassword?key=${KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: pass, returnSecureToken: true }),
});
const j = await r.json();
if (!j.idToken) { console.log('sign-in failed: ' + (j.error?.message || JSON.stringify(j))); process.exit(2); }
const token = j.idToken;

const s = io(API, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 15000 });
await new Promise((res, rej) => {
  s.on('connect', res);
  s.on('connect_error', (e) => rej(new Error('socket: ' + (e?.message || e))));
  setTimeout(() => rej(new Error('socket timeout')), 20000);
}).catch((e) => { console.log(String(e)); process.exit(3); });
console.log('rider socket connected');

const ack = await new Promise((resolve) => {
  let done = false;
  const fin = (o) => { if (!done) { done = true; resolve(o); } };
  s.on('ride:requested:ack', (d) => fin({ kind: 'ack', d }));
  s.on('ride:no:drivers', () => fin({ kind: 'no_drivers' }));
  s.on('ride:expired', () => fin({ kind: 'expired' }));
  setTimeout(() => fin({ kind: 'timeout' }), 30000);
  // Byte-for-byte what the booking screen now emits for a card ride.
  s.emit('passenger:ride:request', {
    pickupAddress: 'Probe pickup, Sandton', pickupLat: -26.1076, pickupLng: 28.0567,
    destinationAddress: 'Probe dropoff, Rosebank', destinationLat: -26.1450, destinationLng: 28.0400,
    waypoints: [], tier: 'go', paymentMethod: 'card', fare: 0.2,
    deviceId: 'pay-probe-' + Date.now(),
  });
});

console.log('ACK: ' + JSON.stringify(ack).slice(0, 300));
console.log(ack.kind === 'ack' && ack.d?.rideId
  ? 'VERDICT: the ride WAS created — dispatch is not blocked'
  : 'VERDICT: NO RIDE — the server refused the booking, so no driver ever sees it');

if (ack.kind === 'ack' && ack.d?.rideId) {
  const active = await fetch(API + '/api/rides/me/active', { headers: { Authorization: 'Bearer ' + token } })
    .then((x) => x.json()).catch(() => null);
  const ride = active?.ride;
  console.log('stored ride: status=' + JSON.stringify(ride?.status) +
    ' payment=' + JSON.stringify(ride?.payment_method) +
    ' fare=' + JSON.stringify(ride?.estimated_fare));
  console.log('cleanup: cancelling the probe ride');
  s.emit('passenger:ride:cancel', { rideId: ack.d.rideId, reason: 'automated payment probe' });
  await new Promise((res) => setTimeout(res, 1500));
}
s.disconnect();
process.exit(0);

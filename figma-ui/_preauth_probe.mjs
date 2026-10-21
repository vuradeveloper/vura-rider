// Diagnose WHY POST /api/rides/book answers with Cloudflare HTML:
//   step 1  POST /book with a FAKE rideId → if OUR app answers (JSON 404), the
//           route+CF pass-through are fine and the failure is deeper (schema /
//           claim / Paystack call).
//   step 2  create a real ride, POST /book, print status + server + elapsed ms
//           + body head → timeout vs 5xx vs WAF tells us where it dies.
import { readFileSync } from 'node:fs';

// API override for origin-direct testing: set API=http://<eb-host> to bypass
// Cloudflare and see the app's own answer.
const API = process.env.API || 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const ID = 'https://identitytoolkit.googleapis.com/v1/accounts';
const EMAIL = 'preauth-probe-' + Date.now() + '@vura-test.dev';

const rest = async (path, token, method = 'GET', body) => {
  const t0 = Date.now();
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  return {
    status: r.status,
    ms: Date.now() - t0,
    server: r.headers.get('server'),
    ray: r.headers.get('cf-ray'),
    ctype: r.headers.get('content-type'),
    head: text.slice(0, 220),
  };
};

const su = await fetch(`${ID}:signUp?key=${KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: 'FlowTest123!', returnSecureToken: true }),
});
const { idToken } = await su.json();
if (!idToken) { console.log('signup failed'); process.exit(1); }
await rest('/api/users/sync', idToken, 'POST', { token: idToken, role: 'passenger', full_name: 'Probe', phone: '+27820000011' });

const show = (label, r) => console.log(`\n${label}\n  status=${r.status}  ${r.ms}ms  server=${r.server}  cf-ray=${r.ray}\n  ctype=${r.ctype}\n  body: ${r.head}`);

// 1) deep-fast path: handler must answer JSON even for an unknown ride
show('1) POST /api/rides/book  (FAKE rideId — is the route reachable at all?)',
  await rest('/api/rides/book', idToken, 'POST', { rideId: '00000000-0000-0000-0000-000000000000', estimatedFare: 1 }));

// 2) full path: real ride → schema → claim → Paystack LIVE initialize
const created = await rest('/api/rides/request', idToken, 'POST', {
  pickupAddress: 'Probe pickup', pickupLat: -29.8587, pickupLng: 31.0218,
  destinationAddress: 'Probe dropoff', destinationLat: -29.7284, destinationLng: 31.0878,
  paymentMethod: 'card', fare: 0.2,
});
console.log('\nride created:', created.status, created.head.slice(0, 120));
let rideId = null;
try { rideId = JSON.parse(created.head).rideId; } catch {}
if (!rideId) { try { const full = await (await fetch(API + '/api/rides/me/active', { headers: { Authorization: 'Bearer ' + idToken } })).json(); rideId = full?.ride?.id; } catch {} }
console.log('rideId =', rideId);

if (rideId) {
  show('2) POST /api/rides/book  (REAL ride — full preauth path)', await rest('/api/rides/book', idToken, 'POST', { rideId, estimatedFare: 0.2 }));
  show('3) GET  /api/rides/{id}/payment  (control: same router, GET)', await rest(`/api/rides/${rideId}/payment`, idToken));
  // cleanup
  const c = await rest(`/api/rides/${rideId}/cancel`, idToken, 'POST', { reason: 'probe cleanup' });
  console.log('\ncleanup cancel:', c.status, c.head.slice(0, 160));
}

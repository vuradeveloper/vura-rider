// Verifies that the endpoints INSIDE the shipped APKs still answer on the
// production API. The path list was extracted from the web bundles of
// `vura-rider-figma.apk` and `vura-driver-figma.apk` (assets/public/assets/*.js),
// so this is literally "what the installed apps call", exercised against
// https://api.ridevura.com — the only host either bundle contains.
//
// A 2xx/4xx is a pass (4xx = the server correctly gating role/validation).
// Any 5xx is a FAIL: that is a server error where the app expects data.
//
// Run: node figma-ui/_endpoints.mjs <email> <password> [passenger|driver]

import { io } from 'socket.io-client';

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';

const [email, password, role = 'passenger'] = process.argv.slice(2);
if (!email || !password) {
  console.log('usage: node figma-ui/_endpoints.mjs <email> <password> [passenger|driver]');
  process.exit(1);
}

let failures = 0;
const check = (n, c, d = '') => {
  console.log(`${c ? '  PASS' : '  FAIL'}  ${n}${d ? ' — ' + d : ''}`);
  if (!c) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Both bundles:
const SHARED = [
  '/api/rides/history?limit=1',
  '/api/rides/me/active',
  '/api/notifications/history?limit=1',
  '/api/documents/mine',
  '/api/drivers/profile',
  '/api/drivers/stats',
  '/api/earnings',
];
// Rider bundle only:
const RIDER_ONLY = [
  '/api/payments/methods',
  '/api/payments/banks',
  '/api/payments/driver/earnings/pending',
  '/api/search/geocode?q=Rosebank',
  '/api/search/reverse?lat=-26.2&lng=28.04',
  '/api/searches',
  '/api/ratings',
];
// Driver bundle only (the polling endpoint is what actually delivers rides):
const DRIVER_ONLY = [
  '/api/rides/available',
  '/api/route?points=28.04,-26.20;28.05,-26.10',
];

async function signIn() {
  const r = await fetch(`${IDENTITY}:signInWithPassword?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('sign-in failed: ' + JSON.stringify(j).slice(0, 200));
  console.log(`signed in as ${email} (uid ${j.localId})`);
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

const token = await signIn();

console.log('\n=== the app cold-start contract: POST /api/users/sync ===');
const sync = await rest('/api/users/sync', token, 'POST', { role });
check('POST /api/users/sync -> 2xx', sync.ok,
  'status ' + sync.status + ' ' + String(JSON.stringify(sync.json)).slice(0, 160));

const paths = [...SHARED, ...(role === 'driver' ? DRIVER_ONLY : RIDER_ONLY)];
console.log(`\n=== ${paths.length} endpoints taken from the ${role === 'driver' ? 'driver' : 'rider'} APK bundle ===`);
for (const p of paths) {
  const r = await rest(p, token);
  const note = r.status >= 500
    ? 'SERVER ERROR ' + String(JSON.stringify(r.json)).slice(0, 120)
    : (r.json && r.json.error ? String(r.json.error).slice(0, 70) : 'ok');
  console.log(`  ${r.status}  ${p.padEnd(46)} ${note}`);
  if (r.status >= 500) failures++;
}

console.log('\n=== socket layer (same origin/transport the APK uses) ===');
const sock = await new Promise((resolve) => {
  const s = io(API, { auth: { token }, transports: ['websocket', 'polling'], reconnection: false, timeout: 15000 });
  const fin = (o) => { resolve(o); try { s.disconnect(); } catch {} };
  s.on('connect', () => fin({ ok: true, id: s.id }));
  s.on('connect_error', (e) => fin({ ok: false, why: e?.message || String(e) }));
  setTimeout(() => fin({ ok: false, why: 'timeout' }), 20000);
});
check('socket connects to api.ridevura.com', sock.ok, sock.ok ? 'id ' + sock.id : sock.why);

await sleep(200);

console.log('\n=== RESULT ===');
console.log(failures === 0
  ? 'ALL CHECKS PASSED — every endpoint inside the APK is served by the new backend.'
  : `${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

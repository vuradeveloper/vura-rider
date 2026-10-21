// /api/route ANSWERED with 400 "points must be in 'lng,lat;lng,lat' format" when
// called the way lib/backend.ts's getRoute does (fromLat/fromLng/toLat/toLng).
// This finds the real contract and the real response shape, and also checks how a
// scheduled ride is cancelled.
// Run: node figma-ui/_route.mjs

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';

const log = (...a) => console.log(...a);
const FROM = { lat: -29.8587, lng: 31.0218 };   // Durban CBD
const TO = { lat: -29.7284, lng: 31.0878 };     // Umhlanga Rocks

async function rest(path, token, method = 'GET', body) {
  const r = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, json: j };
}

const show = (label, r, cap = 400) => {
  const body = typeof r.json === 'string' ? r.json : JSON.stringify(r.json);
  log(`   ${String(r.status).padEnd(4)} ${label.padEnd(44)} ${String(body).slice(0, cap)}`);
  return r;
};

log('=== GET /api/route WITHOUT auth, correct format ===');
show("points=lng,lat;lng,lat", await rest(
  `/api/route?points=${FROM.lng},${FROM.lat};${TO.lng},${TO.lat}`));

log('');
log('=== GET /api/route WITHOUT auth, wrong (current client) format ===');
show('fromLat/fromLng/toLat/toLng', await rest(
  `/api/route?fromLat=${FROM.lat}&fromLng=${FROM.lng}&toLat=${TO.lat}&toLng=${TO.lng}`));

// ── scheduled ride + cancel, authenticated ───────────────────────────────────
const su = await fetch(`${IDENTITY}:signUp?key=${KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'route-rider-' + Date.now() + '@vura-test.dev', password: 'FlowTest123!', returnSecureToken: true }),
});
const acct = await su.json();
if (!acct.idToken) { log('sign-up failed:', acct.error?.message); process.exit(1); }
const token = acct.idToken;
await rest('/api/users/sync', token, 'POST', { token, role: 'passenger', full_name: 'Route Rider', phone: '+27820000011' });

log('');
log('=== scheduled ride cancel ===');
const made = show('POST /api/rides/schedule', await rest('/api/rides/schedule', token, 'POST', {
  pickupAddress: 'Durban CBD', pickupLat: FROM.lat, pickupLng: FROM.lng,
  destinationAddress: 'Umhlanga Rocks', destinationLat: TO.lat, destinationLng: TO.lng,
  scheduledAt: new Date(Date.now() + 3 * 3600e3).toISOString(),
}), 160);
const id = made.json?.ride?.id;
log('        -> scheduled ride id:', id);

if (id) {
  // The old app used POST .../cancel; try the shapes in order and keep the first
  // that is not 404.
  show('POST /api/rides/scheduled/{id}/cancel', await rest(`/api/rides/scheduled/${id}/cancel`, token, 'POST'));
  show('GET  /api/rides/scheduled/{id}/cancel', await rest(`/api/rides/scheduled/${id}/cancel`, token));
  show('POST /api/rides/{id}/cancel', await rest(`/api/rides/${id}/cancel`, token, 'POST'));
  show('POST /api/rides/{id}/status', await rest(`/api/rides/${id}/status`, token, 'POST', { status: 'cancelled' }));
  show('GET  /api/rides/scheduled (after)', await rest('/api/rides/scheduled', token), 260);
}

log('');
log('=== GET /api/route WITH auth, correct format, full body ===');
const auth = await rest(`/api/route?points=${FROM.lng},${FROM.lat};${TO.lng},${TO.lat}`, token);
log('   status', auth.status);
log('   keys:', Object.keys(auth.json || {}).join(', '));
log('   json:', JSON.stringify(auth.json).slice(0, 700));
process.exit(0);
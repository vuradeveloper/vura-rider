// Probes the LIVE server for the endpoints behind the rider features that are
// still NOT wired into figma-ui/src/App.tsx:
//   emergency contacts (CRUD), safety events, disputes (list+create),
//   scheduled rides (list+create), route polyline, tips, ratings.
//
// Self-contained: creates a throwaway rider, so no credentials are needed and no
// existing account is touched (that is what a role-flipping /api/users/sync did
// before). Only the rider's OWN rows are written.
// Run: node figma-ui/_rider2.mjs

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';

const log = (...a) => console.log(...a);
const EMAIL = 'probe-rider-' + Date.now() + '@vura-test.dev';
const PASSWORD = 'FlowTest123!';

// Durban CBD -> Umhlanga, fixed pairs so /api/route has a sane corridor.
const FROM = { lat: -29.8587, lng: 31.0218 };
const TO = { lat: -29.7284, lng: 31.0878 };

async function rest(path, token, method = 'GET', body) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, json: j };
}

const su = await fetch(`${IDENTITY}:signUp?key=${KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
});
const acct = await su.json();
if (!acct.idToken) { log('sign-up failed:', acct.error?.message); process.exit(1); }
const token = acct.idToken;

await rest('/api/users/sync', token, 'POST', {
  token, role: 'passenger', full_name: 'Probe Rider', phone: '+27820000009',
});
log('probe rider ready:', EMAIL);
log('');

const row = (label, r) => {
  const body = typeof r.json === 'string' ? r.json.slice(0, 120) : JSON.stringify(r.json)?.slice(0, 220);
  log(`   ${String(r.status).padEnd(4)} ${label.padEnd(46)} ${body ?? ''}`);
  return r;
};

log('=== EMERGENCY CONTACTS ===');
row('GET  /api/safety/contacts', await rest('/api/safety/contacts', token));
const created = row('POST /api/safety/contacts', await rest('/api/safety/contacts', token, 'POST', {
  name: 'Probe Contact', phone: '+27821112222', relationship: 'Sibling',
}));
const contactId = created.json?.contact?.id ?? created.json?.id ?? null;
log('        -> new contact id:', contactId);
if (contactId) row('DELETE /api/safety/contacts/{id}', await rest(`/api/safety/contacts/${contactId}`, token, 'DELETE'));

log('');
log('=== SAFETY EVENTS ===');
row('GET  /api/safety/events', await rest('/api/safety/events', token));

log('');
log('=== DISPUTES ===');
row('GET  /api/disputes', await rest('/api/disputes', token));
row('POST /api/disputes (needs real rideId)', await rest('/api/disputes', token, 'POST', {
  rideId: 'probe-nonexistent', type: 'other', reason: 'probe only',
}));

log('');
log('=== SCHEDULED RIDES ===');
row('GET  /api/rides/scheduled', await rest('/api/rides/scheduled', token));
const scheduledAt = new Date(Date.now() + 3 * 3600e3).toISOString();
row('POST /api/rides/schedule', await rest('/api/rides/schedule', token, 'POST', {
  pickupAddress: 'Durban CBD',
  pickupLat: FROM.lat, pickupLng: FROM.lng,
  destinationAddress: 'Umhlanga Rocks',
  destinationLat: TO.lat, destinationLng: TO.lng,
  scheduledAt,
}));

log('');
log('=== ROUTE ===');
row('GET  /api/route', await rest(
  `/api/route?fromLat=${FROM.lat}&fromLng=${FROM.lng}&toLat=${TO.lat}&toLng=${TO.lng}`, token));

log('');
log('=== TIPS / RATINGS (need a real rideId) ===');
row('POST /api/tips', await rest('/api/tips', token, 'POST', { rideId: 'probe-nonexistent', amount: 10 }));
row('POST /api/ratings', await rest('/api/ratings', token, 'POST', { rideId: 'probe-nonexistent', score: 5 }));

log('');
log('probe rider left behind (not deleted): ' + EMAIL);
process.exit(0);
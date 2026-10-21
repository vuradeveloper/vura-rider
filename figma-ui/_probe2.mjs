// Second probe pass:
//  1) POST route existence — sent WITHOUT auth and WITHOUT a body, so the auth
//     middleware answers 401 for routes that exist and the router answers 404 for
//     routes that don't. Nothing can be written, because an unauthenticated
//     request never reaches a handler. (An authenticated POST with a junk body
//     DID create a row during the driver work — this avoids repeating that.)
//  2) Extra GET path guesses for the features the first pass reported absent.
// Run: node figma-ui/_probe2.mjs

const API = 'https://api.ridevura.com';
const log = (...a) => console.log(...a);

async function probe(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, json: j };
}

const verdict = (s) => (s === 404 ? 'ABSENT' : s === 401 ? 'EXISTS (auth)' : s === 400 ? 'EXISTS (no auth needed)' : s === 403 ? 'EXISTS (role-gated)' : 'PUBLIC/OK');

log('=== POST route existence (no auth, no body — cannot write) ===');
const POSTS = [
  '/api/users/sync',
  '/api/ratings',
  '/api/disputes',
  '/api/safety/contacts',
  '/api/safety/sos',
  '/api/safety/ridecheck',
  '/api/rides',
  '/api/rides/request',
  '/api/rides/scheduled',
  '/api/rides/schedule',
  '/api/payments/methods',
  '/api/payments/topup',
  '/api/payments/charge',
  '/api/tips',
  '/api/rides/lost-item',
  '/api/lost-item',
  '/api/share',
  '/api/splits',
];
for (const p of POSTS) {
  const r = await probe('POST', p);
  log(`   ${String(r.status).padEnd(4)} ${verdict(r.status).padEnd(23)} POST ${p}`);
}

log('\n=== extra GET path guesses ===');
const GETS = [
  '/api/users/sync',
  '/api/users/me',
  '/api/users',
  '/api/saved-places',
  '/api/users/saved-places',
  '/api/places',
  '/api/recent-searches',
  '/api/users/recent-searches',
  '/api/notifications',
  '/api/users/notifications',
  '/api/promotions',
  '/api/promos',
  '/api/promotion',
  '/api/coupons',
  '/api/pay-later',
  '/api/payments/pay-later/account',
  '/api/payments/paylater/account',
  '/api/affiliate/summary',
  '/api/referrals',
  '/api/rides/scheduled',
  '/api/safety/contacts',
  '/api/safety/events',
  '/api/disputes',
  '/api/tips/summary',
  '/api/drivers/nearby?lat=-26.2&lng=28.04',
  '/api/health',
];
for (const p of GETS) {
  const r = await probe('GET', p);
  log(`   ${String(r.status).padEnd(4)} ${verdict(r.status).padEnd(23)} GET  ${p}`);
}

log('\n=== what does /api/search/geocode need? (unauthenticated) ===');
const g1 = await probe('GET', '/api/search/geocode?q=Sandton');
log('   status', g1.status, JSON.stringify(g1.json).slice(0, 200));

log('\n=== /api/drivers/nearby is PUBLIC — does it return a list? ===');
log('   ', JSON.stringify(await probe('GET', '/api/drivers/nearby?lat=-26.2&lng=28.04')).slice(0, 300));

process.exit(0);
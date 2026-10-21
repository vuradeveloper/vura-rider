// LIVE route-existence probe for the RIDER app's API surface.
// Unauthenticated only: a 401 means the route EXISTS (it just needs a token) and
// a 404 means it does not exist. This is read-only and creates nothing, so it is
// safe to run against production — which is exactly why it is used first.
// Run: node figma-ui/_probe.mjs

const API = 'https://api.ridevura.com';

const log = (...a) => console.log(...a);

async function probe(method, path) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, json: j };
}

const GETS = [
  // ride flow
  '/api/rides/me/active',
  '/api/rides/history?page=1&limit=5',
  '/api/rides/available',
  // rider profile / sync
  '/api/users/sync',
  '/api/users/me',
  // search + places
  '/api/search/geocode?q=Sandton',
  '/api/search/places',
  '/api/places/saved',
  '/api/saved-places',
  // payments
  '/api/payments/methods',
  '/api/payments/banks',
  '/api/payments/driver/earnings/pending',
  '/api/payments/pay-later',
  '/api/pay-later',
  '/api/pay-later/account',
  // promos / affiliate
  '/api/promotions',
  '/api/affiliate',
  '/api/affiliate/me',
  '/api/affiliate/referrals',
  '/api/affiliate/transactions',
  // safety / support
  '/api/safety/contacts',
  '/api/safety/events',
  '/api/disputes',
  '/api/lost-items',
  '/api/notifications',
  // scheduling
  '/api/rides/scheduled',
  '/api/scheduled-rides',
  // chat / split
  '/api/chat',
  '/api/splits',
  // drivers
  '/api/drivers/nearby?lat=-26.2&lng=28.04',
  '/api/drivers/stats',
];

log('=== GET route existence (401 = exists, 404 = absent) ===');
const results = [];
for (const p of GETS) {
  const r = await probe('GET', p);
  const verdict = r.status === 404 ? 'ABSENT' : r.status === 401 ? 'EXISTS (auth)' : 'PUBLIC';
  results.push({ path: p, status: r.status, verdict });
  log(`   ${String(r.status).padEnd(4)} ${verdict.padEnd(13)} ${p}`);
}

log('\n=== summary ===');
const absent = results.filter((r) => r.status === 404);
const present = results.filter((r) => r.status !== 404);
log(`   present: ${present.length}   absent: ${absent.length}`);
if (absent.length) {
  log('   absent routes:');
  for (const a of absent) log('      ' + a.path);
}

process.exit(0);
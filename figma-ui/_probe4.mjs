// Definitive route probe: every path the OLD rider app calls, extracted from
// vura-rider/services + lib + app (not guessed). For each path, GET is tried
// first and POST second when GET 404s, so a POST-only route is not misreported
// as absent. Unauthenticated and bodyless, so the auth gate answers (401) before
// any handler runs and nothing can be written.
// Run: node figma-ui/_probe4.mjs

const API = 'https://api.ridevura.com';
const log = (...a) => console.log(...a);

async function one(method, path) {
  const url = API + path.replace(/\$\{[^}]*\}/g, 'x').replace(/\?.*$/, '');
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' } });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, json: j };
}

const PATHS = [
  // auth / user
  '/api/users/sync', '/api/users/profile', '/api/users/photo', '/api/users/delete',
  '/api/email/send-verification',
  // rides
  '/api/rides/me/active', '/api/rides/history', '/api/rides/x', '/api/rides/x/status',
  '/api/rides/x/receipt', '/api/rides/x/pickup', '/api/rides/schedule', '/api/rides/scheduled',
  '/api/rides/scheduled/x/cancel',
  // search
  '/api/search/geocode', '/api/search/reverse', '/api/search/community', '/api/search/discover',
  '/api/searches', '/api/route',
  // payments
  '/api/payments/methods', '/api/payments/banks', '/api/payments/banks/verify',
  '/api/payments/card-register', '/api/payments/initialize', '/api/payments/initiate',
  '/api/payments/verify', '/api/payments/return', '/api/payments/driver/earnings/pending',
  '/api/payments/driver/banking',
  // pay later
  '/api/payments/pay-later/enroll', '/api/payments/pay-later/status',
  '/api/payments/pay-later/refresh', '/api/payments/pay-later/collect',
  '/api/payments/pay-later/x/pay', '/api/payments/pay-later/dev/simulate',
  // affiliate
  '/api/affiliates/register', '/api/affiliates/claim', '/api/affiliates/me',
  '/api/affiliates/me/referrals', '/api/affiliates/me/transactions', '/api/affiliates/use',
  // safety / support
  '/api/safety/contacts', '/api/safety/contacts/x', '/api/safety/events', '/api/safety/sos',
  '/api/safety/share', '/api/safety/share/stop',
  '/api/disputes', '/api/disputes/lost-item', '/api/disputes/lost-items',
  // social
  '/api/split/invite', '/api/split/pending', '/api/split/respond', '/api/split/status',
  '/api/tips', '/api/ratings',
  // notifications
  '/api/notifications/history', '/api/notifications/register',
];

const verdict = (s) =>
  s === 404 ? 'ABSENT' : s === 401 ? 'EXISTS' : s === 403 ? 'EXISTS' :
  s === 400 ? 'EXISTS' : s === 200 ? 'PUBLIC' : 'HTTP ' + s;

const present = [];
const absent = [];

log('=== every endpoint the old rider app calls ===');
for (const p of PATHS) {
  const g = await one('GET', p);
  let method = 'GET';
  let res = g;
  if (g.status === 404) {
    const po = await one('POST', p);
    if (po.status !== 404) { method = 'POST'; res = po; }
  }
  const v = verdict(res.status);
  log(`   ${String(res.status).padEnd(4)} ${v.padEnd(7)} ${method.padEnd(4)} ${p}`);
  (v === 'ABSENT' ? absent : present).push(`${method} ${p}`);
}

log(`\n=== SUMMARY: ${present.length} present, ${absent.length} absent ===`);
if (absent.length) {
  log('   ABSENT (no route on the live server):');
  for (const a of absent) log('      ' + a);
}
process.exit(0);
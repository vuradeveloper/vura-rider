// Third probe pass — the paths the RIDER's own services actually call, taken from
// vura-rider/services/PaymentService.ts, DriverPaymentService.ts and
// AffiliateService.ts. My earlier passes guessed some wrong spellings (singular
// /api/affiliate instead of /api/affiliates), so this corrects that.
// Unauthenticated, read-only: 401 = exists, 404 = absent, and nothing is written.
// Run: node figma-ui/_probe3.mjs

const API = 'https://api.ridevura.com';
const log = (...a) => console.log(...a);

async function probe(method, path) {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json' } });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, json: j };
}
const verdict = (s) =>
  s === 404 ? 'ABSENT' : s === 401 ? 'EXISTS (auth)' : s === 400 ? 'EXISTS (bad request)' :
  s === 403 ? 'EXISTS (role)' : 'PUBLIC/OK';

const GETS = [
  '/api/payments/card-register',
  '/api/payments/initialize',
  '/api/payments/initiate',
  '/api/payments/verify',
  '/api/payments/return',
  '/api/payments/banks/verify',
  '/api/payments/driver/banking',
  '/api/payments/methods',
  '/api/affiliates',
  '/api/affiliates/me',
  '/api/affiliates/use',
  '/api/affiliates/summary',
  '/api/affiliates/referrals',
  '/api/affiliates/transactions',
];
log('=== GET (paths the rider services actually use) ===');
for (const p of GETS) {
  const r = await probe('GET', p);
  log(`   ${String(r.status).padEnd(4)} ${verdict(r.status).padEnd(19)} GET  ${p}`);
}

const POSTS = [
  '/api/payments/card-register',
  '/api/payments/initialize',
  '/api/payments/initiate',
  '/api/payments/verify',
  '/api/affiliates/use',
  '/api/payments/banks/verify',
];
log('\n=== POST (no auth, no body — the auth gate answers before any handler) ===');
for (const p of POSTS) {
  const r = await probe('POST', p);
  log(`   ${String(r.status).padEnd(4)} ${verdict(r.status).padEnd(19)} POST ${p}`);
}

// What does initialize return when unauthenticated? Tells us if Paystack is wired.
log('\n=== /api/payments/initialize body ===');
log('   ', JSON.stringify(await probe('POST', '/api/payments/initialize')).slice(0, 240));

process.exit(0);
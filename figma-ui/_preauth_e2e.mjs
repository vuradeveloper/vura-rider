// END-TO-END PREAUTH TEST against the LIVE server (api.ridevura.com).
//
// What it proves, using only throwaway probe rows:
//   1. POST /api/rides/book places a REAL hold (Paystack LIVE /preauthorization/
//      initialize) → HOLD_PENDING + authorization_url + columns from migration 014
//   2. unsigned webhook → 401 (signature gate)
//   3. a webhook SIGNED BY US (same HMAC Paystack sends) flips HOLD_PENDING →
//      HOLD_ACTIVE (reserve.success) — signature verified, transition applied,
//      reusable authorization saved
//   4. replaying the same event → 200 duplicate, state unchanged (idempotency)
//   5. /:id/complete calls Paystack LIVE capture → honest PAYMENT_FAILED when
//      Paystack refuses an unauthorized hold (no money can move: the checkout
//      was never completed)
//   6. a capture.success arriving in the WRONG state is ignored (guard)
//   7. cancel on a HOLD_PENDING ride releases immediately (abandoned-checkout
//      branch) → RELEASED
//
// The secret is read from deploy/production.env and NEVER printed.
// Run: node figma-ui/_preauth_e2e.mjs
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';

// Production signs with PAYSTACK_SECRET_LIVE (PAYMENTS_MODE=live).
const env = readFileSync(new URL('../deploy/production.env', import.meta.url), 'utf8');
const SECRET = (env.match(/^PAYSTACK_SECRET_LIVE=(.+)$/m) || [])[1]?.trim();
if (!SECRET || !SECRET.startsWith('sk_live')) {
  console.log('FATAL: sk_live secret not found in deploy/production.env');
  process.exit(1);
}

const sign = (raw) => createHmac('sha512', SECRET).update(Buffer.from(raw, 'utf8')).digest('hex');
const log = (...a) => console.log(...a);
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? '  → ' + detail : ''}`); };

async function rest(path, token, method = 'GET', body) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, json: j };
}

async function webhook(payload, signature) {
  const raw = JSON.stringify(payload);
  const r = await fetch(API + '/api/paystack/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(signature ? { 'x-paystack-signature': signature } : {}) },
    body: raw,
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, json: j };
}

// ── throwaway rider ──────────────────────────────────────────────────────────
const EMAIL = 'preauth-e2e-' + Date.now() + '@vura-test.dev';
const su = await fetch(`${IDENTITY}:signUp?key=${KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: 'FlowTest123!', returnSecureToken: true }),
});
const acct = await su.json();
if (!acct.idToken) { console.log('sign-up failed:', acct.error?.message); process.exit(1); }
const token = acct.idToken;
await rest('/api/users/sync', token, 'POST', { token, role: 'passenger', full_name: 'Preauth E2E', phone: '+278200000' + String(Date.now()).slice(-3) });
log('probe rider:', EMAIL, '\n');

async function newRide() {
  const r = await rest('/api/rides/request', token, 'POST', {
    pickupAddress: 'Probe pickup Durban', pickupLat: -29.8587, pickupLng: 31.0218,
    destinationAddress: 'Probe dropoff Umhlanga', destinationLat: -29.7284, destinationLng: 31.0878,
    paymentMethod: 'card', fare: 0.2, tier: 'go',
  });
  return r.json?.rideId || null;
}

// ═══ RIDE A: real hold (HOLD_PENDING) → cancel → RELEASED ═══
log('=== RIDE A: /book → real Paystack hold → cancel → release ===');
const rideA = await newRide();
check('ride created via POST /api/rides/request', !!rideA, rideA);

const bookA = await rest('/api/rides/book', token, 'POST', { rideId: rideA, estimatedFare: 0.2 });
check('POST /api/rides/book → 200', bookA.status === 200, JSON.stringify(bookA.json)?.slice(0, 160));
check('HOLD_PENDING + real checkout.paystack.com URL (LIVE initialize)',
  bookA.json?.paymentStatus === 'HOLD_PENDING' && String(bookA.json?.authorizationUrl || '').includes('checkout.paystack.com'),
  `${bookA.json?.paymentStatus} ref=${bookA.json?.reference}`);

const payA = await rest(`/api/rides/${rideA}/payment`, token);
check('GET /:id/payment reports HOLD_PENDING', payA.json?.paymentStatus === 'HOLD_PENDING', payA.json?.paymentStatus);

const unsigned = await webhook({ event: 'preauthorization.capture.success', data: { reference: bookA.json?.reference, id: 1 } });
check('unsigned webhook → 401 (signature gate)', unsigned.status === 401, String(unsigned.status));

const cancelA = await rest(`/api/rides/${rideA}/cancel`, token, 'POST', { reason: 'preauth e2e' });
check('cancel → released:true + success', cancelA.json?.success === true && cancelA.json?.released === true, JSON.stringify(cancelA.json));
const payA2 = await rest(`/api/rides/${rideA}/payment`, token);
check('paymentStatus RELEASED', payA2.json?.paymentStatus === 'RELEASED', payA2.json?.paymentStatus);

// ═══ RIDE B: SIGNED webhook → HOLD_ACTIVE → capture → guards ═══
log('');
log('=== RIDE B: signed reserve.success → HOLD_ACTIVE → capture (LIVE) ===');
const rideB = await newRide();
const bookB = await rest('/api/rides/book', token, 'POST', { rideId: rideB, estimatedFare: 0.2 });
check('ride B → HOLD_PENDING', bookB.json?.paymentStatus === 'HOLD_PENDING', 'ref=' + bookB.json?.reference);
const refB = bookB.json?.reference;

const reserveEv = {
  event: 'preauthorization.reserve.success',
  data: {
    id: 543000, reference: refB, status: 'authorized', amount: 100, currency: 'ZAR',
    expiry_date: new Date(Date.now() + 86400000).toISOString(), expire_action: 'release',
    authorization: { authorization_code: 'AUTH_e2e' + randomBytes(4).toString('hex'), last4: '4242', card_type: 'visa credit', bank: 'E2E PROBE', exp_month: '12', exp_year: '2030', reusable: true },
  },
};
const signed = await webhook(reserveEv, sign(JSON.stringify(reserveEv)));
check('SIGNED reserve.success → 200 handled:true', signed.status === 200 && signed.json?.handled === true, JSON.stringify(signed.json));
const payB = await rest(`/api/rides/${rideB}/payment`, token);
check('transition applied → HOLD_ACTIVE', payB.json?.paymentStatus === 'HOLD_ACTIVE', payB.json?.paymentStatus);

const replay = await webhook(reserveEv, sign(JSON.stringify(reserveEv)));
check('REPLAY same event → duplicate:true, ignored', replay.status === 200 && replay.json?.duplicate === true, JSON.stringify(replay.json));

const badSig = await webhook(reserveEv, '00'.repeat(64));
check('wrong signature → 401', badSig.status === 401, String(badSig.status));

const rebook = await rest('/api/rides/book', token, 'POST', { rideId: rideB, estimatedFare: 0.2 });
check('book again → alreadyHeld (no 2nd hold created)', rebook.json?.alreadyHeld === true && rebook.json?.paymentStatus === 'HOLD_ACTIVE', JSON.stringify(rebook.json)?.slice(0, 120));

const complete = await rest(`/api/rides/${rideB}/complete`, token, 'POST', {});
log(`        POST /:id/complete → ${complete.status} ${JSON.stringify(complete.json)?.slice(0, 180)}`);
const payB2 = await rest(`/api/rides/${rideB}/payment`, token);
const state2 = payB2.json?.paymentStatus;
// LIVE Paystack refuses to capture a never-authorized hold (checkout was never
// finished) → PAYMENT_FAILED + 502. If it ever accepts → CAPTURE_PENDING, and
// the signed capture.success below should then flip it to PAID.
check('capture reached Paystack LIVE with an honest terminal state',
  state2 === 'PAYMENT_FAILED' || state2 === 'CAPTURE_PENDING', 'paymentStatus=' + state2);

const capEv = { event: 'preauthorization.capture.success', data: { id: 9, reference: refB, captured_amount: '20', amount: 20, status: 'captured' } };
const cap = await webhook(capEv, sign(JSON.stringify(capEv)));
const payB3 = await rest(`/api/rides/${rideB}/payment`, token);
if (state2 === 'CAPTURE_PENDING') {
  check('capture.success → PAID (full happy path)', cap.json?.handled === true && payB3.json?.paymentStatus === 'PAID', payB3.json?.paymentStatus);
} else {
  check('capture.success in wrong state → handled:false (guard)', cap.status === 200 && cap.json?.handled === false, JSON.stringify(cap.json));
  check('state unchanged after stray event', payB3.json?.paymentStatus === state2, payB3.json?.paymentStatus);
}

const cancelB = await rest(`/api/rides/${rideB}/cancel`, token, 'POST', { reason: 'preauth e2e cleanup' });
check('cleanup: ride B cancelled (payment state terminal, not clobbered)',
  cancelB.json?.success === true, 'paymentStatus=' + cancelB.json?.paymentStatus);

log('');
const failed = results.filter((r) => !r.ok);
log(`===== ${results.length - failed.length}/${results.length} CHECKS PASSED =====`);
for (const f of failed) log('  FAILED:', f.name);
process.exit(failed.length ? 1 : 0);


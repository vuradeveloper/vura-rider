// Probes the LIVE payment endpoints the booking screen needs, using a real rider
// token, so the UI is built against what the server actually returns.
// Run: node _pay.mjs <riderEmail> <riderPass>

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';

const [email, pass] = process.argv.slice(2);
if (!email || !pass) { console.log('usage: node _pay.mjs <riderEmail> <riderPass>'); process.exit(1); }

const signIn = async (e, p) => {
  const r = await fetch(`${IDENTITY}:signInWithPassword?key=${KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: e, password: p, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error('sign-in failed: ' + j.error?.message);
  return j.idToken;
};

const call = async (path, method = 'GET', body) => {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, json: j };
};

const token = await signIn(email, pass);
console.log('signed in as', email, '\n');

console.log('=== GET /api/payments/methods (saved cards) ===');
const methods = await call('/api/payments/methods');
console.log('  status', methods.status, '|', JSON.stringify(methods.json).slice(0, 400));

console.log('\n=== GET /api/payments/banks ===');
const banks = await call('/api/payments/banks');
console.log('  status', banks.status, '|',
  Array.isArray(banks.json) ? `${banks.json.length} banks: ` + banks.json.slice(0, 4).map(b => b.name).join(', ')
                            : JSON.stringify(banks.json).slice(0, 200));

console.log('\n=== POST /api/payments/card-register (Paystack secure add) ===');
const reg = await call('/api/payments/card-register', 'POST', {});
console.log('  status', reg.status, '|', JSON.stringify(reg.json).slice(0, 500));

console.log('\n=== POST /api/payments/methods (manual add, dry-run value) ===');
const add = await call('/api/payments/methods', 'POST',
  { card_type: 'visa', last4: '0001', bank: 'Probe Bank', is_default: true });
console.log('  status', add.status, '|', JSON.stringify(add.json).slice(0, 400));

if (add.json?.id) {
  console.log('\n=== DELETE the probe card (clean up) ===');
  const del = await call('/api/payments/methods/' + add.json.id, 'DELETE');
  console.log('  status', del.status, '|', JSON.stringify(del.json).slice(0, 200));
}

console.log('\n=== GET /api/payments/initialize capabilities: cash accepted? ===');
const init = await call('/api/payments/initialize', 'POST', { rideId: 'does-not-exist', paymentMethod: 'cash' });
console.log('  status', init.status, '|', JSON.stringify(init.json).slice(0, 300));
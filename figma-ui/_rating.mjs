// Proves the rating endpoint the ReceiptScreen calls (POST /api/ratings) exists
// and validates. A GET on an Express route returns 404 regardless, which is what
// a naive probe sees, so this sends a real POST with a bogus ride id: a mounted
// route answers with a validation/not-found error, a missing route answers
// exactly "Route not found".
// Run: node figma-ui/_rating.mjs <email> <password>

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';

const [email, password] = process.argv.slice(2);
if (!email || !password) { console.log('usage: node figma-ui/_rating.mjs <email> <password>'); process.exit(1); }

const r0 = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, returnSecureToken: true }),
});
const j0 = await r0.json();
if (!j0.idToken) { console.log('sign-in failed:', j0.error?.message); process.exit(1); }

const r = await fetch(API + '/api/ratings', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + j0.idToken },
  body: JSON.stringify({ rideId: '00000000-0000-0000-0000-000000000000', score: 5, comment: 'probe' }),
});
const t = await r.text();
console.log('POST /api/ratings ->', r.status, t.slice(0, 200));
const missing = r.status === 404 && /Route not found/i.test(t);
console.log(missing
  ? '  ROUTE MISSING — the ReceiptScreen rating would fail'
  : '  route exists (it validated the request instead of 404-ing on the path)');
process.exit(missing ? 1 : 0);

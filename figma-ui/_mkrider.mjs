// Creates a fresh RIDER (passenger) test account so the flow test has someone to
// book with. This only CREATES a new user row — it never modifies an existing
// account, so no driver's role can be flipped.
// Run: node figma-ui/_mkrider.mjs

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';

const EMAIL = 'flow-rider-' + Date.now() + '@vura-test.dev';
const PASSWORD = 'FlowTest123!';

const log = (...a) => console.log(...a);

const su = await fetch(`${IDENTITY}:signUp?key=${KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
});
const j = await su.json();
if (!j.idToken) { log('sign-up failed:', j.error?.message); process.exit(1); }
log('created rider:', EMAIL);

const sync = await fetch(API + '/api/users/sync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + j.idToken },
  body: JSON.stringify({ token: j.idToken, role: 'passenger', full_name: 'Flow Test Rider', phone: '+27820000001' }),
});
const sj = await sync.json().catch(() => ({}));
log('POST /api/users/sync ->', sync.status, '| role:', sj?.user?.role, '| id:', sj?.user?.id);

log('\nRIDER_EMAIL=' + EMAIL);
log('RIDER_PASSWORD=' + PASSWORD);
process.exit(0);
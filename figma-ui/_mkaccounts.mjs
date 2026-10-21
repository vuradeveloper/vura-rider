// Creates the three throwaway accounts _flow.mjs / _book.mjs need:
// one rider and TWO drivers (the flow test proves a second driver can NOT see
// the ride). Same pattern as _mkrider.mjs — creates brand-new rows only, never
// touches an existing account, so no real driver's role can be flipped.
// Run: node figma-ui/_mkaccounts.mjs
//
// All three share the password below so the probes can be re-run quickly.

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';

const PASSWORD = 'FlowTest123!';
const stamp = Date.now();
const log = (...a) => console.log(...a);

async function make(role, label, name, phone) {
  const email = `${label}-${stamp}@vura-test.dev`;
  const su = await fetch(`${IDENTITY}:signUp?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const j = await su.json();
  if (!j.idToken) { log(`${label} sign-up failed:`, j.error?.message); return null }

  const sync = await fetch(API + '/api/users/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + j.idToken },
    body: JSON.stringify({ token: j.idToken, role, full_name: name, phone }),
  });
  const sj = await sync.json().catch(() => ({}));
  log(`${label}: ${email} | sync ${sync.status} | role ${sj?.user?.role} | id ${sj?.user?.id}`);
  return email;
}

const rider = await make('passenger', 'flow-rider', 'Flow Test Rider', '+27820000011');
const driverA = await make('driver', 'flow-driver-a', 'Flow Test Driver A', '+27820000012');
const driverB = await make('driver', 'flow-driver-b', 'Flow Test Driver B', '+27820000013');

log('');
log('RIDER=' + rider);
log('DRIVER_A=' + driverA);
log('DRIVER_B=' + driverB);
log('PASSWORD=' + PASSWORD);
process.exit(0);

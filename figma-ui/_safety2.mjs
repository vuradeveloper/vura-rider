// Verifies the LIVE contracts behind the rider screens that were still missing
// from figma-ui, so the UI is built on responses the server really returns:
//   emergency contacts (GET/POST/DELETE + read-back), SOS, share + share/stop,
//   disputes (list/create/lost-item), split fare, tips, ratings, and the full
//   scheduled-ride lifecycle (create -> list -> cancel -> gone).
//
// Self-contained: signs up a throwaway rider (same trick as _rider2.mjs), so no
// credentials are needed and no existing account is touched. Only the throwaway
// rider's own rows are written — the scheduled ride is cancelled again at the
// end.
// Run: node figma-ui/_safety2.mjs

const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (n, c, d) => { log(`${c ? '  PASS' : '  FAIL'}  ${n}${d ? ' — ' + d : ''}`); if (!c) failures++; };

const EMAIL = 'probe-rider-' + Date.now() + '@vura-test.dev';
const PASSWORD = 'FlowTest123!';

async function rest(path, token, method = 'GET', body) {
  const r = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, ok: r.ok, json: j, text: t };
}

/**
 * Express answers an unmatched route with its own HTML 404 page ("Cannot POST
 * /api/..."). Distinguishing that from a handler's own JSON 404 is the only way
 * to tell "route missing" from "route ran and rejected the input".
 */
const routeMissing = (r) => /Cannot (GET|POST|DELETE|PUT) /.test(String(r.text || ''));
const row = (label, r) => {
  const body = typeof r.json === 'string' ? String(r.json).slice(0, 110) : JSON.stringify(r.json)?.slice(0, 200);
  const verdict = routeMissing(r) ? 'ROUTE ABSENT' : r.ok ? 'ok' : 'rejected';
  log(`   ${String(r.status).padEnd(4)} ${verdict.padEnd(12)} ${label.padEnd(44)} ${body ?? ''}`);
  return r;
};

const su = await fetch(`${IDENTITY}:signUp?key=${KEY}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
});
const acct = await su.json();
if (!acct.idToken) { log('sign-up failed:', acct.error?.message); process.exit(1); }
const token = acct.idToken;

await rest('/api/users/sync', token, 'POST', {
  token, role: 'passenger', full_name: 'Probe Rider 2', phone: '+27820000011',
});
log('probe rider ready:', EMAIL);
log('');

// ── Emergency contacts (Safety Center) ───────────────────────────────────────
log('=== EMERGENCY CONTACTS ===');
const list0 = row('GET    /api/safety/contacts', await rest('/api/safety/contacts', token));
check('contacts list shape is { contacts: [] }', Array.isArray(list0.json?.contacts),
  'keys: ' + Object.keys(list0.json || {}).join(','));

const created = row('POST   /api/safety/contacts (name/phone/relationship)', await rest('/api/safety/contacts', token, 'POST', {
  name: 'Probe Contact', phone: '+27821112222', relationship: 'Sibling',
}));
const contactId = created.json?.contact?.id ?? created.json?.id ?? created.json?.contact?._id ?? null;
check('create returns the new contact id', !!contactId, String(contactId));

const list1 = await rest('/api/safety/contacts', token);
const listed = (list1.json?.contacts || []).some((c) => String(c.id) === String(contactId));
check('created contact is returned by the next GET', listed, JSON.stringify(list1.json?.contacts || []).slice(0, 160));

if (contactId) {
  const del = row('DELETE /api/safety/contacts/{id}', await rest(`/api/safety/contacts/${contactId}`, token, 'DELETE'));
  check('DELETE is a real route', !routeMissing(del), 'status ' + del.status);
  const list2 = await rest('/api/safety/contacts', token);
  const gone = !(list2.json?.contacts || []).some((c) => String(c.id) === String(contactId));
  check('deleted contact is gone from GET', gone, JSON.stringify(list2.json?.contacts || []).slice(0, 160));
}

// ── SOS / share (a fake ride id proves the route without paging anyone) ──────
log('');
log('=== SOS + TRIP SHARING (fake rideId: the route must still answer) ===');
const sos = row('POST   /api/safety/sos', await rest('/api/safety/sos', token, 'POST', { rideId: 'probe-nonexistent' }));
check('SOS route exists (not Express-404)', !routeMissing(sos), 'status ' + sos.status);
const share = row('POST   /api/safety/share', await rest('/api/safety/share', token, 'POST', { rideId: 'probe-nonexistent' }));
check('share route exists', !routeMissing(share), 'status ' + share.status);
const shareStop = row('POST   /api/safety/share/stop', await rest('/api/safety/share/stop', token, 'POST', { rideId: 'probe-nonexistent' }));
check('share/stop route exists', !routeMissing(shareStop), 'status ' + shareStop.status);

// ── Split fare ───────────────────────────────────────────────────────────────
log('');
log('=== SPLIT FARE ===');
const pending = row('GET    /api/split/pending', await rest('/api/split/pending', token));
check('pending splits shape is { splits: [] }', Array.isArray(pending.json?.splits),
  'keys: ' + Object.keys(pending.json || {}).join(','));
const invite = row('POST   /api/split/invite', await rest('/api/split/invite', token, 'POST',
  { rideId: 'probe-nonexistent', inviteeEmail: 'probe-friend@vura-test.dev', amount: 15 }));
check('split invite route exists', !routeMissing(invite), 'status ' + invite.status);

// ── Disputes (Report an Issue) ───────────────────────────────────────────────
log('');
log('=== DISPUTES ===');
const disputes0 = row('GET    /api/disputes', await rest('/api/disputes', token));
check('disputes list shape is { disputes: [] }', Array.isArray(disputes0.json?.disputes),
  'keys: ' + Object.keys(disputes0.json || {}).join(','));
const noRide = row('POST   /api/disputes (no rideId)', await rest('/api/disputes', token, 'POST',
  { type: 'other', reason: 'probe', description: 'probe only: no ride' }));
check('POST /api/disputes is a real route (rideId required or not)',
  !routeMissing(noRide), 'status ' + noRide.status);
const withRide = row('POST   /api/disputes (fake rideId)', await rest('/api/disputes', token, 'POST',
  { rideId: 'probe-nonexistent', type: 'other', reason: 'probe', description: 'probe only' }));
check('POST /api/disputes accepts the legacy body', !routeMissing(withRide), 'status ' + withRide.status);
row('GET    /api/disputes/lost-items', await rest('/api/disputes/lost-items', token));
row('POST   /api/disputes/lost-item', await rest('/api/disputes/lost-item', token, 'POST',
  { rideId: 'probe-nonexistent', itemName: 'probe', itemDescription: 'probe only' }));

// ── Tips + ratings (receipt screen) ──────────────────────────────────────────
log('');
log('=== TIPS / RATINGS (fake rideId) ===');
const tip = row('POST   /api/tips (rideId + amount)', await rest('/api/tips', token, 'POST', { rideId: 'probe-nonexistent', amount: 10 }));
check('tips route exists', !routeMissing(tip), 'status ' + tip.status);
const tipCard = row('POST   /api/tips (with paymentMethodId)', await rest('/api/tips', token, 'POST',
  { rideId: 'probe-nonexistent', amount: 10, paymentMethodId: 'probe-card' }));
check('tips accepts paymentMethodId (the receipt passes it for cash rides)',
  !routeMissing(tipCard), 'status ' + tipCard.status);
const rating = row('POST   /api/ratings', await rest('/api/ratings', token, 'POST', { rideId: 'probe-nonexistent', score: 5 }));
check('ratings route exists', !routeMissing(rating), 'status ' + rating.status);

// ── Scheduled rides: the whole lifecycle the new screen performs ─────────────
log('');
log('=== SCHEDULED RIDES: create -> list -> cancel -> gone ===');
const sched0 = row('GET    /api/rides/scheduled', await rest('/api/rides/scheduled', token));
check('scheduled list shape is { rides: [] }', Array.isArray(sched0.json?.rides),
  'keys: ' + Object.keys(sched0.json || {}).join(','));

const scheduledAt = new Date(Date.now() + 3 * 3600e3).toISOString();
const made = row('POST   /api/rides/schedule', await rest('/api/rides/schedule', token, 'POST', {
  pickupAddress: 'Durban CBD, KwaZulu-Natal',
  pickupLat: -29.8587, pickupLng: 31.0218,
  destinationAddress: 'Umhlanga Rocks, KwaZulu-Natal',
  destinationLat: -29.7284, destinationLng: 31.0878,
  scheduledAt, tier: 'go',
}));
const schedId = made.json?.ride?.id ?? made.json?.id ?? made.json?.rideId ?? null;
check('schedule returns the new ride id', !!schedId, String(schedId));

if (schedId) {
  await sleep(600);
  const sched1 = await rest('/api/rides/scheduled', token);
  const mine = (sched1.json?.rides || []).find((r) => String(r.id) === String(schedId));
  check('new scheduled ride is listed by GET /api/rides/scheduled', !!mine,
    mine ? `status=${mine.status} at=${mine.scheduled_at ?? mine.scheduledAt}` : 'not found');
  if (mine) {
    log('        row keys: ' + Object.keys(mine).join(','));
    check('listed row carries the pickup address', !!(mine.pickup_address || mine.pickupAddress),
      String(mine.pickup_address || mine.pickupAddress || ''));
    check('listed row carries the drop-off address', !!(mine.destination_address || mine.destinationAddress),
      String(mine.destination_address || mine.destinationAddress || ''));
  }

  const cancel = row('POST   /api/rides/scheduled/{id}/cancel', await rest(`/api/rides/scheduled/${schedId}/cancel`, token, 'POST'));
  check('cancel is a real route', !routeMissing(cancel), 'status ' + cancel.status);
  await sleep(600);
  const sched2 = await rest('/api/rides/scheduled', token);
  const still = (sched2.json?.rides || []).some((r) => String(r.id) === String(schedId));
  check('cancelled ride disappears from the scheduled list', !still,
    JSON.stringify((sched2.json?.rides || []).map((r) => r.id)).slice(0, 120));
}

log('');
log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
log('probe rider left behind (not deleted): ' + EMAIL);
process.exit(failures === 0 ? 0 : 1);

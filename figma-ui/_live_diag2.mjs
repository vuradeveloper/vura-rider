// Deeper live diagnosis: the newest dispatch events, every recent offer, and the
// real-time status of every driver row (who can actually receive a ride right now).
const API = 'https://api.ridevura.com';
const READ = '351d6e8d4be23114e219f579a19de045';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';

const log = (...a) => console.log(...a);

const d = await fetch(`${API}/api/dev/dispatch?key=${READ}&limit=25`).then((r) => r.json());
log('serverTime:', d.serverTime);
log('config:', JSON.stringify(d.config));

log('\n=== DRIVERS (status · online · seconds since we heard from them) ===');
for (const dr of d.drivers || []) {
  log(`  ${String(dr.status).padEnd(10)} online=${String(dr.is_online).padEnd(5)} seen=${String(dr.seconds_since_seen).padStart(5)}s  ${dr.full_name || dr.id}  ${dr.id}`);
}

log('\n=== LATEST DISPATCH EVENTS (newest first) ===');
for (const e of (d.events || []).slice(0, 18)) {
  log(`  ${String(e.created_at).slice(11, 19)}  ${String(e.event).padEnd(28)} ride=${e.ride_id} driver=${e.driver_id || '-'} ${e.detail ? JSON.stringify(e.detail) : ''}`);
}

log('\n=== LATEST OFFERS ===');
for (const o of (d.offers || []).slice(0, 10)) {
  log(`  ${String(o.created_at).slice(11, 19)}  ${String(o.status).padEnd(9)} round=${o.round} ride=${o.ride_id} driver=${o.driver_name || o.driver_id} ${o.decline_reason ? 'reason=' + o.decline_reason : ''}`);
}

// Is the rider's live ride still 'searching' (visible to the driver poll) or parked?
const su = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${KEY}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: process.argv[2] || '', password: 'FlowTest123!', returnSecureToken: true }),
}).then((r) => r.json()).catch(() => ({}));

if (su?.idToken) {
  const avail = await fetch(`${API}/api/rides/available`, {
    headers: { Authorization: 'Bearer ' + su.idToken },
  }).then((r) => r.json()).catch(() => ({}));
  log(`\n=== GET /api/rides/available (as test driver): ${avail.rides?.length ?? 'ERR'} ride(s) visible`);
  for (const r of avail.rides || []) {
    log(`  ${r.status}  ${r.id}  created=${r.created_at}  ${r.pickup_address} -> ${r.destination_address}`);
  }
} else {
  log('\n(no test-driver token supplied, skipping /rides/available)');
}

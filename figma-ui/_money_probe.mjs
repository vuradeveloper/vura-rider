// Money diagnostic: why does the driver's earned balance read R0?
// Signs in as the driver and prints every money-ish endpoint + the raw rides
// that feed them. Read-only.
// Usage: node _money_probe.mjs [driverEmail] [driverPassword]
import fs from 'fs';

const API = 'https://api.ridevura.com';
const FIREBASE_KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const EMAIL = process.argv[2] || 'makhavhuju@gmail.com';
const PASS = process.argv[3] || 'Makhavhu@77';

const out = [];
const log = (m = '') => { out.push(String(m)); console.log(String(m)); };

const signIn = async (email, password) => {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.idToken) throw new Error('signin: ' + JSON.stringify(j).slice(0, 200));
  return j.idToken;
};

const probe = async (path, token, method = 'GET') => {
  try {
    const r = await fetch(API + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}) },
      body: method === 'GET' ? undefined : '{}',
    });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch {}
    log(`  ${method} ${path} -> HTTP ${r.status}`);
    log('    ' + (j ? JSON.stringify(j) : t.slice(0, 300)).slice(0, 700));
    return j;
  } catch (e) {
    log(`  ${method} ${path} -> ERR ${e.message}`);
    return null;
  }
};

log('==================================================');
log(' MONEY DIAGNOSTIC  ' + new Date().toISOString());
log('==================================================');
const token = await signIn(EMAIL, PASS);
log(`signed in: ${EMAIL}`);
log('');

log('--- whose row is this? (role decides which screens work) ---');
const sync = await probe('/api/users/sync', token, 'POST');
if (sync) {
  log('');
  log('   role          : ' + JSON.stringify(sync.role));
  log('   user.id       : ' + JSON.stringify(sync.id));
  log('   has_profile   : ' + JSON.stringify(sync.has_profile));
  log('   full_name     : ' + JSON.stringify(sync.full_name));
}
log('');

log('--- every money endpoint the apps call ---');
for (const p of [
  '/api/drivers/stats',
  '/api/drivers/profile',
  '/api/drivers/me',
  '/api/earnings?period=week',
  '/api/earnings?period=month',
  '/api/earnings?period=all',
  '/api/payments/driver/earnings/pending',
  '/api/payouts/banking',
  '/api/rides/history?limit=20',
]) await probe(p, token);
log('');

log('--- the rides that feed those numbers ---');
const hist = await probe('/api/rides/history?limit=50', token);
const rows = Array.isArray(hist) ? hist : (hist?.rides || hist?.data || []);
if (Array.isArray(rows)) {
  log(`  ${rows.length} ride row(s)`);
  const byStatus = {};
  const byPay = {};
  let sumCompleted = 0, sumCardCompleted = 0, sumCashCompleted = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    const pm = String(r.payment_method || '(none)').toLowerCase();
    byPay[pm] = (byPay[pm] || 0) + 1;
    if (r.status === 'completed') {
      const fare = Number(r.actual_fare ?? r.estimated_fare ?? 0);
      sumCompleted += fare;
      if (pm === 'card') sumCardCompleted += fare;
      if (pm === 'cash') sumCashCompleted += fare;
    }
  }
  log('  by status        : ' + JSON.stringify(byStatus));
  log('  by payment_method: ' + JSON.stringify(byPay));
  log(`  completed total  : R${sumCompleted.toFixed(2)}`);
  log(`  completed by CARD: R${sumCardCompleted.toFixed(2)}   <-- what the wallet/withdraw must show`);
  log(`  completed by CASH: R${sumCashCompleted.toFixed(2)}   <-- correctly excluded`);
  log('');
  log('  per-ride:');
  for (const r of rows.slice(0, 15)) {
    log(`    ${String(r.status).padEnd(16)} pm=${String(r.payment_method || '-').padEnd(5)} est=${String(r.estimated_fare ?? '-').padStart(6)} act=${String(r.actual_fare ?? '-').padStart(6)}  ${String(r.created_at || '').slice(0, 16)}  ${String(r.pickup_address || '').slice(0, 26)}`);
  }
}
log('');

fs.writeFileSync('C:/Users/mbofh/_money_probe.txt', out.join('\n'), 'utf8');

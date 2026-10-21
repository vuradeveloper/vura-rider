// Live audit: vehicle_images rows, driver money, and what the rider would actually receive.
// Read-only. Usage: node _live_audit.mjs
const API = 'https://api.ridevura.com';
const FIREBASE_KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'Time2rollB@100';
const basic = 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');

const out = [];
const log = (m = '') => { out.push(m); console.log(m); };

async function firebaseSignIn(email, password) {
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const j = await r.json();
  if (!j.idToken) throw new Error('signin failed: ' + JSON.stringify(j).slice(0, 300));
  return j.idToken;
}

async function api(path, token, opts = {}) {
  const r = await fetch(API + path, {
    method: opts.method || 'GET',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: r.status, text, json };
}

// ---------- 1. vehicle_images rows ----------
log('================ 1. vehicle_images ROWS (admin page) ================');
const page = await fetch(`${API}/api/admin/vehicle-images`, { headers: { Authorization: basic } });
const html = await page.text();
log(`admin page HTTP ${page.status}, ${html.length} bytes`);

const rowBlocks = html.split('<section class="row">').slice(1);
log(`rows found: ${rowBlocks.length}`);
for (const blk of rowBlocks) {
  const title = /<h3>(.*?)<\/h3>/s.exec(blk);
  const status = /<span class="pill">(.*?)<\/span>/s.exec(title?.[1] || '');
  const key = /<b>cache_key<\/b>\s*([^<]+)/.exec(blk);
  const stored = /<b>stored copy<\/b>\s*([^\s<]+)/.exec(blk);
  const srcPage = /<b>source page<\/b>\s*<a[^>]*href="([^"]+)"/.exec(blk);
  const calls = /calls<\/b>\s*(\d+)/.exec(blk);
  const imgs = [...blk.matchAll(/<img src="([^"]+)"/g)].map(m => m[1]);
  log('');
  log(`  key      : ${(key?.[1] || '?').trim()}`);
  log(`  status   : ${(status?.[1] || '?').trim()}`);
  log(`  calls    : ${calls?.[1] || '?'}`);
  log(`  stored   : ${(stored?.[1] || '(none)').trim()}`);
  log(`  sourcePg : ${(srcPage?.[1] || '(none)').slice(0, 90)}`);
  log(`  previews : ${imgs.length}`);
  const uniq = [...new Set(imgs)];
  for (const u of uniq.slice(0, 5)) {
    const abs = u.startsWith('http') ? u : API + u;
    try {
      const h = await fetch(abs, { method: 'HEAD' });
      log(`      ${h.status} ${h.headers.get('content-type')} ${h.headers.get('content-length')}B  ${abs.replace(API, '')}`);
    } catch (e) { log(`      ERR ${abs.replace(API, '')} ${e.message}`); }
  }
}

// ---------- 2. CarsXE usage panel ----------
log('');
log('================ 2. CarsXE calls (from page text) ================');
const usem = /CarsXE calls used: (\d+) \/ (\d+)/.exec(html);
if (usem) log(`  used ${usem[1]} / ${usem[2]}`);
const panelIdx = html.indexOf('Recent CarsXE calls');
if (panelIdx >= 0) {
  const panel = html.slice(panelIdx, panelIdx + 4000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  log('  ' + panel.slice(0, 1200));
}

// ---------- 3. driver money ----------
log('');
log('================ 3. DRIVER MONEY (per-driver, by primary key) ================');
const DRIVER_EMAIL = process.argv[2] || 'makhavhuju@gmail.com';
const DRIVER_PASS = process.argv[3] || 'Makhavhu@77';
let dtoken = null;
try {
  dtoken = await firebaseSignIn(DRIVER_EMAIL, DRIVER_PASS);
  log(`  signed in as ${DRIVER_EMAIL}`);
} catch (e) {
  log(`  sign-in FAILED: ${e.message}`);
}

if (dtoken) {
  for (const p of ['/api/wallet', '/api/drivers/stats', '/api/payments/driver/earnings/pending', '/api/payouts/available', '/api/earnings?period=week']) {
    const r = await api(p, dtoken);
    log('');
    log(`  ${p} -> HTTP ${r.status}`);
    if (r.json) {
      log('    ' + JSON.stringify(r.json).slice(0, 700));
    } else {
      log('    (non-JSON) ' + r.text.slice(0, 200));
    }
  }
}

// ---------- 4. what a rider would receive ----------
log('');
log('================ 4. RIDER PAYLOAD: vehicle_image_url ================');
const RIDER_EMAIL = process.argv[4];
const RIDER_PASS = process.argv[5];
if (RIDER_EMAIL && RIDER_PASS) {
  try {
    const rtoken = await firebaseSignIn(RIDER_EMAIL, RIDER_PASS);
    const r = await api('/api/rides/me/active-state', rtoken);
    log(`  /me/active-state -> HTTP ${r.status}`);
    log('    ' + JSON.stringify(r.json).slice(0, 900));
  } catch (e) { log('  rider sign-in failed: ' + e.message); }
} else {
  log('  (skipped - pass rider email+password as args 4 and 5)');
}

import('fs').then(fs => fs.writeFileSync('C:/Users/mbofh/_live_audit.txt', out.join('\n'), 'utf8'));

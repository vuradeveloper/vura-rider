// Live probe: does pressing "Save Vehicle" really cause the photo to be pulled?
//
//   node _save_live.mjs [make] [model] [year] [colour]
//
// Mints a throwaway driver, sends EXACTLY the PATCH the app's Save Vehicle button
// sends, then watches the review page (the database truth) and times every step.
// That answers "is the button too quick for the classification?" with numbers.
//
// Costs ONE CarsXE call (the worker fetches the new key). Everything is reported,
// nothing is approved.
const API = 'https://api.ridevura.com';
const KEY = 'AIzaSyC3lSrWd0JHWS8FzyaW9h8GgQyzNK3sC3Q';
const IDENTITY = 'https://identitytoolkit.googleapis.com/v1/accounts';
const PASSWORD = 'FlowTest123!';
const ADMIN = 'Basic ' + Buffer.from('admin:Time2rollB@100').toString('base64');

const [make = 'Kia', model = 'Picanto', year = '2017', colour = 'red'] = process.argv.slice(2);
const t0 = Date.now();
const stamp = (m) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One row per <section class="row">: cache_key, status, candidate count, notes. */
async function readRows() {
  const page = await (await fetch(API + '/api/admin/vehicle-images', { headers: { Authorization: ADMIN } })).text();
  return page
    .split('<section class="row">')
    .slice(1)
    .map((chunk) => {
      const head = chunk.match(/<h3>([\s\S]*?)<span class="pill">([a-z_]+)<\/span>/);
      const key = chunk.match(/cache_key<\/b>\s*([^<]+)/);
      const notes = [...chunk.matchAll(/white border (\d+)%/g)].map((m) => Number(m[1]));
      return {
        status: head ? head[2] : '?',
        cacheKey: key ? key[1].trim() : '?',
        candidates: (chunk.match(/class="cand"/g) || []).length,
        borders: notes,
      };
    });
}

const email = `save-probe-${Date.now()}@vura-test.dev`;
const su = await fetch(`${IDENTITY}:signUp?key=${KEY}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
});
const sj = await su.json();
if (!sj.idToken) { console.log('sign-up failed: ' + JSON.stringify(sj).slice(0, 200)); process.exit(2); }
await fetch(API + '/api/users/sync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sj.idToken },
  body: JSON.stringify({ token: sj.idToken, role: 'driver', full_name: 'Save Probe Driver', phone: '+27820000051' }),
});
stamp(`driver minted: ${email}`);

// ---- THE SAVE: byte-for-byte what the app's Save Vehicle button sends ----
const tSave = Date.now();
const res = await fetch(API + '/api/drivers/profile', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sj.idToken },
  body: JSON.stringify({ vehicle_make: make, vehicle_model: model, vehicle_year: Number(year), vehicle_color: colour }),
});
const text = await res.text();
stamp(`PATCH /api/drivers/profile -> HTTP ${res.status} after ${Date.now() - tSave}ms`);
console.log('    body: ' + text.slice(0, 240));

console.log(`\nwatching for the "${make}|${model}|" row (a queued key is fetched on the worker tick, <=30s)...`);
const rowKey = `${make}|${model}|`.toLowerCase();
const seen = new Set();
for (let i = 1; i <= 15; i++) {
  await sleep(8000);
  const rows = await readRows();
  const row = rows.find((r) => r.cacheKey !== '?' && r.cacheKey.toLowerCase().startsWith(rowKey));
  if (!row) { if (!seen.has('none')) { seen.add('none'); stamp('no row yet'); } continue; }
  const line = `row="${row.cacheKey}" status=${row.status} candidates=${row.candidates} whiteBorder=${row.borders.join(',') || 'n/a'}`;
  if (!seen.has(line)) { seen.add(line); stamp(line); }
  if (row.status === 'pending' || row.status === 'approved' || row.status === 'none_found') {
    stamp(`row settled as ${row.status} after ${((Date.now() - t0) / 1000).toFixed(1)}s from the button press`);
    break;
  }
}
console.log('\nIf a row appeared with pending candidates, the answer is: yes, Save does pull -');
console.log('but it lands ' + 'AFTER the app has already drawn the SVG, and it waits for approval.');
process.exit(0);

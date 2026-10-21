// Live test: trigger the Picanto re-fetch on the SERVER and watch the row.
// This is the "press Save Vehicle and see if it really pulls" test.
// Costs 1 CarsXE credit.
const API = 'https://api.ridevura.com';
const AUTH = 'Basic ' + Buffer.from('admin:Time2rollB@100').toString('base64');
const CACHE_KEY = process.argv[2] || 'kia|picanto|2017-2020|red';

const out = [];
const log = (m = '') => { out.push(String(m)); console.log(String(m)); };

const admin = async (path, opts = {}) => {
  const r = await fetch(API + path, {
    ...opts,
    headers: { Authorization: AUTH, ...(opts.headers || {}) },
    signal: AbortSignal.timeout(180000),
  });
  const t = await r.text();
  return { status: r.status, text: t };
};

// --- find the row id from the admin page ---
log('=== locating the row ===');
const page = await admin('/api/admin/vehicle-images');
const blocks = page.text.split('<section class="row">').slice(1);
let rowId = null, rowStatus = null;
for (const blk of blocks) {
  const key = /<b>cache_key<\/b>\s*([^<]+)/.exec(blk);
  if (!key || key[1].trim() !== CACHE_KEY) continue;
  const status = /<span class="pill">(.*?)<\/span>/.exec(blk);
  const id = /\/api\/admin\/vehicle-images\/([0-9a-f-]{36})\/(approve|reject)/.exec(blk);
  const refresh = /\/api\/admin\/vehicle-images\/([0-9a-f-]{36})\/refetch/.exec(blk);
  rowId = refresh?.[1] || id?.[1] || null;
  rowStatus = status?.[1]?.trim();
  log(`  key=${CACHE_KEY}  status=${rowStatus}  id=${rowId || '(no id in page)'}`);
}
if (!rowId) {
  log('  could not find the row id - dumping the refetch form actions present:');
  for (const m of page.text.matchAll(/action="([^"]*refetch[^"]*)"/g)) log('    ' + m[1]);
}

// --- usage before ---
const before = /CarsXE calls used: (\d+) \/ (\d+)/.exec(page.text);
log(`  credits before: ${before?.[1]}/${before?.[2]}`);

if (rowId) {
  log('');
  log('=== POST refetch (this runs the whole pipeline server-side) ===');
  const t0 = Date.now();
  const res = await admin(`/api/admin/vehicle-images/${rowId}/refetch`, { method: 'POST' });
  log(`  HTTP ${res.status}  after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  log('  body: ' + res.text.slice(0, 500).replace(/\s+/g, ' '));

  // --- read the row back ---
  log('');
  log('=== the row AFTER the refetch ===');
  const page2 = await admin('/api/admin/vehicle-images');
  const blocks2 = page2.text.split('<section class="row">').slice(1);
  for (const blk of blocks2) {
    const key = /<b>cache_key<\/b>\s*([^<]+)/.exec(blk);
    if (!key || key[1].trim() !== CACHE_KEY) continue;
    const status = /<span class="pill">(.*?)<\/span>/.exec(blk);
    const stored = /<b>stored copy<\/b>\s*([^\s<]+)/.exec(blk);
    const calls = /calls<\/b>\s*(\d+)/.exec(blk);
    const imgs = [...blk.matchAll(/<img src="([^"]+)"/g)].map(m => m[1]);
    log(`  status : ${status?.[1]?.trim()}`);
    log(`  calls  : ${calls?.[1]}`);
    log(`  stored : ${(stored?.[1] || '(none)').trim()}`);
    log(`  previews: ${[...new Set(imgs)].length}`);
    const cands = [...blk.matchAll(/<figcaption>([^<]*)<br><span class="note">([^<]*)<\/span>/g)];
    for (const c of cands) log(`      ${c[1].trim()}  ->  ${c[2].trim()}`);
  }
  const after = /CarsXE calls used: (\d+) \/ (\d+)/.exec(page2.text);
  log('');
  log(`  credits after: ${after?.[1]}/${after?.[2]}`);

  // --- newest usage rows ---
  const idx = page2.text.indexOf('Recent CarsXE calls');
  if (idx >= 0) {
    const panel = page2.text.slice(idx, idx + 2200).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    log('');
    log('=== newest CarsXE calls ===');
    log('  ' + panel.slice(panel.indexOf('when (UTC)') + 10, panel.indexOf('when (UTC)') + 700));
  }
}

import('fs').then(fs => fs.writeFileSync('C:/Users/mbofh/_refetch_live.txt', out.join('\n'), 'utf8'));

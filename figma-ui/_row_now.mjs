// Read the Picanto row + usage NOW (no refetch, no credits). Poll-safe.
const API = 'https://api.ridevura.com';
const AUTH = 'Basic ' + Buffer.from('admin:Time2rollB@100').toString('base64');
const KEY = process.argv[2] || 'kia|picanto|2017-2020|red';

const r = await fetch(`${API}/api/admin/vehicle-images`, { headers: { Authorization: AUTH }, signal: AbortSignal.timeout(60000) });
const html = await r.text();
const out = [];
const log = (m = '') => { out.push(String(m)); console.log(String(m)); };

log(`admin page HTTP ${r.status} at ${new Date().toISOString()}`);
const used = /CarsXE calls used: (\d+) \/ (\d+)/.exec(html);
log(`credits used: ${used?.[1]}/${used?.[2]}`);

log('');
log('=== all rows ===');
for (const blk of html.split('<section class="row">').slice(1)) {
  const key = /<b>cache_key<\/b>\s*([^<]+)/.exec(blk);
  const status = /<span class="pill">(.*?)<\/span>/.exec(blk);
  const stored = /<b>stored copy<\/b>\s*([^\s<]+)/.exec(blk);
  const calls = /calls<\/b>\s*(\d+)/.exec(blk);
  const size = /<b>size<\/b>\s*([^<]*)</.exec(blk);
  const imgs = [...new Set([...blk.matchAll(/<img src="([^"]+)"/g)].map(m => m[1]))];
  log(`  [${(key?.[1] || '?').trim()}]  status=${(status?.[1] || '?').trim()}  calls=${calls?.[1] || '?'}  previews=${imgs.length}`);
  if (stored) log(`      stored: ${stored[1].trim()}`);
  if (size) log(`      size  : ${size[1].trim()}`);
  const cands = [...blk.matchAll(/<figcaption>([^<]*)<br><span class="note">([^<]*)<\/span>/g)];
  for (const c of cands) log(`        cand ${c[1].trim()}  ->  ${c[2].trim()}`);
}

const idx = html.indexOf('Recent CarsXE calls');
if (idx >= 0) {
  const panel = html.slice(idx, idx + 2600).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const s = panel.indexOf('when (UTC)');
  log('');
  log('=== newest CarsXE calls ===');
  log('  ' + panel.slice(s + 10, s + 800));
}

import('fs').then(fs => fs.writeFileSync('C:/Users/mbofh/_row_now.txt', out.join('\n'), 'utf8'));

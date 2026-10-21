// Does processVehicleImage survive the REAL Picanto downloads?
// Downloads the exact netcarshow 4096x3072 JPEGs the live fetch got, then runs
// the compiled production function on each. No CarsXE call.
import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const V = require('C:/Users/mbofh/2026-PROJECTS/New Boomnut/vura-rider/server/dist/services/vehicleImages.js');

const URLS = [
  ['4608x3456 rear three-quarter', 'https://www.netcarshow.com/Kia-Picanto-2017-Rear_Three-Quarter.d8f878b8.jpg'],
  ['4096x3072 side profile', 'https://www.netcarshow.com/Kia-Picanto-2017-Side_Profile.d8f878b8.jpg'],
  ['4096x3072 front', 'https://www.netcarshow.com/Kia-Picanto-2017-Front.d8f878b8.jpg'],
];

const out = [];
const log = (m = '') => { out.push(String(m)); console.log(String(m)); };

log('=== processVehicleImage against the real Picanto downloads ===');
log('');
for (const [label, url] of URLS) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) { log(`  ${label}: download HTTP ${res.status} - skipping`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const t0 = Date.now();
    try {
      const webp = await V.processVehicleImage(buf);
      log(`  OK    ${label.padEnd(28)} ${buf.length}B in -> ${webp.length}B webp  (${Date.now() - t0}ms)`);
    } catch (e) {
      log(`  FAIL  ${label.padEnd(28)} ${buf.length}B in -> ${e.message}`);
      log(`        ^^^ THIS is why the row ends up none_found if all candidates fail here`);
    }
  } catch (e) {
    log(`  ERR   ${label}: ${e.message}`);
  }
}
log('');
log('=== also test measureStudioBackground on the same bytes (the earlier step) ===');
for (const [label, url] of URLS.slice(0, 1)) {
  try {
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    const bg = await V.measureStudioBackground(buf);
    log(`  OK    ${label} border=${(bg.borderWhite * 100).toFixed(0)}% corners=${(bg.corners * 100).toFixed(0)}%`);
  } catch (e) { log(`  FAIL  ${label}: ${e.message}`); }
}

fs.writeFileSync('C:/Users/mbofh/_proc_test.txt', out.join('\n'), 'utf8');

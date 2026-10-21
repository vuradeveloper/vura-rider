// Runs the REAL pipeline functions (compiled dist) against the real CarsXE
// results for a car, step by step, to find which step produces an empty result.
// Usage: node _pipe_probe.mjs [make] [model] [year] [colour]
import { createRequire } from 'module';
import fs from 'fs';

const require = createRequire(import.meta.url);
const KEY = process.env.CARSXE_API_KEY || 'komzunhdr_b5slhr3qy_pxfvik0ip';
const [make, model, year, colour] = [
  process.argv[2] || 'kia',
  process.argv[3] || 'picanto',
  process.argv[4] || '2017',
  process.argv[5] || 'red',
];

const dist = 'C:/Users/mbofh/2026-PROJECTS/New Boomnut/vura-rider/server/dist/services/vehicleImages.js';
const V = require(dist);

const out = [];
const log = (m = '') => { out.push(String(m)); console.log(String(m)); };

log('=== exports found ===');
log('  ' + Object.keys(V).join(', '));
log('');

const qs = new URLSearchParams({ key: KEY, make, model, year, color: colour });
const res = await fetch(`https://api.carsxe.com/images?${qs}`);
const body = await res.json().catch(() => null);
const images = Array.isArray(body?.images) ? body.images : [];
log(`=== search: ${make} ${model} ${year} ${colour} -> HTTP ${res.status}, ${images.length} images ===`);

// STEP 1: score
const scored = V.scoreCandidates(images);
log('');
log('=== STEP 1: scoreCandidates ===');
for (const s of scored) log(`  score=${String(s.score).padStart(3)}  ${String(s.width)}x${s.height}  ${s.note}  | ${String(s.link).slice(0, 66)}`);
if (!scored.length) log('  >>> EMPTY at scoreCandidates');

// STEP 2: download + measure (same order as the server)
const MEASURE = 6;
const examined = scored.slice(0, MEASURE);
log('');
log(`=== STEP 2: download + measureStudioBackground (top ${examined.length}) ===`);
const measured = [];
for (const pick of examined) {
  try {
    const buf = await V.downloadImage(pick.link);
    const bg = await V.measureStudioBackground(buf);
    const bonus = V.studioBonus(bg);
    measured.push({ pick, bg, bonus });
    log(`  OK    ${String(pick.width)}x${pick.height}  border=${(bg.borderWhite * 100).toFixed(0)}% corners=${(bg.corners * 100).toFixed(0)}%  bonus=${bonus}  (${buf.length}B)`);
  } catch (e) {
    log(`  FAIL  ${String(pick.width)}x${pick.height}  ${e.message}`);
  }
}
log('');
log(`  measured: ${measured.length} of ${examined.length}`);
if (!measured.length) log('  >>> EMPTY at measure step -> server marks none_found HERE');

// STEP 3: process (key background, trim, canvas, webp)
log('');
log('=== STEP 3: processVehicleImage on the top pick ===');
const sorted = measured.slice().sort((a, b) =>
  (b.pick.score + b.bonus) - (a.pick.score + a.bonus) ||
  (Number(b.pick.width) || 0) - (Number(a.pick.width) || 0));
for (const [i, e] of sorted.entries()) {
  log(`  #${i + 1} total=${e.pick.score + e.bonus}  ${e.pick.width}x${e.pick.height}  border=${(e.bg.borderWhite * 100).toFixed(0)}%`);
}
if (sorted.length) {
  const top = sorted[0];
  try {
    const buf = await V.downloadImage(top.pick.link);
    const webp = await V.processVehicleImage(buf);
    log(`  processVehicleImage OK -> ${webp.length}B webp`);
  } catch (e) {
    log(`  processVehicleImage FAILED: ${e.message}`);
    log('  >>> if THIS fails, the fetch dies after the call was already paid for');
  }
}

fs.writeFileSync('C:/Users/mbofh/_pipe_probe.txt', out.join('\n'), 'utf8');

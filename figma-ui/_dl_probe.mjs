// Why does a CarsXE search that returned N images end up as 'none_found'?
// Runs the EXACT same lookup + download the server does, then retries with a
// browser User-Agent to see whether hotlink protection is the cause.
// Usage: node _dl_probe.mjs [make] [model] [year] [colour]
const KEY = process.env.CARSXE_API_KEY || 'komzunhdr_b5slhr3qy_pxfvik0ip';
const [make, model, year, colour] = [
  process.argv[2] || 'kia',
  process.argv[3] || 'picanto',
  process.argv[4] || '2017',
  process.argv[5] || 'red',
];

const out = [];
const log = (m = '') => { out.push(m); console.log(m); };

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

async function tryDownload(url, opts) {
  try {
    const res = await fetch(url, { redirect: 'follow', ...opts });
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) return { ok: false, why: `too small (${buf.length}B)` };
    return { ok: true, bytes: buf.length, ct: res.headers.get('content-type') };
  } catch (e) {
    return { ok: false, why: e.message.slice(0, 80) };
  }
}

const qs = new URLSearchParams({ key: KEY, make, model, year, color: colour });
const url = `https://api.carsxe.com/images?${qs.toString()}`;
log(`=== CarsXE search: ${make} ${model} ${year} ${colour} ===`);
const r = await fetch(url);
const body = await r.json().catch(() => null);
const images = Array.isArray(body?.images) ? body.images : [];
log(`HTTP ${r.status}  images=${images.length}`);
log('');

log('=== per-candidate download test (exactly as server does: no UA) ===');
let okPlain = 0;
let okUa = 0;
for (const [i, img] of images.entries()) {
  const plain = await tryDownload(img.link, {});
  const withUa = plain.ok ? null : await tryDownload(img.link, { headers: { 'User-Agent': UA } });
  if (plain.ok) okPlain++;
  if (plain.ok || withUa?.ok) okUa++;
  const host = (() => { try { return new URL(img.link).host; } catch { return '?'; } })();
  log(`  #${i + 1} ${String(img.mime || '?').padEnd(11)} ${String(img.width || '?') + 'x' + (img.height || '?')} ${String(img.byteSize || '?').padStart(8)}B  ${host}`);
  log(`      no-UA   : ${plain.ok ? 'OK ' + plain.bytes + 'B' : 'FAIL ' + plain.why}`);
  if (withUa) log(`      with-UA : ${withUa.ok ? 'OK ' + withUa.bytes + 'B' : 'FAIL ' + withUa.why}`);
  log(`      ctx     : ${String(img.contextLink || '').slice(0, 95)}`);
}
log('');
log(`=== VERDICT ===`);
log(`  downloadable without UA : ${okPlain}/${images.length}`);
log(`  downloadable with UA    : ${okUa}/${images.length}`);
if (okPlain === 0 && okUa > 0) log('  >>> ROOT CAUSE: hotlink protection. The server sends no User-Agent, so every download 403s and the row is marked none_found.');
else if (okUa === 0) log('  >>> Downloads fail even with a UA - the links themselves are dead/expired.');
else log('  >>> Downloads work - the failure is elsewhere (filter/score/processing).');

import('fs').then(fs => fs.writeFileSync('C:/Users/mbofh/_dl_probe.txt', out.join('\n'), 'utf8'));

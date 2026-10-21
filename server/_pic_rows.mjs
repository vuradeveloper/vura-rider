const A = 'Basic ' + Buffer.from('admin:Time2rollB@100').toString('base64');
const API = 'https://api.ridevura.com';
const r = await fetch(`${API}/api/admin/vehicle-images?status=approved`, { headers: { Authorization: A } });
const t = await r.text();
// find the status filter options offered
const opts = [...t.matchAll(/name="status"[^>]*>([^<]*)</g)].map(m=>m[1].trim());
console.log('status options in page:', [...new Set(opts)].join(' | '));
// split into row sections
const chunks = t.split('<section class="row">');
const pic = [];
for (const c of chunks) {
  const h3 = c.match(/<h3>([^<]*)<span class="pill">([^<]*)</);
  if (!h3) continue;
  const key = c.match(/<b>cache_key<\/b>\s*([^<]+)</);
  if (!key) continue;
  const id = c.match(/vehicle-images\/([0-9a-f-]{36})\/reject/);
  if (/picanto/i.test(key[1])) pic.push({ id: id?.[1], status: h3[2], key: key[1].trim(), name: h3[1].trim() });
}
console.log('PICANTO rows in approved list:', pic.length);
for (const p of pic) console.log('  ', JSON.stringify(p));

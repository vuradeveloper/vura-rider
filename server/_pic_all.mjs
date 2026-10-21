const A = 'Basic ' + Buffer.from('admin:Time2rollB@100').toString('base64');
const API = 'https://api.ridevura.com';
// no status filter => every row (cap 10000)
const r = await fetch(`${API}/api/admin/vehicle-images`, { headers: { Authorization: A } });
const t = await r.text();
const chunks = t.split('<section class="row">');
const pic = [];
const statuses = {};
for (const c of chunks) {
  const h3 = c.match(/<h3>([^<]*)<span class="pill">([^<]*)</);
  const key = c.match(/<b>cache_key<\/b>\s*([^<]+)</);
  if (!h3 || !key) continue;
  statuses[h3[2]] = (statuses[h3[2]]||0)+1;
  if (/picanto/i.test(key[1])) {
    const id = c.match(/vehicle-images\/([0-9a-f-]{36})\/reject/);
    pic.push({ id: id?.[1], status: h3[2], key: key[1].trim() });
  }
}
console.log('http', r.status, 'rows shown', chunks.length-1);
console.log('status counts:', JSON.stringify(statuses));
console.log('ALL PICANTO rows:', pic.length);
for (const p of pic) console.log('  ', p.status.padEnd(12), p.key, p.id);

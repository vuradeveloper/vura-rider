const A = 'Basic ' + Buffer.from('admin:Time2rollB@100').toString('base64');
const API = 'https://api.ridevura.com';
for (const status of ['approved', 'pending_review', 'pending']) {
  const r = await fetch(`${API}/api/admin/vehicle-images?status=${status}`, { headers: { Authorization: A } });
  const t = await r.text();
  const ids = [...t.matchAll(/\/api\/admin\/vehicle-images\/([0-9a-f-]{36})\/approve/g)].map(m => m[1]);
  const keys = [...t.matchAll(/cache_key<\/b>\s*([^<|]+)/g)].map(m => m[1].trim());
  console.log(`status=${status} http=${r.status} rows=${ids.length}`);
  const pic = keys.map((k, i) => [k, ids[i]]).filter(([k]) => /picanto/i.test(k));
  if (pic.length) console.log('   PICANTO:', JSON.stringify(pic));
  if (status === 'approved' && !pic.length) console.log('   (no picanto)');
}

const A = 'Basic ' + Buffer.from('admin:Time2rollB@100').toString('base64');
const r = await fetch('https://api.ridevura.com/api/admin/vehicle-images?status=approved', { headers: { Authorization: A } });
const t = await r.text();
const i = t.toLowerCase().indexOf('picanto');
console.log('picanto index:', i);
console.log('--- context ---');
console.log(t.slice(Math.max(0, i - 900), i + 500));

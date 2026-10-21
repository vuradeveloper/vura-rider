// Does the YEAR ever stop a car from resolving? Feed every library car through
// pickBestWhiteRow at extreme years and require a result every single time.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const vi = require('./dist/services/vehicleImages.js');

const USER = 'admin', PASS = 'Time2rollB@100';
const b64 = Buffer.from(USER + ':' + PASS).toString('base64');
const r = await fetch('https://api.ridevura.com/api/admin/vehicle-images?status=approved', {
  headers: { Authorization: 'Basic ' + b64 },
});
const t = await r.text();
const keys = [...new Set((t.match(/[a-z0-9-]+\|[a-z0-9.-]+\|[a-z0-9.-]+\|white/gi) || []))];

// Rebuild the rows the resolver would see.
const rows = keys.map((k) => {
  const [make, model, range] = k.split('|');
  return { cache_key: k, make, model, year: null, year_range: range, image_url: 'x', approved_at: '2026-10-01T00:00:00Z' };
});
const byMake = new Map();
for (const row of rows) {
  if (!byMake.has(row.make)) byMake.set(row.make, []);
  byMake.get(row.make).push(row);
}

const YEARS = [1990, 1998, 2005, 2011, 2015, 2018, 2019, 2022, 2026, 2035, 9999, null, undefined];
let pass = 0, fail = 0;
const failures = [];
for (const [make, list] of byMake) {
  for (const row of list) {
    for (const y of YEARS) {
      const pick = vi.pickBestWhiteRow(list, { model: row.model, year: y });
      if (pick && pick.row.image_url) pass++;
      else { fail++; if (failures.length < 8) failures.push({ make, model: row.model, year: y }); }
    }
  }
}
console.log('library cars  =', rows.length);
console.log('makes         =', byMake.size);
console.log('year variants =', YEARS.length);
console.log('resolved      =', pass);
console.log('failed        =', fail);
if (failures.length) console.log('examples:', JSON.stringify(failures));

// And a driver who types a GENERIC model ("Polo") against the real variant rows.
let generic = 0, genericFail = 0;
const genericQueries = [
  ['volkswagen', 'Polo'], ['toyota', 'Corolla'], ['suzuki', 'Swift'], ['mazda', '3'],
  ['bmw', '3-series'], ['hyundai', 'i10'], ['kia', 'Picanto'], ['ford', 'Fiesta'],
];
for (const [make, model] of genericQueries) {
  const list = byMake.get(make) || [];
  if (!list.length) continue;
  for (const y of YEARS) {
    generic++;
    if (!vi.pickBestWhiteRow(list, { model, year: y })) genericFail++;
  }
}
console.log('');
console.log('generic-model lookups =', generic, ' failed =', genericFail);
console.log(fail === 0 && genericFail === 0
  ? '\nRESULT: PASS - the year can never stop an image being served'
  : '\nRESULT: FAIL - some year/make combination finds nothing');

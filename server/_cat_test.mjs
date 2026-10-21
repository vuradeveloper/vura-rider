// Round-trip test: every DB model token must survive label -> normToken unchanged,
// and every pair the library offers must be present in the produced catalogue.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cat = require('./dist/data/vehicleCatalogue.js');
const vi = require('./dist/services/vehicleImages.js');

// The real tokens, read from the live admin page.
const USER = 'admin', PASS = 'Time2rollB@100';
const b64 = Buffer.from(USER + ':' + PASS).toString('base64');
const r = await fetch('https://api.ridevura.com/api/admin/vehicle-images?status=approved', {
  headers: { Authorization: 'Basic ' + b64 },
});
const t = await r.text();
const keys = [...new Set((t.match(/[a-z0-9-]+\|[a-z0-9.-]+\|[a-z0-9.-]+\|white/gi) || []))];
const pairs = keys.map((k) => ({ make: k.split('|')[0], model: k.split('|')[1] }));
console.log('live pairs       =', pairs.length);

const out = cat.catalogueForApi(pairs);
const makes = out.makes;
console.log('catalogue makes  =', makes.length);
console.log('catalogue models =', makes.reduce((n, m) => n + m.models.length, 0));

// 1. every live pair appears, and its label round-trips to the token
let missing = 0, badRoundTrip = 0;
const bad = [];
for (const p of pairs) {
  const mk = makes.find((m) => (vi.normToken(m.make) === vi.normToken(p.make)) || vi.normToken(m.make) === vi.normToken(cat.canonicalMake(p.make) || p.make));
  const entry = mk && mk.models.find((x) => vi.normToken(x.model) === p.model);
  if (!entry) { missing++; if (bad.length < 6) bad.push({ ...p, why: 'not in catalogue' }); continue; }
  const back = vi.normToken(entry.model);
  if (back !== p.model) { badRoundTrip++; if (bad.length < 6) bad.push({ ...p, label: entry.model, back, why: 'label does not round-trip' }); }
}
console.log('missing pairs    =', missing);
console.log('bad round-trips  =', badRoundTrip);
if (bad.length) console.log(JSON.stringify(bad, null, 1));

// 2. nothing extra that is NOT in the library
const libSet = new Set(pairs.map((p) => p.make + '|' + p.model));
let extra = 0;
for (const m of makes) {
  for (const e of m.models) {
    const tok = vi.normToken(e.model);
    const mkTok = vi.normToken(m.make);
    const canon = vi.normToken(cat.canonicalMake(mkTok) || mkTok);
    if (!libSet.has(mkTok + '|' + tok) && !libSet.has(canon + '|' + tok)) {
      extra++; if (extra < 6) console.log('  EXTRA:', m.make, '/', e.model);
    }
  }
}
console.log('extra (no image) =', extra);
console.log(missing === 0 && badRoundTrip === 0 && extra === 0 ? '\nRESULT: PASS - the dropdown is exactly the image library' : '\nRESULT: FAIL');

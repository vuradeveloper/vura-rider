// Generates the driver app's bundled FALLBACK_ROWS from the SAME source the server
// serves: the approved white image library. This keeps the offline list and the live
// endpoint from ever drifting - the driver cannot pick a car that has no photo.
//
//   node server/_gen_fallback.mjs > C:\Users\mbofh\_fallback_rows.txt
//   node server/_gen_fallback.mjs --check      # just report the un-catalogued cars
//
// --check is the important one: a library car the static catalogue does not know gets
// GUESSED body/ category (resolveBodyType falls back to hatchback => economy), so it is
// worth seeing how many those are before trusting the tier list.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cat = require('./dist/data/vehicleCatalogue.js');

const auth = 'Basic ' + Buffer.from('admin:Time2rollB@100').toString('base64');
const page = await (await fetch('https://api.ridevura.com/api/admin/vehicle-images?status=approved', { headers: { Authorization: auth } })).text();
const keys = [...new Set((page.match(/[a-z0-9-]+\|[a-z0-9.-]+\|[a-z0-9.-]+\|white/gi) || []))];
const pairs = keys.map((k) => ({ make: k.split('|')[0], model: k.split('|')[1] }));
const out = cat.catalogueForApi(pairs);

// A car the catalogue knows comes back with the catalogue's own body type and a real
// category; one it does not know falls back to hatchback/economy by construction.
//
// IMPORTANT: match on the RAW DB token ("3-series"), not the display label ("3 Series"),
// because the raw token is what the server stores on save and what findModel() sees.
// Checking labels over-reports (BR-V matches via "br-v" but not via "Br V").
const unknown = [];
let known = 0;
const seen = new Set();
for (const p of pairs) {
  const key = p.make + '|' + p.model;
  if (seen.has(key)) continue;
  seen.add(key);
  if (cat.findModel(p.make, p.model)) known++;
  else unknown.push(p.make + ' / ' + p.model);
}

if (process.argv.includes('--check')) {
  console.log('catalogue cars     =', out.makes.length, 'makes /', out.makes.reduce((n, m) => n + m.models.length, 0), 'models');
  console.log('distinct make|model=', seen.size);
  console.log('known to catalogue =', known);
  console.log('NOT in catalogue   =', unknown.length, '(body type and tier are GUESSED for these)');
  console.log('');
  for (const u of unknown) console.log('  ' + u);
  process.exit(0);
}

const lines = [];
for (const m of out.makes) {
  for (const x of m.models) lines.push(`  ['${m.make}', '${x.model}', '${x.body_type}'],`);
}
console.log(lines.join('\n'));
console.error('rows =', lines.length, ' makes =', out.makes.length, ' guessed =', unknown.length);
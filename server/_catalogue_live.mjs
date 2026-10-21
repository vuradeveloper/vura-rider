// Post-deploy check for the picker pruning (commit ad06243).
//
// BEFORE the deploy this endpoint serves the STATIC catalogue: 23 makes / 96 models
// (verified live on 2026-10-02), and most of those cars have no photo - picking one
// gave the rider an SVG.
// AFTER  the deploy it serves the IMAGE LIBRARY: 27 makes / 126 models, every one of
// which has an approved white photo.
//
// This does NOT hard-code those numbers: it derives the expectation from the library
// itself, so it cannot go stale as photos are added. It checks BOTH directions -
// nothing offered without a photo, and no photo left un-offered.
//
// Run it from anywhere:  node server/_catalogue_live.mjs
const API = 'https://api.ridevura.com';
// Same token rule the server applies on save (normToken): "Polo Vivo" -> polo-vivo.
const tok = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

// The library, straight from the admin page: <make>|<model>|<range>|white.
const auth = 'Basic ' + Buffer.from('admin:Time2rollB@100').toString('base64');
const page = await (await fetch(API + '/api/admin/vehicle-images?status=approved', { headers: { Authorization: auth } })).text();
const libKeys = [...new Set((page.match(/[a-z0-9-]+\|[a-z0-9.-]+\|[a-z0-9.-]+\|white/gi) || []))];
const libSet = new Set(libKeys.map((k) => k.split('|')[0] + '|' + k.split('|')[1]));
const libMakes = new Set(libKeys.map((k) => k.split('|')[0]));
const libModels = new Set(libKeys.map((k) => k.split('|')[1]));

// --local runs the LOCAL BUILD's catalogue against the same library, which proves the
// PASS path now instead of after the deploy. Same code, same comparison - the only
// difference is where the payload comes from.
const LOCAL = process.argv.includes('--local');
let j;
let source = 'live /api/drivers/vehicle-catalogue';
if (LOCAL) {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const cat = require('./dist/data/vehicleCatalogue.js');
  const pairs = libKeys.map((k) => ({ make: k.split('|')[0], model: k.split('|')[1] }));
  j = cat.catalogueForApi(pairs);
  source = 'local dist/ build (catalogueForApi with the library pairs)';
} else {
  j = await (await fetch(API + '/api/drivers/vehicle-catalogue')).json();
}

const makes = j.makes || [];
const modelCount = makes.reduce((n, m) => n + (m.models || []).length, 0);
const hasColours = Array.isArray(j.colours) && j.colours.length === 12;
const hasBodies = Array.isArray(j.body_types) && j.body_types.length === 5;

console.log('source        =', source);
console.log('makes         =', makes.length);
console.log('models        =', modelCount);
console.log('colours       =', (j.colours || []).length, hasColours ? '(ok)' : '(EXPECTED 12)');
console.log('body_types    =', (j.body_types || []).length, hasBodies ? '(ok)' : '(EXPECTED 5)');
console.log('first 3 makes =', makes.slice(0, 3).map((m) => m.make).join(', '));
console.log('VW models     =', (makes.find((m) => /volkswagen/i.test(m.make)) || {}).models?.map((x) => x.model).join(', ') || 'none');
console.log('library rows  =', libKeys.length, '(' + libMakes.size + ' makes / ' + libModels.size + ' models)');
console.log('');

if (!LOCAL && makes.length === 23 && modelCount === 96) {
  console.log('RESULT: NOT DEPLOYED YET - the static catalogue (23 makes / 96 models) is still live.');
  console.log('        Deploy with:  cd ~/vura-rider && unset AWS_REGION && bash deploy/deploy.sh');
  process.exit(0);
}

const offered = new Set();
for (const m of makes) for (const x of m.models || []) offered.add(tok(m.make) + '|' + tok(x.model));

const noPhoto = [...offered].filter((k) => !libSet.has(k));
const notShown = [...libSet].filter((k) => !offered.has(k));
console.log('offered WITHOUT a photo =', noPhoto.length, noPhoto.slice(0, 6).join('  '));
console.log('photos NOT offered      =', notShown.length, notShown.slice(0, 6).join('  '));
console.log('');
if (!noPhoto.length && !notShown.length && hasColours && hasBodies) {
  console.log('RESULT: PASS - the picker IS the image library.');
  console.log('        Every car a driver can pick has an approved photo, and every photo is reachable.');
} else {
  console.log('RESULT: FAIL - the picker and the library disagree. Investigate the lists above.');
}
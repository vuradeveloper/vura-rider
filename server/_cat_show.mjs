// Spot-check the shapes and tiers the catalogue resolves for a sample of cars - the
// ones added for the image library, plus a few that were already there.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const cat = require('./dist/data/vehicleCatalogue.js');

const cases = [
  ['toyota', 'hiace'], ['toyota', 'hiace-quantum'], ['toyota', 'quantum'], ['toyota', 'corolla-cross'],
  ['toyota', 'rav4'], ['toyota', 'innova'], ['bmw', '3-series'], ['bmw', '5-series'],
  ['mercedes-benz', 'c-class'], ['mercedes-benz', 's-class'], ['volkswagen', 'polo-vivo'],
  ['volkswagen', 'golf-mk7'], ['tesla', 'model-y'], ['nissan', 'serena'], ['nissan', 'nv200'],
  ['nissan', 'navara'], ['isuzu', 'd-max'], ['gwm', 'ora-07'], ['bajaj', 'qute'],
  ['mazda', '3'], ['mazda', 'cx-3'], ['mazda', '2-hatch'], ['honda', 'br-v'],
  ['chevrolet', 'spin'], ['maxus', 'g10'], ['mg', 'zs-ev'], ['audi', 'q5'], ['byd', 'atto-3'],
];

console.log('make/model'.padEnd(30), 'body'.padEnd(11), 'tier');
console.log('-'.repeat(50));
for (const [make, model] of cases) {
  const body = cat.resolveBodyType(make, model);
  const tier = cat.resolveCategory(make, model, body);
  console.log((make + '/' + model).padEnd(30), body.padEnd(11), tier);
}

// Anything that still resolves to the silent fallback (hatchback) is a car the
// catalogue does not really know, which is exactly what we set out to eliminate.
const all = Object.keys(cat.MAKE_MODELS).flatMap((m) => cat.MAKE_MODELS[m].map((e) => [m, e.model]));
console.log('');
console.log('catalogue size =', Object.keys(cat.MAKE_MODELS).length, 'makes /', all.length, 'models');
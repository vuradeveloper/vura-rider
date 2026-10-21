// Is the SERVED photo actually a WHITE car? Sample the pixels.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');

const url = process.argv[2];
const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
const meta = await sharp(buf).metadata();
const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const ch = info.channels;
let opaque = 0, transparent = 0, sumR = 0, sumG = 0, sumB = 0, saturated = 0, nearWhite = 0;
for (let i = 0; i < data.length; i += ch) {
  const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
  if (a < 16) { transparent++; continue; }
  opaque++; sumR += r; sumG += g; sumB += b;
  if (Math.max(r, g, b) - Math.min(r, g, b) > 60) saturated++;
  if (r >= 200 && g >= 200 && b >= 200) nearWhite++;
}
const px = info.width * info.height;
console.log('url          =', url);
console.log('size         =', info.width + 'x' + info.height, '(meta', meta.width + 'x' + meta.height + ')');
console.log('opaque px    =', opaque, '(' + (100 * opaque / px).toFixed(1) + '%)');
console.log('transparent  =', transparent, '(' + (100 * transparent / px).toFixed(1) + '%)');
console.log('avg opaque   = rgb(' + Math.round(sumR / opaque) + ',' + Math.round(sumG / opaque) + ',' + Math.round(sumB / opaque) + ')');
console.log('near-white   =', nearWhite, '(' + (100 * nearWhite / opaque).toFixed(1) + '% of opaque)');
console.log('saturated    =', saturated, '(' + (100 * saturated / opaque).toFixed(1) + '% strong colour)');
const lum = (0.299 * sumR + 0.587 * sumG + 0.114 * sumB) / opaque;
console.log('avg luminance=', lum.toFixed(0), lum > 170 ? '=> LIGHT/WHITE body' : '=> DARK/COLOURED body');

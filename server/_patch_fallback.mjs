// Replaces the driver app's bundled FALLBACK_ROWS with the exact list the image
// library can serve, so the OFFLINE picker cannot offer a car that has no photo.
//
//   node server/_gen_fallback.mjs | Out-File -Encoding utf8 C:\Users\mbofh\_fallback_rows.txt
//   node server/_patch_fallback.mjs
import fs from 'node:fs';

const DRIVER = 'C:/Users/mbofh/2026-PROJECTS/New Boomnut/vura-driver/figma-ui/src/components/VehicleDetails.tsx';
const ROWS = 'C:/Users/mbofh/_fallback_rows.txt';

const rows = fs
  .readFileSync(ROWS, 'utf8')
  .replace(/^\uFEFF/, '')
  .replace(/\s+$/, '')
  .split(/\r?\n/)
  .filter((l) => l.trim().startsWith('['));

if (rows.length < 100) {
  console.error('refusing to patch: only', rows.length, 'rows read from', ROWS);
  process.exit(1);
}

const src = fs.readFileSync(DRIVER, 'utf8');
// Match the ARRAY only. The doc comment above it was written by this script's first run
// and is left alone afterwards, so re-running replaces the list and never duplicates
// the comment.
const re = /const FALLBACK_ROWS[\s\S]*?\r?\n\]/;
if (!re.test(src)) {
  console.error('anchor not found in', DRIVER);
  process.exit(1);
}

const block = [
  'const FALLBACK_ROWS: [string, string, string][] = [',
  ...rows,
  ']',
].join('\r\n');

fs.writeFileSync(DRIVER, src.replace(re, block), 'utf8');
console.log('patched', DRIVER);
console.log('rows   =', rows.length);
console.log('makes  =', new Set(rows.map((l) => l.match(/'([^']+)'/)?.[1])).size);
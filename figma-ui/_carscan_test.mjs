// Proves src/lib/carscan.ts reads a real CarScan / Scans.ai report — the exact
// code the app runs, compiled by tsc and executed on Node.
//
//   cd vura-driver/figma-ui            # or vura-rider/figma-ui
//   node node_modules/typescript/bin/tsc src/lib/carscan.ts src/types/pdfjs-worker.d.ts \
//     --outDir _carc --module commonjs --moduleResolution node10 --target es2020 \
//     --lib es2020,dom --skipLibCheck --esModuleInterop
//   Set-Content _carc/package.json '{"type":"commonjs"}'   # the app package is type:module
//   node _carscan_test.mjs "C:/Users/mbofh/Downloads/document.pdf"
//
// Expected on the real report: matched: 6 · make KIA · model PICANTO · year 2017 ·
// colour Red · plate WYS444W · VIN KNABE511LHT286190 (the two halves of the VIN are
// printed around the label on that report).
import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// Compiled from the real app source by tsc (see the command in the task notes);
// falls back to the esbuild bundle name if that is what was produced.
let lib
try {
  lib = require('./_carc/carscan.js')
} catch {
  lib = require('./_carscan_bundle.cjs')
}
const { readCarScan } = lib

const path = process.argv[2] || 'C:/Users/mbofh/Downloads/document.pdf'
const file = new File([fs.readFileSync(path)], path.split(/[\\/]/).pop(), {
  type: 'application/pdf',
})

const res = await readCarScan(file, (stage) => console.log('stage:', stage))
console.log('source :', res.source)
console.log('matched:', res.matched)
console.log(JSON.stringify(res.fields, null, 2))
console.log('--- text head ---')
console.log(res.text.slice(0, 300).replace(/\n/g, ' | '))

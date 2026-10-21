// Probe: can pdfjs read the CarScan report's text layer?
// Run from vura-driver/figma-ui so the bare specifier resolves.
//   node _carscan_probe.mjs "C:/Users/mbofh/Downloads/document.pdf" out.txt
import fs from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

const src = process.argv[2]
const out = process.argv[3] || '_carscan_raw.txt'
const data = new Uint8Array(fs.readFileSync(src))

const doc = await pdfjs.getDocument({ data, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise
console.log('pages:', doc.numPages)

let all = ''
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i)
  const tc = await page.getTextContent()
  // Rebuild lines from the text items' y positions so labels stay with values.
  const rows = new Map()
  for (const it of tc.items) {
    if (!it.str) continue
    const y = Math.round(it.transform[5])
    rows.set(y, (rows.get(y) || '') + it.str)
  }
  const lines = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, s]) => s.trim()).filter(Boolean)
  all += `\n===== page ${i} =====\n` + lines.join('\n')
  console.log(`page ${i}: ${tc.items.length} items, ${lines.length} lines`)
}

fs.writeFileSync(out, all)
console.log('wrote', out, all.length, 'chars')
console.log('sample:', all.slice(0, 1200).replace(/\s+/g, ' '))

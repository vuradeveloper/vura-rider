#!/usr/bin/env node
/**
 * import-seed.js — STEP 0: bring in a CarsXE search you already ran in their
 * dashboard. This script makes ZERO CarsXE API calls and never logs in to
 * CarsXE. It only reads the saved JSON, lets you pick an image, and hands the
 * finished WebP to our server (which stores it in our own S3 and creates the
 * pending row).
 *
 *   node scripts/import-seed.js --file=<path to carsxe json>      review page
 *   node scripts/import-seed.js --file=<path> --choose=7          import
 *   node scripts/import-seed.js --find                            look for the json
 *
 * Options
 *   --backup=<path>   your downloaded copy, used if the remote link is dead
 *   --api=<base>      API base (default $VURA_API or the production host)
 *   --make= --model= --year= --colour=   override what the JSON says
 *
 * Nothing is auto-picked: review the page, then pass the number you want.
 * Env: CARSXE_ADMIN_PASSWORD (needed only for --choose).
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const REVIEW = path.join(ROOT, 'generated', 'seed-review.html')
const OUT_DIR = path.join(ROOT, 'generated', 'seed')

function arg(name, dflt = null) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return dflt
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true
}

function fail(msg) {
  console.error('\n✗ ' + msg + '\n')
  console.error('Usage: node scripts/import-seed.js --file=<carsxe json> [--choose=N] [--backup=<img>]\n')
  process.exit(1)
}

/** Finds carsxe-looking JSON under the usual places, so you never guess a path. */
function findSeedFiles() {
  const home = require('os').homedir()
  const roots = [ROOT, path.join(ROOT, 'seed'), path.join(ROOT, 'generated'),
    path.join(home, 'Downloads'), path.join(home, 'Desktop'), path.join(home, 'Documents'),
    path.join(home, 'OneDrive', 'Desktop'), path.join(home, 'OneDrive', 'Documents')]
  const hits = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    const walk = (dir, depth) => {
      if (depth > 3) return
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(p, depth + 1); continue }
        if (!/\.json$/i.test(entry.name)) continue
        if (/carsxe|picanto|vehicle.?images/i.test(entry.name)) { hits.push(p); continue }
        try {
          const head = fs.readFileSync(p, 'utf8').slice(0, 4000)
          if (/"images"\s*:/.test(head) && /(link|contextLink)/.test(head)) hits.push(p)
        } catch { /* unreadable, skip */ }
      }
    }
    walk(root, 0)
  }
  return [...new Set(hits)]
}

const slug = (s) => String(s ?? '').trim().toLowerCase()

/** 2018 -> "2017-2020", exactly like the server's generationRange(). */
function generationRange(year) {
  const y = Number(year)
  if (!Number.isFinite(y) || y < 1950 || y > 2100) return 'any'
  const start = Math.floor((y - 1) / 4) * 4 + 1
  return `${start}-${start + 3}`
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

async function download(url, backup) {
  if (backup && fs.existsSync(backup)) {
    console.log(`  using your backup copy: ${backup}`)
    return fs.readFileSync(backup)
  }
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`download failed (${res.status}) — pass --backup=<your copy>`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 1024) throw new Error('downloaded file is suspiciously small')
  return buf
}

/** Same recipe as the server: key out the studio background, trim, 900x560, webp. */
async function processImage(input) {
  const sharp = require('sharp')
  const CANVAS = { w: 900, h: 560 }
  const MAX_BYTES = 80 * 1024
  const { data, info } = await sharp(input).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    const min = Math.min(r, g, b)
    const spread = Math.max(r, g, b) - min
    if (min >= 236 && spread <= 14) data[i + 3] = 0
    else if (min >= 205 && spread <= 20) data[i + 3] = Math.round(255 * ((236 - min) / 31))
  }
  const canvas = sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .trim({ threshold: 2 })
    .resize(CANVAS.w, CANVAS.h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  let out = await canvas.webp({ quality: 82, effort: 5 }).toBuffer()
  for (let q = 76; q >= 40 && out.length > MAX_BYTES; q -= 6) {
    out = await canvas.webp({ quality: q, effort: 5 }).toBuffer()
  }
  return out
}

async function main() {
  if (arg('find')) {
    const hits = findSeedFiles()
    console.log(hits.length
      ? 'CarsXE-looking JSON files found:\n' + hits.map((h, i) => `  ${i + 1}. ${h}`).join('\n')
      : 'No CarsXE JSON found. Save the dashboard response to disk and pass --file=<path>.')
    return
  }

  const file = arg('file')
  if (!file || file === true) fail('--file=<path to the saved CarsXE JSON> is required (or run --find)')
  if (!fs.existsSync(file)) fail(`file not found: ${file}`)

  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  const images = Array.isArray(raw?.images) ? raw.images : []
  if (!images.length) fail('the file has no "images" array')

  const q = raw?.query || raw || {}
  const make = String(arg('make', q.make || 'KIA'))
  const model = String(arg('model', q.model || 'Picanto'))
  const year = Number(arg('year', q.year || 2018))
  const colour = String(arg('colour', q.color || q.colour || 'red'))
  const cacheKey = `${slug(make)}|${slug(model)}|${generationRange(year)}|${slug(colour)}`

  console.log(`\n${images.length} image(s) in ${path.basename(file)}`)
  console.log(`cache_key: ${cacheKey}   (this script makes NO CarsXE call)\n`)
  images.forEach((img, i) => {
    console.log(`  [${String(i + 1).padStart(2)}] ${String(img.mime || '?').padEnd(11)} ` +
      `${img.width || '?'}x${img.height || '?'} ${Math.round((Number(img.byteSize) || 0) / 1024)}KB`)
    console.log(`       ${img.link}`)
    console.log(`       via ${img.contextLink || '(no context link)'}`)
  })

  fs.mkdirSync(path.dirname(REVIEW), { recursive: true })
  fs.writeFileSync(REVIEW, `<!doctype html><html><head><meta charset="utf-8">
<title>Step 0 — choose the ${esc(make)} ${esc(model)} (${esc(colour)}) image</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#f5f6f8;color:#15181d;margin:0;padding:16px}
h1{font-size:20px}.card{background:#fff;border-radius:12px;padding:14px;margin:14px 0;display:flex;gap:16px;flex-wrap:wrap}
.shot{width:320px;height:210px;background:#fff;border:1px solid #e3e5e8;border-radius:10px;display:flex;align-items:center;justify-content:center;overflow:hidden}
.shot img{max-width:100%;max-height:100%}.meta{flex:1;min-width:300px}.n{font-weight:700;font-size:18px}
a{color:#0b62d0;word-break:break-all}.cmd{background:#15181d;color:#e7ecf3;padding:10px 12px;border-radius:8px;overflow:auto}</style>
</head><body>
<h1>Step 0 — ${esc(make)} ${esc(model)} ${esc(year)} ${esc(colour)}</h1>
<p>Pick the clean studio shot (plain/white background, no watermark, the whole car, no dealer banner). <b>Nothing is auto-picked.</b> Then run the command at the bottom with that number.</p>
${images.map((img, i) => `<div class="card">
  <div class="shot"><img src="${esc(img.link)}" alt="candidate ${i + 1}" loading="lazy"></div>
  <div class="meta"><div class="n">#${i + 1}</div>
    <div>${esc(img.mime || '')} · ${esc(img.width)}×${esc(img.height)} · ${Math.round((Number(img.byteSize) || 0) / 1024)} KB</div>
    <div><b>context page</b><br><a href="${esc(img.contextLink)}" target="_blank" rel="noopener">${esc(img.contextLink || '—')}</a></div>
    <div><b>file</b><br><a href="${esc(img.link)}" target="_blank" rel="noopener">${esc(img.link)}</a></div>
  </div></div>`).join('')}
<p class="cmd">node scripts/import-seed.js --file="${esc(path.resolve(file))}" --choose=&lt;number&gt;</p>
</body></html>`)
  console.log(`\nreview page -> ${REVIEW}`)

  const choose = arg('choose')
  if (!choose) {
    console.log('Open the review page, then re-run with --choose=<number>. Nothing has been imported yet.\n')
    return
  }
  const index = parseInt(String(choose), 10) - 1
  const picked = images[index]
  if (!picked || index < 0) fail(`--choose=${choose} but there are only ${images.length} image(s)`)

  const password = process.env.CARSXE_ADMIN_PASSWORD
  if (!password) fail('set CARSXE_ADMIN_PASSWORD (the same value as on the server) to import')
  const base = String(arg('api', process.env.VURA_API || 'https://api.ridevura.com')).replace(/\/+$/, '')

  console.log(`\nimporting #${index + 1}: ${picked.link}`)
  const webp = await processImage(await download(picked.link, arg('backup')))
  console.log(`  processed -> ${(webp.length / 1024).toFixed(1)} KB webp on the 900x560 canvas`)

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const local = path.join(OUT_DIR, `${cacheKey.replace(/\|/g, '-')}.webp`)
  fs.writeFileSync(local, webp)
  console.log(`  local copy -> ${local}`)

  const res = await fetch(`${base}/api/admin/vehicle-images/seed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(`admin:${password}`).toString('base64'),
    },
    body: JSON.stringify({
      cacheKey, make, model, year, colour,
      sourceUrl: picked.link,
      contextLink: picked.contextLink || '',
      licenceNote: 'CarsXE dashboard search; our own stored copy',
      image: webp.toString('base64'),
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) fail(`the server said ${res.status}: ${body.error || 'unknown error'}`)
  console.log(`\n✓ stored in our own bucket: ${body.imageUrl}`)
  console.log(`✓ row ${body.cacheKey} is pending — approve it here:`)
  console.log(`  ${base}/api/admin/vehicle-images?status=pending`)
  console.log(`✓ CarsXE calls used: ${body.budget?.used}/${body.budget?.max} (${body.budget?.left} left)\n`)
}

main().catch((err) => fail(err?.message || String(err)))

#!/usr/bin/env node
/**
 * generate-vehicle-images.js — run ONCE, locally, by a human. NEVER at runtime.
 *
 *  1. Key comes from GEMINI_API_KEY in the environment (never hardcoded/committed).
 *  2. Cars come from scripts/catalogue-source.json.
 *  3. One Gemini call per make+model+colour with the FIXED prompt template below.
 *  4. raw -> background removed (transparent PNG) -> trimmed -> common canvas ->
 *     WebP under 80 KB -> figma-ui/public/assets/vehicles/<make>-<model>-<colour>.webp
 *  5. Skips what exists, STOPS on daily quota, logs every call, writes the app's
 *     map (figma-ui/src/assets/vehiclePhotos.json), builds a contact sheet.
 *
 * It NEVER auto-approves: review the sheet, delete the .webp files you dislike and
 * re-run. The app then falls back: local photo -> body-type SVG -> generic car.
 *
 *   node scripts/generate-vehicle-images.js --setup       setup checklist
 *   node scripts/generate-vehicle-images.js --limit=3     smoke test
 *   node scripts/generate-vehicle-images.js --only=Polo   one model, all colours
 *   node scripts/generate-vehicle-images.js --sheet       sheet only
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(__dirname, 'catalogue-source.json')
const RAW_DIR = path.join(ROOT, 'generated', 'raw')
const OUT_DIR = process.env.OUT_DIR || path.join(ROOT, 'figma-ui', 'public', 'assets', 'vehicles')
const APP_MAP = path.join(ROOT, 'figma-ui', 'src', 'assets', 'vehiclePhotos.json')
const SHEET = path.join(ROOT, 'generated', 'contact-sheet.html')
const LOG = path.join(ROOT, 'generated', 'generate.log')

const CANVAS = { w: 900, h: 560 }
const MAX_BYTES = 80 * 1024
const MODELS = [process.env.GEMINI_IMAGE_MODEL, 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'].filter(Boolean)

const TEMPLATE =
  'A high-resolution studio photograph of a {colour} {year} {make} {model}, front three-quarter view ' +
  "from the driver's side, car facing left, centred, full car visible, plain pure white background, " +
  'soft studio lighting, realistic proportions, accurate {make} {model} body shape, no text, no people, ' +
  'no other objects.'

const args = process.argv.slice(2)
const val = (f) => { const h = args.find((a) => a.startsWith(f + '=')); return h ? h.slice(f.length + 1) : null }
const LIMIT = Number(val('--limit') || 0)
const ONLY = val('--only')

const SETUP = `
DO THIS YOURSELF (the app never does any of it)
 1. node -v                              -> Node 20 or newer
 2. npm i -D @google/genai sharp @imgly/background-removal-node
      @google/genai                     Google's current official Gen AI SDK (JS)
      sharp                             trim / resize / WebP compression
      @imgly/background-removal-node    background removal IN NODE (free, local model,
                                        no Python, no API key). Python rembg[cpu] also
                                        works if you swap removeBackground() below.
 3. https://aistudio.google.com/apikey    -> Get API key, then in PowerShell:
      $env:GEMINI_API_KEY="AQ..."         this shell only
      setx GEMINI_API_KEY "AQ..."         persist for your user (reopen the shell)
    Never write the key into a file in this repo, never commit it.
 4. Docs (names change): https://ai.google.dev/gemini-api/docs/image-generation
      Override: $env:GEMINI_IMAGE_MODEL="gemini-3.1-flash-image"
 5. node scripts/generate-vehicle-images.js --limit=3
 6. Open generated/contact-sheet.html, delete bad .webp files, re-run.
 7. Commit ONLY figma-ui/public/assets/vehicles/*.webp + figma-ui/src/assets/vehiclePhotos.json,
    and add generated/ to .gitignore.
`

function logLine(s) {
  const line = `[${new Date().toISOString()}] ${s}`
  console.log(line)
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, line + '\n') } catch { /* never fatal */ }
}

const slug = (s) => String(s).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const promptFor = (car, colour, year) =>
  TEMPLATE.replace(/\{colour\}/g, colour).replace(/\{year\}/g, String(year))
    .replace(/\{make\}/g, car.make).replace(/\{model\}/g, car.model)

/** First inline image (base64) from any Gemini reply shape. */
function firstImageBase64(res) {
  const parts = res?.candidates?.[0]?.content?.parts || res?.response?.candidates?.[0]?.content?.parts || res?.output?.content?.parts || []
  for (const p of parts) {
    const inline = p?.inlineData || p?.inline_data
    if (inline?.data) return inline.data
  }
  return null
}

const isQuota = (err) => {
  const s = String(err?.message || err || '').toLowerCase()
  return s.includes('429') || s.includes('resource_exhausted') || s.includes('quota') || s.includes('daily limit')
}

/** Gemini call with model fallback + one retry per model on transient errors. */
async function generateRaw(ai, car, colour, year) {
  const prompt = promptFor(car, colour, year)
  let lastErr = null
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      const started = Date.now()
      try {
        logLine(`CALL model=${model} attempt=${attempt} ${car.make} ${car.model} ${colour}`)
        const res = await ai.models.generateContent({ model, contents: prompt })
        const b64 = firstImageBase64(res)
        if (!b64) throw new Error('no image in the reply')
        logLine(`OK   ${model} ${car.make} ${car.model} ${colour} ${Date.now() - started}ms`)
        return Buffer.from(b64, 'base64')
      } catch (err) {
        lastErr = err
        if (isQuota(err)) { logLine(`QUOTA: ${err.message}`); const e = new Error('quota'); e.quota = true; throw e }
        logLine(`FAIL ${model} attempt=${attempt}: ${err.message}`)
        await new Promise((r) => setTimeout(r, 1500 * attempt))
      }
    }
  }
  throw lastErr || new Error('all models failed')
}

/** Background -> transparent PNG. Swap for Python rembg if you prefer. */
async function removeBackground(pngBuffer) {
  const { removeBackground: imgly } = await import('@imgly/background-removal-node')
  const out = await imgly(new Blob([pngBuffer], { type: 'image/png' }), { output: { format: 'image/png' } })
  return Buffer.from(await out.arrayBuffer())
}

/** Trim the empty edges, fit the common canvas, compress to WebP under MAX_BYTES. */
async function toWebp(sharp, transparentPng) {
  const base = sharp(transparentPng).trim({ threshold: 1 })
  const fit = () => base.clone()
    .resize(CANVAS.w, CANVAS.h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  let quality = 86
  let out = await fit().webp({ quality }).toBuffer()
  while (out.length > MAX_BYTES && quality > 40) {
    quality -= 8
    out = await fit().webp({ quality }).toBuffer()
  }
  return { buffer: out, quality }
}

function writeAppMap(map) {
  fs.mkdirSync(path.dirname(APP_MAP), { recursive: true })
  fs.writeFileSync(APP_MAP, JSON.stringify(
    { generatedAt: new Date().toISOString(), images: Object.fromEntries(Object.entries(map).sort()) }, null, 2
  ))
  logLine(`app map: ${Object.keys(map).length} entries -> ${path.relative(ROOT, APP_MAP)}`)
}

function writeContactSheet(map) {
  const cards = Object.entries(map).sort().map(([key, rel]) => {
    const file = path.basename(rel)
    return `<figure><img src="../figma-ui/public/assets/vehicles/${file}" alt="${key}"><figcaption>${key}<br><small>${file}</small></figcaption></figure>`
  }).join('\n')
  const html = `<!doctype html><meta charset="utf-8"><title>Vehicle images</title>
<style>body{font:14px system-ui;background:#f7f7f7;margin:24px}figure{display:inline-block;margin:8px;padding:8px;background:#fff;border:1px solid #e5e5e5;border-radius:12px;width:300px;vertical-align:top}
img{width:100%;background:repeating-linear-gradient(45deg,#fafafa,#fafafa 10px,#f0f0f0 10px,#f0f0f0 20px)}figcaption{margin-top:6px;font-weight:600}</style>
<h1>Vehicle images — ${Object.keys(map).length} file(s)</h1>
<p>Delete the .webp files you do not want, then re-run the script for those models.</p>
${cards}`
  fs.mkdirSync(path.dirname(SHEET), { recursive: true })
  fs.writeFileSync(SHEET, html)
  logLine(`contact sheet -> ${path.relative(ROOT, SHEET)}`)
}

async function main() {
  if (args.includes('--setup')) { console.log(SETUP); return }

  const source = JSON.parse(fs.readFileSync(SRC, 'utf8'))
  const year = source.year || new Date().getFullYear()
  const colours = source.colours || ['White']
  let cars = source.cars || []
  if (ONLY) cars = cars.filter((c) => `${c.make} ${c.model}`.toLowerCase().includes(String(ONLY).toLowerCase()))

  fs.mkdirSync(RAW_DIR, { recursive: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const existing = fs.existsSync(APP_MAP) ? JSON.parse(fs.readFileSync(APP_MAP, 'utf8')).images || {} : {}
  const map = { ...existing }

  if (args.includes('--sheet')) { writeContactSheet(map); return }

  const key = process.env.GEMINI_API_KEY
  if (!key) { console.error('GEMINI_API_KEY is not set.\n' + SETUP); process.exit(1) }

  let sharp, ai
  try { sharp = require('sharp') } catch { console.error('Missing sharp. Run: npm i -D sharp'); process.exit(1) }
  try {
    const { GoogleGenAI } = await import('@google/genai')
    ai = new GoogleGenAI({ apiKey: key })
  } catch { console.error('Missing @google/genai. Run: npm i -D @google/genai'); process.exit(1) }

  logLine(`start: ${cars.length} model(s) x ${colours.length} colour(s), models=${MODELS.join(',')}`)
  let made = 0

  for (const car of cars) {
    for (const colour of colours) {
      const file = `${slug(car.make)}-${slug(car.model)}-${slug(colour)}.webp`
      const abs = path.join(OUT_DIR, file)
      if (fs.existsSync(abs)) { map[`${car.make}|${car.model}|${colour}`] = `assets/vehicles/${file}`; continue }
      if (LIMIT && made >= LIMIT) { logLine('limit reached'); writeAppMap(map); writeContactSheet(map); return }

      try {
        const raw = await generateRaw(ai, car, colour, year)
        fs.writeFileSync(path.join(RAW_DIR, file.replace('.webp', '.png')), raw)
        const cut = await removeBackground(raw)
        const { buffer, quality } = await toWebp(sharp, cut)
        fs.writeFileSync(abs, buffer)
        map[`${car.make}|${car.model}|${colour}`] = `assets/vehicles/${file}`
        made++
        logLine(`SAVED ${file} ${(buffer.length / 1024).toFixed(1)} KB q=${quality}`)
      } catch (err) {
        if (err?.quota) { logLine('stopping on quota'); writeAppMap(map); writeContactSheet(map); return }
        logLine(`SKIP ${file}: ${err.message}`)
      }
    }
  }

  writeAppMap(map)
  writeContactSheet(map)
  logLine(`done: ${made} new image(s), ${Object.keys(map).length} mapped in total`)
}

main().catch((err) => { logLine(`FATAL ${err.message}`); process.exit(1) })



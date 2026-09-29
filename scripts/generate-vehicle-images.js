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
 *   node scripts/generate-vehicle-images.js --probe       which image models THIS credential can use
 *   node scripts/generate-vehicle-images.js --limit=3     smoke test
 *   node scripts/generate-vehicle-images.js --only=Polo   one model, all colours
 *   node scripts/generate-vehicle-images.js --sheet       sheet only
 *
 * CREDENTIALS — measured on 2026-09-29, not guessed:
 *   AI Studio key (GEMINI_API_KEY): 429 "You exceeded your current quota" with
 *     limit: 0 for gemini-2.5-flash-image AND gemini-3.1-flash-image, i.e. the FREE
 *     TIER SERVES NO IMAGE MODELS. Imagen answers 404 "only supported by the Gemini
 *     Enterprise Agent Platform (previously Vertex AI)". Enabling billing on the
 *     key's project unlocks the Gemini image models (~0.04 USD per image).
 *   Vertex AI: GEMINI_VERTEX=1 GCP_PROJECT=<project-id> [GCP_LOCATION=us-central1]
 *     plus `gcloud auth application-default login` serves both the Gemini image
 *     models and Imagen. Run --probe with each credential to see what it can use.
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
let MODELS = [
  process.env.GEMINI_IMAGE_MODEL,
  'gemini-2.5-flash-image', // Nano Banana — usually the one a free-tier key may actually use
  'gemini-3.1-flash-image',
  'imagen-4.0-generate-001', // text-only model: no reference input, STYLE_WORDS carries the style
].filter(Boolean)
const VISION_MODELS = [process.env.GEMINI_VISION_MODEL, 'gemini-3-flash', 'gemini-2.5-flash'].filter(Boolean)

/**
 * STYLE REFERENCE (your screenshot of a white Honda Civic).
 *
 * It is passed to the model as an INPUT next to the text, so the angle, framing,
 * lighting and photographic style are copied — and the prompt says explicitly NOT to
 * copy the car itself. It is NEVER copied into the repo, NEVER bundled in the app and
 * NEVER edited into a result: this script only reads it from disk at run time.
 * Override the path with REFERENCE_IMAGE if you move it.
 */
const REFERENCE = process.env.REFERENCE_IMAGE || 'C:\\Users\\mbofh\\OneDrive\\Pictures\\Screenshots\\Screenshot 2026-09-29 093104.png'

/**
 * The style in WORDS as well, because the reference is small and low resolution —
 * this must stand on its own if the model ignores the image.
 */
const STYLE_WORDS =
  'Photorealistic cut-out studio shot on a pure white seamless background. Camera at roughly ' +
  "wheel-arch height, front three-quarter view from the driver's side with the nose pointing left. " +
  'The whole car is inside the frame, centred, with a small even margin around it. Soft, even, ' +
  'large-source studio lighting, a gentle highlight along the bonnet and roof, realistic paint and ' +
  'glass reflections, dark tinted windows, correctly round wheels with visible rims, headlights and ' +
  'grille clearly modelled, and a subtle soft contact shadow under the tyres. No road, no scenery, ' +
  'no props, no people, no text, no logos, no watermark.'

const TEMPLATE =
  'A high-resolution studio photograph of a {colour} {year} {make} {model}, front three-quarter view ' +
  "from the driver's side, car facing left, centred, full car visible, plain pure white background, " +
  'soft studio lighting, realistic proportions, accurate {make} {model} body shape, no text, no people, ' +
  'no other objects. Match the camera angle, framing, lighting, background and photographic style of the ' +
  'reference image exactly, but depict a {colour} {year} {make} {model} instead. Do not copy the reference car. ' +
  STYLE_WORDS

/** Used on a quality retry, so a rejection is not simply repeated word-for-word. */
const RETRY_TWEAKS = [
  '',
  ' Emphasise the exact camera height and distance of the reference so the car fills the frame the same way.',
  ' Keep the body shape strictly true to a {year} {make} {model} and keep every wheel, door and mirror correct.',
]

const args = process.argv.slice(2)
const val = (f) => { const h = args.find((a) => a.startsWith(f + '=')); return h ? h.slice(f.length + 1) : null }
const LIMIT = Number(val('--limit') || 0)
const ONLY = val('--only')
const FIRST_RUN = args.includes('--first-run')
const SKIP_CHECKS = args.includes('--no-checks')


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
 6. Open generated/contact-sheet.html (your reference on the left, every generated car
    beside it), delete the .webp files you do not like, then re-run for those models.
 7. Commit ONLY figma-ui/public/assets/vehicles/*.webp + figma-ui/src/assets/vehiclePhotos.json,
    and add generated/ to .gitignore. The reference screenshot is NEVER committed.
 8. FIRST RUN (3 cars, then stop):  node scripts/generate-vehicle-images.js --first-run
    -> a white VW Polo Vivo, a silver Toyota Corolla Quest, a red Kia Picanto.
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

/**
 * A 429/4xx from an image model means several very different things:
 *   'limit: 0'                   -> the model is NOT IN THIS PLAN   -> skip to the next model
 *   404 / not found / not supported / permission / api key invalid
 *                                -> this key cannot use that model   -> skip to the next model
 *   "retryDelay": N s (429)      -> temporary per-minute limit       -> wait N s, retry same model
 *   PerDay with a real limit     -> the day's allowance is gone      -> stop the whole run
 * And every non-fatal failure now LOGS THE REAL MESSAGE, because "rate-limited" hid
 * an Imagen error that had nothing to do with rate limiting.
 */
function classify429(err) {
  const s = String(err?.message || err || '')
  const low = s.toLowerCase()
  const limits = [...s.matchAll(/limit:\s*(\d+)/g)].map((m) => Number(m[1]))
  const retry = Number((s.match(/"retryDelay":"(\d+)s"/) || [])[1] || 0)
  const unavailable =
    (limits.length > 0 && Math.max(...limits) === 0) ||
    /not found|not supported|does not exist|permission|api key not valid|invalid api key|unauthenticated|403/.test(low) ||
    /\b404\b/.test(low)
  if (unavailable) return { kind: 'model-unavailable' }
  if (/perday|per day/.test(low) || limits.some((n) => n > 0)) return { kind: 'daily' }
  if (retry > 0 && retry <= 90) return { kind: 'rate', wait: retry }
  return { kind: 'rate', wait: 20 }
}

const isQuota = (err) => classify429(err).kind === 'daily'

/** Loads the reference ONCE as an inline part (style only — never copied/committed). */
let refPart = null
function loadReference() {
  if (refPart) return refPart
  if (!fs.existsSync(REFERENCE)) {
    logLine(`reference NOT found: ${REFERENCE} — continuing with the words-only style description`)
    return null
  }
  const lower = REFERENCE.toLowerCase()
  const mime = lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : 'image/png'
  refPart = { inlineData: { mimeType: mime, data: fs.readFileSync(REFERENCE).toString('base64') } }
  logLine(`reference loaded: ${path.basename(REFERENCE)} — style guide only, never bundled, never committed`)
  return refPart
}

/**
 * One call path for EVERY model: ai.models.generateContent. Imagen used to need its
 * own generateImages() call, but the SDK now reports that method deprecated ("use
 * generateContent with image models instead", see
 * https://ai.google.dev/gemini-api/docs/deprecations#imagen-models) — and the image
 * still comes back as inline base64, which firstImageBase64() already reads.
 * Imagen does NOT accept the reference image; the STYLE_WORDS paragraph carries the
 * style for it, and the log says so per call.
 */
async function generateRaw(ai, car, colour, year, tweak = '') {
  const prompt = promptFor(car, colour, year) + tweak
  const ref = loadReference()
  const parts = ref ? [{ text: prompt }, ref] : [{ text: prompt }]
  let lastErr = null
  for (const model of MODELS) {
    const supportsReference = !model.startsWith('imagen')
    for (let attempt = 1; attempt <= 2; attempt++) {
      const started = Date.now()
      try {
        logLine(`CALL model=${model} attempt=${attempt}${supportsReference ? ' [with reference image]' : ' [text-only: style in words]'} ${car.make} ${car.model} ${colour}${tweak ? ' [retry wording]' : ''}`)
        const contents = supportsReference ? [{ role: 'user', parts }] : prompt
        const res = await ai.models.generateContent({ model, contents })
        const b64 = firstImageBase64(res)
        if (!b64) throw new Error('no image in the reply')
        logLine(`OK   ${model} ${car.make} ${car.model} ${colour} ${Date.now() - started}ms`)
        return Buffer.from(b64, 'base64')
      } catch (err) {
        lastErr = err
        const c = classify429(err)
        const why = String(err?.message || err).replace(/\s+/g, ' ').slice(0, 220)
        if (c.kind === 'daily') {
          logLine(`DAILY QUOTA REACHED on ${model}: ${why}`)
          const e = new Error('daily quota'); e.quota = true; throw e
        }
        if (c.kind === 'model-unavailable') {
          logLine(`  ${model} cannot be used by this key — moving to the next model. Reason: ${why}`)
          break
        }
        logLine(`  ${model} failed (attempt ${attempt}), will wait ${c.wait}s then retry. Reason: ${why}`)
        await new Promise((r) => setTimeout(r, (c.wait + 2) * 1000))
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

function writeContactSheet(map, rejected = []) {
  const refUrl = fs.existsSync(REFERENCE)
    ? 'file:///' + REFERENCE.replace(/\\/g, '/').replace(/ /g, '%20')
    : ''
  const cards = Object.entries(map).sort().map(([key, rel]) => {
    const file = path.basename(rel)
    return `<figure><img src="../figma-ui/public/assets/vehicles/${file}" alt="${key}"><figcaption>${key}<br><small>${file}</small></figcaption></figure>`
  }).join('\n')
  const rej = rejected.length
    ? `<h2>Rejected — not used by the app (kept for inspection in generated/rejected/)</h2><ul>${rejected.map((r) => `<li>${r}</li>`).join('')}</ul>`
    : ''
  const html = `<!doctype html><meta charset="utf-8"><title>Vehicle images — review</title>
<style>
body{font:14px system-ui;background:#f7f7f7;margin:24px}
.wrap{display:flex;gap:20px;align-items:flex-start}
.ref{position:sticky;top:24px;width:340px;flex:0 0 340px;background:#fff;border:1px solid #e5e5e5;border-radius:14px;padding:10px}
.ref img{width:100%;background:#fff;border-radius:8px}
.grid{flex:1;display:flex;flex-wrap:wrap;gap:12px}
figure{margin:0;padding:10px;background:#fff;border:1px solid #e5e5e5;border-radius:12px;width:300px}
img{width:100%;background:repeating-linear-gradient(45deg,#fafafa,#fafafa 10px,#f0f0f0 10px,#f0f0f0 20px);border-radius:8px}
figcaption{margin-top:6px;font-weight:600;word-break:break-all}
small{color:#888;font-weight:400}
</style>
<h1>Vehicle images — review against the reference</h1>
<p>Delete the .webp files you do not want, then re-run the script for those models. Nothing is auto-approved.</p>
<div class="wrap">
  <div class="ref">${refUrl ? `<img src="${refUrl}" alt="style reference">` : '<em>Reference image not found — style words were used.</em>'}
    <p><strong>Style reference</strong><br><small>${path.basename(REFERENCE)} — used as a style guide only, never bundled.</small></p>
  </div>
  <div class="grid">${cards}</div>
</div>
${rej}`
  fs.mkdirSync(path.dirname(SHEET), { recursive: true })
  fs.writeFileSync(SHEET, html)
  logLine(`contact sheet (reference on the left) -> ${path.relative(ROOT, SHEET)}`)
}

/** The 12 colours, in step with the server catalogue (used for the pixel check). */
const PALETTE = {
  White: '#F5F5F5', Black: '#1C1C1E', Silver: '#C0C4C8', Grey: '#7A7F85', Red: '#C62828',
  Blue: '#1E4FA3', Green: '#2E7D32', Brown: '#6D4C41', Gold: '#C9A227', Orange: '#EF6C00',
  Yellow: '#F9C80E', Beige: '#D9C7A3',
}
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

/**
 * Offline checks on the cut-out (no model needed): whole car inside the frame,
 * no white halo, and the body colour actually matches the requested hex.
 */
async function checkPixels(sharp, png, colour) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: ch } = info
  let minX = w, minY = h, maxX = -1, maxY = -1, opaque = 0, halo = 0
  const body = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch
      if (data[i + 3] < 40) continue
      opaque++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      const r = data[i], g = data[i + 1], b = data[i + 2]
      if (r > 238 && g > 238 && b > 238) halo++
      if (y < maxY - h * 0.12 && (r + g + b) / 3 > 60) body.push([r, g, b])
    }
  }
  const reasons = []
  if (!opaque) return ['nothing visible after background removal']
  if (Math.min(minX, w - 1 - maxX) / w < 0.015 || Math.min(minY, h - 1 - maxY) / h < 0.015) {
    reasons.push('car touches the frame edge — something is cropped')
  }
  if (halo / opaque > 0.02) reasons.push('white halo around the cut-out')
  if (body.length > 50) {
    const mean = body.reduce((a, s) => [a[0] + s[0], a[1] + s[1], a[2] + s[2]], [0, 0, 0]).map((v) => v / body.length)
    const [tr, tg, tb] = hexRgb(PALETTE[colour] || PALETTE.Silver)
    const off = Math.max(Math.abs(mean[0] - tr), Math.abs(mean[1] - tg), Math.abs(mean[2] - tb))
    if (off > 95) reasons.push(`body colour is ${Math.round(off)} off ${colour} (${PALETTE[colour] || PALETTE.Silver})`)
  }
  return reasons
}

/** Vision check against the reference: angle, direction, framing, wheels, shape. */
async function checkWithModel(ai, png, car, colour) {
  const ref = loadReference()
  const parts = [
    {
      text: 'Check this generated car photo against the style reference.\n' +
        `The generated car must be a ${colour} ${car.make} ${car.model}, front three-quarter view from the ` +
        "driver's side with the nose pointing LEFT, the whole car in frame, plain white background, " +
        'no text, no logos, no watermark.\n' +
        'Reply with JSON only: {"angle_ok":true,"facing_left":true,"whole_car":true,"colour_ok":true,' +
        '"wheels_ok":true,"model_shape_ok":true,"text_or_logo":false,"notes":"short reason"}',
    },
    { inlineData: { mimeType: 'image/png', data: png.toString('base64') } },
  ]
  if (ref) parts.push(ref)
  for (const model of VISION_MODELS) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: { responseMimeType: 'application/json' },
      })
      const rp = res?.candidates?.[0]?.content?.parts || []
      const txt = String(res?.text || rp.map((p) => p.text).filter(Boolean).join('') || '').trim()
      const j = JSON.parse(txt.replace(/^```json\s*|```$/g, ''))
      const bad = []
      if (j.angle_ok === false) bad.push('angle differs from the reference')
      if (j.facing_left === false) bad.push('car does not face left like the reference')
      if (j.whole_car === false) bad.push('car is not fully in frame')
      if (j.colour_ok === false) bad.push('colour does not match the request')
      if (j.wheels_ok === false) bad.push('wheels/tyres look wrong')
      if (j.model_shape_ok === false) bad.push(`does not look like a ${car.make} ${car.model}`)
      if (j.text_or_logo === true) bad.push('contains text or a logo')
      return { bad, notes: j.notes || '' }
    } catch (err) { logLine(`vision check failed on ${model}: ${err.message}`) }
  }
  return null // no vision model available — the pixel checks still apply
}

async function main() {
  if (args.includes('--setup')) { console.log(SETUP); return }

  const source = JSON.parse(fs.readFileSync(SRC, 'utf8'))
  const year = source.year || new Date().getFullYear()
  const defaultColours = source.colours || ['White']
  // --first-run: exactly the 3 review cars from the config, each with its own colour.
  let cars = FIRST_RUN ? (source.firstRun || []) : (source.cars || [])
  if (ONLY) cars = cars.filter((c) => `${c.make} ${c.model}`.toLowerCase().includes(String(ONLY).toLowerCase()))
  const jobs = []
  for (const car of cars) for (const colour of (car.colour ? [car.colour] : defaultColours)) jobs.push({ car, colour })
  const REJECT_DIR = path.join(ROOT, 'generated', 'rejected')
  fs.mkdirSync(REJECT_DIR, { recursive: true })
  const rejected = []

  fs.mkdirSync(RAW_DIR, { recursive: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })

  const existing = fs.existsSync(APP_MAP) ? JSON.parse(fs.readFileSync(APP_MAP, 'utf8')).images || {} : {}
  const map = { ...existing }

  if (args.includes('--sheet')) { writeContactSheet(map); return }

  const key = process.env.GEMINI_API_KEY
  const usingVertex = process.env.GEMINI_VERTEX === '1'
  if (!key && !usingVertex) { console.error('GEMINI_API_KEY is not set.\n' + SETUP); process.exit(1) }

  let sharp, ai
  try { sharp = require('sharp') } catch { console.error('Missing sharp. Run: npm i -D sharp'); process.exit(1) }
  try {
    const { GoogleGenAI } = await import('@google/genai')
    // TWO ways in, and they are NOT equivalent for images:
    //   AI Studio key -> apiKey. The free tier has NO image models ("limit: 0" on
    //                    gemini-2.5-flash-image and gemini-3.1-flash-image), and
    //                    Imagen answers "only supported by the Gemini Enterprise
    //                    Agent Platform (previously Vertex AI)".
    //   Vertex AI     -> vertexai:true + project + location + Application Default
    //                    Credentials. This one DOES serve the image models.
    //                    Set GEMINI_VERTEX=1, GCP_PROJECT and GCP_LOCATION.
    if (usingVertex) {
      const project = process.env.GCP_PROJECT
      const location = process.env.GCP_LOCATION || 'us-central1'
      if (!project) { console.error('GEMINI_VERTEX=1 needs GCP_PROJECT (and optionally GCP_LOCATION).'); process.exit(1) }
      ai = new GoogleGenAI({ vertexai: true, project, location })
      logLine(`auth=VERTEX project=${project} location=${location} (Application Default Credentials)`)
    } else {
      ai = new GoogleGenAI({ apiKey: key })
      logLine('auth=AI Studio API key (note: the free tier serves no image models)')
    }
  } catch { console.error('Missing @google/genai. Run: npm i -D @google/genai'); process.exit(1) }

  // Imagen is served by Vertex only: on an AI Studio key every call is a 404, so drop
  // it from the chain instead of burning six pointless calls per car.
  if (!usingVertex && MODELS.some((m) => m.startsWith('imagen'))) {
    MODELS = MODELS.filter((m) => !m.startsWith('imagen'))
    logLine('note: Imagen is Vertex-only, so it is not in the chain for an AI Studio key (set GEMINI_VERTEX=1 to use it)')
  }

  if (args.includes('--probe')) {
    logLine('probe: which image models can this credential see? (uses no image quota)')
    try {
      const page = await ai.models.list()
      const items = page?.pageInternal || page?.models || (Array.isArray(page) ? page : [])
      const names = items.map((m) => m?.name || m?.model || String(m)).filter(Boolean)
      const img = names.filter((n) => /image|imagen/i.test(n))
      logLine(`  ${names.length} model(s) visible, ${img.length} image-capable:`)
      for (const n of img) logLine(`    ${n}`)
      if (!img.length) logLine('  none — this credential cannot generate images (see the CREDENTIALS note at the top of this file)')
    } catch (err) {
      logLine(`  probe failed: ${String(err?.message || err).replace(/\s+/g, ' ').slice(0, 300)}`)
    }
    return
  }

  logLine(`start: ${jobs.length} job(s)${FIRST_RUN ? ' [FIRST RUN]' : ''} models=${MODELS.join(',')} reference=${fs.existsSync(REFERENCE) ? 'yes' : 'NO'}`)
  let made = 0

  for (const job of jobs) {
    const { car, colour } = job
    const file = `${slug(car.make)}-${slug(car.model)}-${slug(colour)}.webp`
    const abs = path.join(OUT_DIR, file)
    if (fs.existsSync(abs)) { map[`${car.make}|${car.model}|${colour}`] = `assets/vehicles/${file}`; continue }
    if (LIMIT && made >= LIMIT) { logLine('limit reached'); break }

    // Up to 3 attempts; each rejection rewords the prompt instead of repeating it.
    let saved = false
    for (let attempt = 0; attempt < 3 && !saved; attempt++) {
      const tweak = RETRY_TWEAKS[Math.min(attempt, RETRY_TWEAKS.length - 1)]
        .replace(/\{year\}/g, String(year)).replace(/\{make\}/g, car.make).replace(/\{model\}/g, car.model)
      try {
        const raw = await generateRaw(ai, car, colour, year, tweak)
        const rawPath = path.join(RAW_DIR, file.replace('.webp', `-try${attempt + 1}.png`))
        fs.writeFileSync(rawPath, raw)
        const cut = await removeBackground(raw)

        // ── quality checks before saving (the file is only published if it passes) ──
        const problems = await checkPixels(sharp, cut, colour)
        if (!SKIP_CHECKS) {
          const verdict = await checkWithModel(ai, cut, car, colour)
          if (verdict?.bad?.length) problems.push(...verdict.bad)
          if (verdict?.notes) logLine(`vision notes: ${verdict.notes}`)
        }
        if (problems.length) {
          logLine(`REJECT try${attempt + 1} ${file}: ${problems.join('; ')}`)
          fs.writeFileSync(path.join(REJECT_DIR, `${file.replace('.webp', '')}-try${attempt + 1}.png`), cut)
          if (attempt === 2) rejected.push(`${file} — ${problems.join('; ')}`)
          continue
        }

        const { buffer, quality } = await toWebp(sharp, cut)
        fs.writeFileSync(abs, buffer)
        map[`${car.make}|${car.model}|${colour}`] = `assets/vehicles/${file}`
        made++
        saved = true
        logLine(`SAVED ${file} ${(buffer.length / 1024).toFixed(1)} KB q=${quality} (try${attempt + 1})`)
      } catch (err) {
        if (err?.quota) {
          logLine('stopping: daily quota reached')
          writeAppMap(map); writeContactSheet(map, rejected); return
        }
        logLine(`ERROR ${file} try${attempt + 1}: ${err.message}`)
      }
    }
    if (!saved) logLine(`GIVING UP on ${file} after 3 attempts — the app keeps the SVG for this car`)
  }

  writeAppMap(map)
  writeContactSheet(map, rejected)
  logLine(`done: ${made} new image(s), ${Object.keys(map).length} mapped, ${rejected.length} rejected`)

}

main().catch((err) => { logLine(`FATAL ${err.message}`); process.exit(1) })



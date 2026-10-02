#!/usr/bin/env node
/**
 * import-car-db.js — load the LOCAL Car DB folder into Vura, so vehicle photos
 * come from our own curated images instead of paid CarsXE searches.
 *
 *   node scripts/import-car-db.js --dir="C:\Users\mbofh\Downloads\New Car DB"
 *   node scripts/import-car-db.js --dry            preview what it would import
 *
 * File naming it understands (the DB's own convention):
 *
 *   Make_Model_YearRange_Colour[_vN][_Recolored].ext
 *
 *   Audi_A4_2016-2019_White.jpg
 *   BYD_Seal_2022-Present_White_v2.jpg
 *   Volkswagen_Polo-Hatch_2017-Present_White_Recolored.jpg
 *   Toyota_Camry_Blue.jpg              <- no year range
 *
 * The make and model may contain hyphens; only underscores separate fields.
 *
 * WHAT IT DOES PER FILE
 *   1. parses make / model / "2016-2019" / colour / variant out of the filename,
 *   2. keeps WHITE files only — every colour a driver picks resolves to the white
 *      model (see resolveVehicleImage on the server),
 *   3. within one make|model|range keeps ONE file, the best variant,
 *   4. POSTs the ORIGINAL bytes to /api/admin/vehicle-images/seed with
 *      process:true (the server runs the standard key-out/trim/900x560/WebP-under-
 *      80KB pipeline, so an import looks exactly like a fetched photo) and
 *      approve:true (the curated image serves immediately; no manual review of
 *      190 files).
 *
 * It needs NO AWS key and NO database access — the server does the storing. It
 * only needs the admin password:
 *
 *   $env:CARSXE_ADMIN_PASSWORD="..."   (or --password=...)
 *
 * Safe to re-run: the seed endpoint is idempotent per cache_key, so a second run
 * overwrites the same rows and the same S3 objects rather than duplicating them.
 */
const fs = require('fs')
const path = require('path')

const DEFAULT_DIR = 'C:\\Users\\mbofh\\Downloads\\New Car DB'
const DEFAULT_API = 'https://api.ridevura.com'

function arg(name, dflt = null) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return dflt
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true
}

const DRY = Boolean(arg('dry', false))
const DIR = String(arg('dir', DEFAULT_DIR))
const API = String(arg('api', process.env.VURA_API || DEFAULT_API)).replace(/\/+$/, '')
const PASSWORD = String(arg('password', process.env.CARSXE_ADMIN_PASSWORD || ''))

/** The colours the DB names in filenames. Anything else is treated as a colour. */
const COLOURS = [
  'white', 'black', 'silver', 'grey', 'gray', 'blue', 'red', 'green',
  'orange', 'brown', 'gold', 'beige', 'yellow', 'maroon', 'purple', 'bronze', 'teal',
]

/** Marks a variant of the same car, never a different car. */
const VARIANT = /^(v\d+|recolored|recoloured|final|new|fixed)$/i

const YEAR_RANGE = /^(\d{4})(?:[-–—](\d{4}|present))?$/i
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i

/** The DB's spelling: lowercase, spaces and dots become single hyphens. */
function normToken(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s.]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Splits one filename into its fields. Returns null when the name cannot be read
 * as Make_Model..., so a stray file is reported rather than guessed at.
 */
function parseName(file) {
  const base = file.replace(IMAGE_EXT, '')
  const parts = base.split('_').filter((p) => p !== '')
  if (parts.length < 3) return null

  const make = parts[0]
  const model = parts[1]
  const rest = parts.slice(2)

  let yearRange = null
  if (rest.length && YEAR_RANGE.test(rest[0])) {
    yearRange = rest.shift()
    // Normalise the dash and the word "Present" so matching is exact.
    const m = YEAR_RANGE.exec(yearRange)
    yearRange = m[2] ? `${m[1]}-${/present/i.test(m[2]) ? 'Present' : m[2]}` : m[1]
  }

  let colour = null
  const variants = []
  for (const token of rest) {
    if (!colour && COLOURS.includes(token.toLowerCase())) {
      colour = token
      continue
    }
    variants.push(token)
  }
  // No colour word at all: the first leftover token is taken as the colour, which
  // is how "Toyota_Camry_Blue" is read.
  if (!colour && variants.length) colour = variants.shift()

  return { make, model, yearRange, colour, variants, base }
}

/**
 * Ranks the variants of one car so exactly one image is imported per
 * make|model|range. "Recolored" wins because it is a deliberately corrected image
 * made after the original; then the highest _vN; then the plain file.
 */
function variantRank(variants) {
  let rank = 0
  for (const v of variants) {
    if (/recolou?red/i.test(v)) rank = Math.max(rank, 1000)
    else if (/^v(\d+)$/i.test(v)) rank = Math.max(rank, 100 + Number(/^v(\d+)$/i.exec(v)[1]))
  }
  return rank
}

/** The start year of a range label: "2016-2019" -> 2016, "2020-Present" -> 2020. */
function yearFromRange(yearRange) {
  const m = yearRange && YEAR_RANGE.exec(yearRange)
  return m ? Number(m[1]) : null
}

/**
 * Turns the folder into the exact list of rows to import: one WHITE image per
 * make|model|production-range, plus everything rejected and why.
 */
function buildPlan(dir) {
  const files = fs.readdirSync(dir).filter((f) => IMAGE_EXT.test(f)).sort()
  const skippedColour = []
  const unreadable = []
  const groups = new Map()

  for (const file of files) {
    const parsed = parseName(file)
    if (!parsed) {
      unreadable.push(file)
      continue
    }
    const colour = String(parsed.colour || '').toLowerCase()
    if (colour !== 'white') {
      skippedColour.push(`${file}  (${parsed.colour || 'no colour in name'})`)
      continue
    }
    const make = normToken(parsed.make)
    const model = normToken(parsed.model)
    const range = parsed.yearRange || 'any'
    const key = `${make}|${model}|${range}|white`
    const rank = variantRank(parsed.variants)
    const prev = groups.get(key)
    if (!prev || rank > prev.rank) {
      groups.set(key, {
        key,
        rank,
        file,
        make,
        model,
        yearRange: parsed.yearRange,
        year: yearFromRange(parsed.yearRange),
        replaced: prev ? prev.file : null,
      })
    } else {
      prev.replaced = prev.replaced ? `${prev.replaced}, ${file}` : file
    }
  }

  const entries = Array.from(groups.values()).sort((a, b) => a.key.localeCompare(b.key))
  return { files, entries, skippedColour, unreadable }
}

function human(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB'
  return (bytes / 1024).toFixed(1) + ' KB'
}

async function seedOne(entry, dir) {
  const full = path.join(dir, entry.file)
  const bytes = fs.readFileSync(full)
  const res = await fetch(`${API}/api/admin/vehicle-images/seed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(`admin:${PASSWORD}`).toString('base64'),
    },
    body: JSON.stringify({
      cacheKey: entry.key,
      make: entry.make,
      model: entry.model,
      year: entry.year,
      yearRange: entry.yearRange,
      colour: 'white',
      licenceNote: 'Car DB: ' + entry.file,
      image: bytes.toString('base64'),
      process: true,
      approve: true,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`${res.status} ${body.error || res.statusText}`.trim())
  return { bytes: body.bytes || 0, url: body.imageUrl || null, status: body.status || null }
}

/**
 * --selftest: proves the matching against EVERY car in the folder using the
 * compiled server service — "if a driver saves this exact car, does he get this
 * exact image?" — plus the alias and near-year cases that are easy to get wrong.
 * No network, no database, no upload.
 */
function selfTest(plan) {
  const svc = require(path.join(__dirname, '..', 'server', 'dist', 'services', 'vehicleImages.js'))
  const rows = plan.entries.map((e) => ({
    cache_key: e.key,
    make: e.make,
    model: e.model,
    year: e.year,
    year_range: e.yearRange,
    image_url: 'https://example.test/' + e.key.replace(/\|/g, '-') + '.webp',
    approved_at: '2026-10-01T00:00:00.000Z',
  }))
  let bad = 0
  const say = (ok, label, detail) => {
    if (!ok) bad += 1
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`)
  }

  console.log(`\n— every car in the folder must resolve (${rows.length} rows)`)
  let carBad = 0
  for (const e of plan.entries) {
    const pick = svc.pickBestWhiteRow(rows, { model: e.model, year: e.year })
    const key = pick ? pick.row.cache_key : 'none'
    const good =
      pick &&
      String(pick.row.model) === e.model &&
      (svc.rangeCoversYear(pick.row.year_range, e.year) || pick.row.cache_key === e.key)
    if (!good) {
      carBad += 1
      bad += 1
      console.log(`  FAIL  ${e.model} ${e.year} -> ${key}   (wanted a row for model "${e.model}")`)
    }
  }
  if (!carBad) console.log(`  PASS  all ${plan.entries.length} cars matched a white image`)

  console.log('\n— make aliases, model spelling, year ranges')
  say(svc.canonicalMake('VW') === 'volkswagen', "canonicalMake('VW')", svc.canonicalMake('VW'))
  say(svc.canonicalMake('Mercedes Benz') === 'mercedes-benz', "canonicalMake('Mercedes Benz')", svc.canonicalMake('Mercedes Benz'))
  say(svc.normToken('Polo Vivo') === 'polo-vivo', "normToken('Polo Vivo')", svc.normToken('Polo Vivo'))
  say(svc.normToken('GWM') === 'gwm', "normToken('GWM')", svc.normToken('GWM'))
  say(svc.rangeCoversYear('2017-Present', 2025) === true, "rangeCoversYear('2017-Present', 2025)", 'true')
  say(svc.rangeCoversYear('2016-2019', 2020) === false, "rangeCoversYear('2016-2019', 2020) is false", 'false')

  console.log('\n— the cases most likely to go wrong')
  const expected = [
    ['Volkswagen', 'Polo', 2015, 'volkswagen|polo-mk6|2014-2017|white'],
    ['VW', 'Polo Vivo', 2020, 'volkswagen|polo-vivo|2018-Present|white'],
    ['Toyota', 'Etios', 2016, 'toyota|etios|2010-2018|white'],
    ['Toyota', 'Corolla', 2020, 'toyota|corolla|2019-Present|white'],
    ['Honda', 'City', 2021, 'honda|city|2020-Present|white'],
    ['Kia', 'Picanto', 2018, 'kia|picanto|2017-Present|white'],
  ]
  for (const [make, model, year, want] of expected) {
    const pick = svc.pickBestWhiteRow(rows, { model, year })
    const got = pick ? pick.row.cache_key : 'none'
    say(got === want, `${make} ${model} ${year}`, got)
  }

  console.log('\n— the answer cannot depend on the colour the driver chose')
  const withColour = svc.pickBestWhiteRow(rows, { model: 'Etios', year: 2016, colour: 'Red' })
  const without = svc.pickBestWhiteRow(rows, { model: 'Etios', year: 2016 })
  say(
    Boolean(withColour) && Boolean(without) && withColour.row.cache_key === without.row.cache_key,
    'a colour in the request changes nothing',
    withColour ? withColour.row.cache_key : 'none'
  )

  console.log(bad ? `\n✗ self-test FAILED (${bad} problem(s))\n` : '\n✓ self-test passed\n')
  process.exit(bad ? 1 : 0)
}

async function main() {
  if (!fs.existsSync(DIR)) {
    console.error(`\n✗ folder not found: ${DIR}\n`)
    process.exit(1)
  }
  console.log(`\nCar DB   : ${DIR}`)
  console.log(`Server   : ${API}${DRY ? '   (DRY RUN — nothing will be uploaded)' : ''}\n`)

  const plan = buildPlan(DIR)
  const only = arg('only', null)
  const entries = only ? plan.entries.filter((e) => e.key.includes(String(only))) : plan.entries

  console.log(`files in folder      : ${plan.files.length}`)
  console.log(`to import (white)    : ${entries.length}`)
  console.log(`skipped, not white   : ${plan.skippedColour.length}`)
  console.log(`unreadable names     : ${plan.unreadable.length}`)
  console.log(`superseded variants  : ${plan.entries.filter((e) => e.replaced).length} car(s) had extra copies\n`)

  if (plan.skippedColour.length) {
    console.log('— not imported, no white model of that car in the DB:')
    for (const s of plan.skippedColour) console.log('    ' + s)
    console.log('')
  }
  if (plan.unreadable.length) {
    console.log('— name not in Make_Model_... form, skipped:')
    for (const s of plan.unreadable) console.log('    ' + s)
    console.log('')
  }

  if (arg('selftest', false)) selfTest(plan)

  if (DRY) {
    console.log('— would import:')
    for (const e of entries) {
      console.log(`    ${e.key.padEnd(46)} <- ${e.file}${e.replaced ? `   (also had: ${e.replaced})` : ''}`)
    }
    console.log('\nDry run complete — re-run without --dry to upload.\n')
    process.exit(0)
  }

  if (!PASSWORD) {
    console.error('✗ the admin password is required: set CARSXE_ADMIN_PASSWORD or pass --password=\n')
    process.exit(1)
  }
  if (!entries.length) {
    console.error('✗ nothing to import — check --dir\n')
    process.exit(1)
  }

  const ok = []
  const failed = []
  let n = 0
  for (const entry of entries) {
    n += 1
    const label = `[${String(n).padStart(3)}/${entries.length}]`
    try {
      const out = await seedOne(entry, DIR)
      ok.push({ ...entry, storedBytes: out.bytes, url: out.url, status: out.status })
      console.log(`${label} ok    ${entry.key}  ${human(out.bytes)}`)
    } catch (err) {
      failed.push({ ...entry, error: String(err.message || err) })
      console.log(`${label} FAIL  ${entry.key}  ${err.message || err}`)
    }
  }

  const manifestDir = path.join(__dirname, '..', 'generated')
  fs.mkdirSync(manifestDir, { recursive: true })
  const manifest = {
    importedAt: new Date().toISOString(),
    dir: DIR,
    api: API,
    imported: ok,
    failed,
    skippedNotWhite: plan.skippedColour,
    unreadable: plan.unreadable,
  }
  const manifestPath = path.join(manifestDir, 'car-db-manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  console.log(`\nimported: ${ok.length}   failed: ${failed.length}`)
  if (failed.length) {
    console.log('failures:')
    for (const f of failed) console.log(`    ${f.key}  ${f.error}`)
  }
  console.log(`manifest: ${manifestPath}\n`)
  process.exit(failed.length ? 1 : 0)
}

// Only run when this file IS the entry point, so the helpers can also be
// required by a checker without kicking off an upload.
if (require.main === module) {
  main().catch((err) => {
    console.error('\n✗ ' + (err && err.stack ? err.stack : err) + '\n')
    process.exit(1)
  })
}

// Exported so the parser and the matcher can be checked without uploading
// anything.
module.exports = { parseName, buildPlan, normToken, variantRank, yearFromRange, seedOne }

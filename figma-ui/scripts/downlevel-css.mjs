// ─────────────────────────────────────────────────────────────────────────────
// downlevel-css.mjs — run AFTER `vite build`, BEFORE the compat scan.
//
// WHY: Tailwind v4's compiled output is structurally modern — @layer theme/
// base/components/utilities, :is()/:where() variant selectors, color-mix()
// derivations. Engines below Chrome 99/88/111 DISCARD those constructs (an
// unknown at-rule takes its whole block with it; an unknown pseudo drops the
// whole selector), which zeroes every utility class → "unstyled HTML" on the
// old Android System WebViews Huawei ships. Tailwind v4 itself cannot emit
// for such old targets. So: re-target the BUILT css with lightningcss
// (floor = build.target Chrome/Android 70), then run three passes that
// lightningcss does not provide:
//
//   P1 flatten @layer     statements (`@layer a,b;`) deleted, blocks unwrapped
//                          in place. Block source order equals cascade-layer
//                          order (components→properties→theme→base→utilities)
//                          and all unlayered rules follow, so the cascade is
//                          preserved exactly.
//   P2 :is( → :-webkit-any(  MDN BCD: Chrome 12→current (and Android WebView)
//                          parses :-webkit-any(); Safari 5+ too. Args with
//                          top-level combinators are skipped (legacy -webkit-
//                          any can't express them) and surface as FATAL.
//   P3 unwrap :where(     zero-specificity wrapper removed with proper
//                          selector-list expansion: X:where(A,B)Y becomes
//                          X A Y,X B Y. The specificity bump only touches
//                          preflight rules no utility class competes with.
//
// color-mix()/oklch()/lab() survive on purpose inside @supports-guarded
// enhancement blocks — scan-legacy-compat.mjs classifies those as benign.
// After the passes a FATAL check proves nothing banned remains.
// Idempotent: re-running on already-lowered css changes nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { transform } from 'lightningcss'

const DIST_CSS_DIR = join(process.cwd(), 'dist', 'assets')

/** Same floor as vite build.target / cssTarget. Chrome major << 16. */
const TARGETS = { chrome: 70 << 16, android: 70 << 16 }

// ── low-level helpers ────────────────────────────────────────────────────────

/** 1 = real CSS code, 0 = inside a string literal or comment. */
function codeMask(css) {
  const mask = new Uint8Array(css.length).fill(1)
  let i = 0
  while (i < css.length) {
    const c = css[i]
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      const stop = end === -1 ? css.length : end + 2
      mask.fill(0, i, stop)
      i = stop
      continue
    }
    if (c === '"' || c === "'") {
      const q = c
      let k = i + 1
      while (k < css.length) {
        if (css[k] === '\\') { k += 2; continue }
        if (css[k] === q) { k++; break }
        k++
      }
      mask.fill(0, i, k)
      i = k
      continue
    }
    i++
  }
  return mask
}

/** Index of the bracket matching css[open] ('{' → '}', '(' → ')'), or -1. */
function matchClose(css, open, mask) {
  const openCh = css[open]
  const closeCh = openCh === '{' ? '}' : ')'
  let depth = 0
  for (let i = open; i < css.length; i++) {
    if (!mask[i]) continue
    const c = css[i]
    if (c === openCh) depth++
    else if (c === closeCh) { depth--; if (depth === 0) return i }
  }
  return -1
}

/** Split [from,to) at top-level commas (ignores (), [], strings via mask). */
function splitList(css, from, to, mask) {
  const parts = []
  let depth = 0
  let start = from
  for (let i = from; i < to; i++) {
    if (!mask[i]) continue
    const c = css[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) { parts.push([start, i]); start = i + 1 }
  }
  parts.push([start, to])
  return parts
}

let files
try {
  files = readdirSync(DIST_CSS_DIR).filter((f) => f.endsWith('.css'))
} catch {
  console.error(`[downlevel-css] ${DIST_CSS_DIR} not found — run vite build first`)
  process.exit(1)
}
if (files.length === 0) {
  console.error('[downlevel-css] no .css files in dist/assets — nothing to downlevel?')
  process.exit(1)
}

// ── P1: @layer flattening ────────────────────────────────────────────────────

function flattenLayers(css) {
  let mask = codeMask(css)
  let total = 0
  for (let guard = 0; guard < 50; guard++) {
    // find next @layer token in code (not inside strings/comments/idents)
    let idx = -1
    let from = 0
    while (true) {
      const p = css.indexOf('@layer', from)
      if (p === -1) break
      from = p + 6
      if (!mask[p]) continue
      if (p > 0 && /[a-zA-Z0-9_-]/.test(css[p - 1])) continue // part of a longer ident
      if (css[p - 1] === '\\') continue // escaped selector char
      idx = p
      break
    }
    if (idx === -1) return { css, total }

    // what kind? statement (@layer …;) vs block (@layer name{…})
    let j = idx + 6
    while (j < css.length && /\s/.test(css[j])) j++
    let isStatement = false
    for (let k = j; k < css.length; k++) {
      if (!mask[k]) continue
      if (css[k] === ';') { isStatement = true; break }
      if (css[k] === '{' || css[k] === '}') break
    }

    let end // exclusive
    let replacement = ''
    if (isStatement) {
      end = css.indexOf(';', j) + 1
      if (end === 0) throw new Error('flattenLayers: unterminated @layer statement')
    } else {
      let open = -1
      for (let k = j; k < css.length; k++) {
        if (mask[k] && css[k] === '{') { open = k; break }
      }
      if (open === -1) {
        throw new Error(`flattenLayers: unexpected @layer at ${idx}: ${JSON.stringify(css.slice(idx, idx + 40))}`)
      }
      const close = matchClose(css, open, mask)
      if (close === -1) throw new Error(`flattenLayers: unclosed @layer block at ${idx}`)
      replacement = css.slice(open + 1, close) // keep block content, drop wrappers
      end = close + 1
    }
    css = css.slice(0, idx) + replacement + css.slice(end)
    total++
    mask = codeMask(css)
  }
  throw new Error('flattenLayers: did not converge in 50 passes')
}

// ── P2: :is( → :-webkit-any( ────────────────────────────────────────────────

/** True when a selector-arg range contains a top-level combinator (descendant
 *  space, >, +, ~) — legacy -webkit-any() cannot express those. */
function hasTopCombinator(css, from, to, mask) {
  while (from < to && mask[from] && /\s/.test(css[from])) from++
  while (to > from && mask[to - 1] && /\s/.test(css[to - 1])) to--
  let depth = 0
  for (let i = from; i < to; i++) {
    if (!mask[i]) continue
    const c = css[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (depth === 0 && (c === '>' || c === '+' || c === '~')) return true
    else if (depth === 0 && /\s/.test(c)) return true
  }
  return false
}

function convertIs(css, stats) {
  const mask = codeMask(css)
  let out = ''
  let from = 0
  while (true) {
    const p = css.indexOf(':is(', from)
    if (p === -1) { out += css.slice(from); break }
    if (!mask[p] || (p > 0 && css[p - 1] === '\\')) {
      out += css.slice(from, p + 4)
      from = p + 4
      continue
    }
    const close = matchClose(css, p + 3, mask)
    if (close === -1) throw new Error(`convertIs: unclosed :is( at ${p}`)
    const argParts = splitList(css, p + 4, close, mask)
    const convertible = argParts.every(([a, b]) => !hasTopCombinator(css, a, b, mask))
    out += css.slice(from, p)
    if (convertible) {
      out += ':-webkit-any('
      stats.is++
    } else {
      out += css.slice(p, p + 4) // leave as-is → FATAL check will surface it
      stats.isSkipped++
      console.error(`[downlevel-css] WARN: :is( at ${p} has combinator args, left alone (FATAL follows): ${css.slice(p, close + 1).slice(0, 90)}`)
    }
    from = p + 4
  }
  return out
}

// ── P3: :where( unwrap with selector-list expansion ─────────────────────────

function unwrapWhere(css) {
  let mask = codeMask(css)
  let count = 0
  while (true) {
    let p = -1
    let from = 0
    while (true) {
      const q = css.indexOf(':where(', from)
      if (q === -1) break
      from = q + 7
      if (!mask[q]) continue
      if (q > 0 && css[q - 1] === '\\') continue
      p = q
      break
    }
    if (p === -1) return { css, count }

    const open = p + 6
    const close = matchClose(css, open, mask)
    if (close === -1) throw new Error(`unwrapWhere: unclosed :where( at ${p}`)

    // bounds of the selector-list ITEM containing this :where(
    let depth = 0
    let start = 0
    for (let i = p; i >= 0; i--) {
      if (!mask[i]) continue
      const c = css[i]
      if (c === ')' || c === ']') depth++
      else if (c === '(' || c === '[') {
        if (depth > 0) depth--
        else throw new Error(`unwrapWhere: :where( nested in another function at ${p} — handle manually`)
      }
      else if (depth === 0 && c === ',') { start = i + 1; break }
      else if (depth === 0 && c === '{') { start = i + 1; break }
    }
    depth = 0
    let end = css.length
    for (let i = close + 1; i < css.length; i++) {
      if (!mask[i]) continue
      const c = css[i]
      if (c === '(' || c === '[') depth++
      else if (c === ')' || c === ']') {
        if (depth > 0) depth--
        else throw new Error(`unwrapWhere: :where( nested in another function at ${p} — handle manually`)
      }
      else if (depth === 0 && c === ',') { end = i; break }
      else if (depth === 0 && (c === '{' || c === ';')) { end = i; break }
    }

    const item = css.slice(start, end)
    const occStart = p - start
    const occEnd = close + 1 - start
    const argParts = splitList(css, p + 7, close, mask)
    const variants = argParts.map(([a, b]) =>
      (item.slice(0, occStart) + css.slice(a, b).trim() + item.slice(occEnd)).trim(),
    )
    css = css.slice(0, start) + variants.join(',') + css.slice(end)
    count++
    mask = codeMask(css)
  }
}

// ── FATAL check ──────────────────────────────────────────────────────────────

const FATAL = [
  ['@layer (must be fully flattened)', /@layer[\s;{]/g],
  [':is( (must be fully converted to :-webkit-any)', /:is\(/g],
  [':where( (must be fully unwrapped)', /:where\(/g],
  [':has( (Chrome 105+)', /:has\(/g],
  ['inset shorthand (Chrome 87+)', /(?:^|[;{\s])inset:/g],
]
// color-mix()/oklch()/lab()/lch() are NOT fatal here: they are legitimate
// inside @supports-guarded enhancement blocks and as hex-twin declarations —
// scripts/scan-legacy-compat.mjs classifies benign vs fatal properly.

let failed = false
for (const file of files) {
  const path = join(DIST_CSS_DIR, file)
  const input = readFileSync(path)
  const before = input.toString('utf8')
  let result
  try {
    result = transform({
      filename: file,
      code: input,
      minify: true,
      targets: TARGETS,
      errorRecovery: true,
    })
  } catch (err) {
    console.error(`[downlevel-css] lightningcss failed on ${file}:`, err.message)
    process.exit(1)
  }
  const lowered = result.code.toString('utf8')

  const stats = { is: 0, isSkipped: 0 }
  const fl = flattenLayers(lowered)
  const ci = convertIs(fl.css, stats)
  const uw = unwrapWhere(ci)
  const after = uw.css

  writeFileSync(path, after)
  console.log(
    `[downlevel-css] ${file}: ${before.length} -> ${after.length} bytes ` +
    `(layers x${fl.total}, :is→:-webkit-any x${stats.is}` +
    (stats.isSkipped ? `, :is SKIPPED x${stats.isSkipped}` : '') +
    `, :where unwrapped x${uw.count})`,
  )
  for (const w of result.warnings || []) {
    console.warn('[downlevel-css] warning:', w.message)
  }
  for (const [name, re] of FATAL) {
    const m = after.match(re) // global regexes: all occurrences, lastIndex-safe
    if (m) {
      const idx = after.indexOf(m[0])
      console.error(`[downlevel-css] FATAL: ${name} in ${file} …${after.slice(Math.max(0, idx - 40), idx + 40).replace(/\s+/g, ' ')}…`)
      failed = true
    }
  }
}
process.exit(failed ? 1 : 0)

// ─────────────────────────────────────────────────────────────────────────────
// scan-legacy-compat.mjs — the build's OLD-WEBVIEW GUARDRAIL.
//
// Runs after vite build + downlevel-css. Fails (exit 1) if the shipped bundle
// still contains anything a Chrome/Android-70 System WebView cannot PARSE
// (JS) or would SILENTLY DISCARD (CSS) — the exact regressions that produced
// the "unstyled HTML on Huawei" incident. INFO-level features (backed by
// runtime polyfills or safely ignored by old engines) are printed, not fatal.
//
// Banned JS = parse-level: optional chaining, nullish coalescing/assignment,
// private class fields, static blocks. Builtin uses (Object.hasOwn,
// structuredClone, .at(, replaceAll, fromEntries, globalThis., allSettled,
// matchAll) are WARN-only because src/lib/legacyPolyfills.ts shims each of
// them before the app evaluates (guarded no-ops on modern engines).
//
// Banned CSS = constructs old engines throw away wholesale: @layer, :is(),
// :where(), :has(), @container/@scope at-rules, the `inset` shorthand, and
// CSS Media Queries Level 4 range syntax — all must be zero after
// downlevel-css. The modern color functions (color-mix(), oklch(), lab(),
// lch()) are conditional: fatal UNLESS benign, where benign = inside an
// @supports block (old engines evaluate the condition false and skip the
// whole block) OR a hex fallback for the same property precedes it in the
// same rule (old engines drop the modern declaration and keep the twin —
// exactly how lightningcss emits them for chrome70 targets).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ASSETS = join(process.cwd(), 'dist', 'assets')

/** All matches of a regex as [{0, index}] — always global, correct counts. */
function allMatches(text, re) {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  return [...text.matchAll(g)]
}

/** [start, closeBrace] spans of every top-level @supports rule. */
function supportsSpans(text) {
  const spans = []
  const re = /@supports/g
  let m
  while ((m = re.exec(text)) !== null) {
    let p = m.index
    let d = 0
    let opened = false
    for (; p < text.length; p++) {
      const c = text[p]
      if (c === '{') { d++; opened = true }
      else if (c === '}') { d--; if (opened && d === 0) break }
    }
    spans.push([m.index, p])
  }
  return spans
}

/** A modern color function at `pos` is benign when it sits inside an
 *  @supports rule (condition false on old engines → block skipped) or when
 *  the same property already carries a hex fallback earlier in the block. */
function benignColorFn(text, pos, spans) {
  if (spans.some(([s, e]) => pos > s && pos < e)) return true
  const b = text.lastIndexOf('{', pos)
  const head = b === -1 ? text.slice(0, pos) : text.slice(b + 1, pos)
  const pm = [...head.matchAll(/([-\w]+)\s*:/g)].pop()
  if (!pm) return false
  const prop = pm[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[;{])\\s*${prop}\\s*:[^;}]*#`).test(head)
}

// mode: undefined/'always' = any hit is fatal; 'colorfn' = fatal only when
// benignColorFn() says the old engine would not simply discard-and-fall-back.
const CSS_FATAL = [
  ['@layer (cascade layers)', /@layer[\s;{]/, undefined],
  [':is()', /:is\(/, undefined],
  [':where()', /:where\(/, undefined],
  [':has()', /:has\(/, undefined],
  ['inset shorthand', /(?:^|[;{\s])inset:/, undefined],
  ['@container at-rule', /(?:^|[;}{\n])\s*@container[\s{]/, undefined],
  ['@scope at-rule', /(?:^|[;}{\n])\s*@scope[\s{]/, undefined],
  ['media range syntax', /@media[^{]*[<>]=?/, undefined],
  ['color-mix()', /color-mix\(/, 'colorfn'],
  ['oklch()', /oklch\(/, 'colorfn'],
  ['lab()/lch()', /(?:^|[^\w-])(?:lab|lch)\(/, 'colorfn'],
]
const CSS_INFO = [
  ['@property (benign: old engines ignore the whole block)', /@property\s/g],
  ['gap: (grid ok 66+; flex gap emulated by legacy-compat.css under .no-flex-gap)', /(?:^|[;{\s])gap:/g],
  ['backdrop-filter (prefixed copy is added for old engines)', /backdrop-filter/g],
]

const JS_FATAL = [
  ['optional chaining ?.', /(?:[\w)\]"'])\?\.(?!\d)/g],
  ['nullish coalescing ??', /\?\?/g],
  ['private class fields #x', /(?:^|[({;,\s.])#[A-Za-z_]\w*\s*[=;(]/g],
  ['static { } blocks', /\bstatic\s*\{/g],
]
const JS_INFO = [
  ['Object.hasOwn (polyfilled)', /Object\.hasOwn/g],
  ['structuredClone (polyfilled)', /structuredClone/g],
  ['Array/String .at( (polyfilled)', /\.at\(/g],
  ['replaceAll (polyfilled, string search)', /replaceAll/g],
  ['Object.fromEntries (polyfilled)', /Object\.fromEntries/g],
  ['globalThis (polyfilled)', /globalThis\./g],
  ['Promise.allSettled (polyfilled)', /Promise\.allSettled/g],
  ['matchAll (polyfilled)', /matchAll\(/g],
]

/** 1 = real code, 0 = inside a string/template-text/comment. Masks single-
 *  and double-quoted strings, comments, and template-literal TEXT while
 *  leaving ${…} substitution expressions as code (operators live there).
 *  Limitation: regex literals are not detected (rare source of `??` text). */
function jsMask(src) {
  const mask = new Uint8Array(src.length)
  mask.fill(1)
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') { mask[i] = 0; i++ }
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { mask[i] = 0; i++ }
      if (i < src.length) { mask[i] = 0; mask[i + 1] = 0 }
      i += 2
      continue
    }
    if (c === '"' || c === "'") {
      const q = c
      mask[i] = 0
      i++
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') {
          mask[i] = 0
          if (i + 1 < src.length) { mask[i + 1] = 0; i += 2; continue }
        }
        mask[i] = 0
        i++
      }
      if (i < src.length) { mask[i] = 0 }
      i++
      continue
    }
    if (c === '`') {
      mask[i] = 0
      i++
      while (i < src.length) {
        if (src[i] === '\\') {
          mask[i] = 0
          if (i + 1 < src.length) { mask[i + 1] = 0; i += 2; continue }
          i++
          continue
        }
        if (src[i] === '`') { mask[i] = 0; i++; break }
        if (src[i] === '$' && src[i + 1] === '{') {
          // substitution expression = CODE until the matching close brace
          let depth = 1
          i += 2
          while (i < src.length && depth > 0) {
            const cc = src[i]
            if (cc === '{') depth++
            else if (cc === '}') { depth--; if (depth === 0) { i++; break } }
            else if (cc === '"' || cc === "'" || cc === '`') {
              const q2 = cc
              mask[i] = 0
              i++
              while (i < src.length && src[i] !== q2) {
                if (src[i] === '\\') {
                  mask[i] = 0
                  if (i + 1 < src.length) { mask[i + 1] = 0; i += 2; continue }
                }
                mask[i] = 0
                i++
              }
              if (i < src.length) { mask[i] = 0 }
              i++
              continue
            }
            i++
          }
          continue
        }
        mask[i] = 0
        i++
      }
      continue
    }
    i++
  }
  return mask
}

function scan(file, text, fatal, info, label) {
  const spans = label === 'css' ? supportsSpans(text) : []
  const mask = label === 'js' ? jsMask(text) : null
  let fatalHits = 0
  for (const [name, re, mode] of fatal) {
    const matches = allMatches(text, re).filter((m) => !mask || [...m[0]].every((_, k) => mask[m.index + k]))
    const bad = mode === 'colorfn' ? matches.filter((m) => !benignColorFn(text, m.index, spans)) : matches
    if (bad.length > 0) {
      const benign = matches.length - bad.length
      console.error(`  FATAL ${label} ${name}: x${bad.length}` + (benign ? ` (${benign} benign)` : ''))
      // show up to 3 contexts so a failure is debuggable from the log alone
      for (const m of bad.slice(0, 3)) {
        console.error(`        …${text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, ' ')}…`)
      }
      fatalHits++
    } else if (mode === 'colorfn' && matches.length > 0) {
      console.log(`  info ${label} ${name}: x${matches.length} (benign: @supports-guarded or hex twin)`)
    }
  }
  for (const [name, re] of info) {
    const n = allMatches(text, re).length
    if (n > 0) console.log(`  info ${label} ${name}: x${n}`)
  }
  if (fatalHits === 0) console.log(`  OK ${file} (${label})`)
  return fatalHits
}

let cssFiles = []
let jsFiles = []
try {
  cssFiles = readdirSync(ASSETS).filter((f) => f.endsWith('.css'))
  jsFiles = readdirSync(ASSETS).filter((f) => f.endsWith('.js'))
} catch {
  console.error(`[scan] ${ASSETS} not found — run the build first`)
  process.exit(1)
}

console.log(`[scan] legacy-compat gate — floor Chrome/Android 70 (${cssFiles.length} css, ${jsFiles.length} js)`)
let bad = 0
for (const f of cssFiles) bad += scan(f, readFileSync(join(ASSETS, f), 'utf8'), CSS_FATAL, CSS_INFO, 'css')
for (const f of jsFiles) {
  // pdf.worker + pdf legacy build are lazy, self-contained chunks; they are
  // still target-transpiled, so the same parse rules apply to all JS.
  bad += scan(f, readFileSync(join(ASSETS, f), 'utf8'), JS_FATAL, JS_INFO, 'js')
}

if (bad > 0) {
  console.error(`[scan] FAILED — ${bad} banned feature group(s) remain. Old WebViews would break.`)
  process.exit(1)
}
console.log('[scan] legacy-compat gate OK — no banned features in the shipped bundle')

// ─────────────────────────────────────────────────────────────────────────────
// legacyPolyfills — guarded builtins for the Chrome/Android-70 floor.
//
// build.target chrome70 removes SYNTAX the old engine cannot parse (?., ??,
// class fields, private fields) but it does NOT polyfill BUILTINS that simply
// do not exist there. Each shim below is a no-op when the real thing exists,
// so modern WebViews pay nothing. Imported FIRST in main.tsx, before react or
// any app module evaluates.
//
// Coverage (verified against the built bundle by scripts/scan-legacy-compat):
//   globalThis (<71), Object.hasOwn (<93), Object.fromEntries (<73),
//   structuredClone (<98), Array/String .at (<92), String.replaceAll (<85,
//   string-search args only), Promise.allSettled (<76), String.matchAll (<73).
// ─────────────────────────────────────────────────────────────────────────────
;(() => {
  const g: any = typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : window

  // globalThis (Chrome 71)
  if (typeof g.globalThis === 'undefined') {
    try { g.globalThis = g } catch { /* frozen global — window still works */ }
  }

  const Obj: any = Object

  // Object.hasOwn (Chrome 93)
  if (typeof Obj.hasOwn !== 'function') {
    Obj.hasOwn = (o: object, p: PropertyKey) => Object.prototype.hasOwnProperty.call(o, p)
  }

  // Object.fromEntries (Chrome 73)
  if (typeof Obj.fromEntries !== 'function') {
    Obj.fromEntries = (iterable: Iterable<readonly [PropertyKey, any]>) => {
      const out: any = {}
      for (const pair of iterable) out[pair[0]] = pair[1]
      return out
    }
  }

  // structuredClone (Chrome 98) — JSON round-trip fallback. Lossy for
  // functions/DOM nodes (they become undefined/throw) and Date becomes a
  // string; only ever hit on <98 engines, and the bundle's few call sites
  // clone plain data. Documented in the RC3 old-webview report.
  if (typeof g.structuredClone !== 'function') {
    g.structuredClone = (v: any) => JSON.parse(JSON.stringify(v))
  }

  // Array.prototype.at / String.prototype.at (Chrome 92)
  if (typeof Array.prototype.at !== 'function') {
    Array.prototype.at = function at(this: any[], i: number) {
      const len = this.length
      const idx = Math.trunc(i) || 0
      const pos = idx < 0 ? len + idx : idx
      return pos >= 0 && pos < len ? this[pos] : undefined
    }
  }
  if (typeof (String.prototype as any).at !== 'function') {
    ;(String.prototype as any).at = function at(this: string, i: number) {
      const len = this.length
      const idx = Math.trunc(i) || 0
      const pos = idx < 0 ? len + idx : idx
      return pos >= 0 && pos < len ? this[pos] : undefined
    }
  }

  // String.prototype.replaceAll (Chrome 85) — string-search form only (the
  // bundle's call sites all pass literal strings; regex+global is not shimmed
  // and would throw loudly rather than corrupt data).
  if (typeof (String.prototype as any).replaceAll !== 'function') {
    ;(String.prototype as any).replaceAll = function replaceAll(this: string, search: any, repl: any) {
      if (typeof search !== 'string') {
        throw new TypeError('replaceAll polyfill supports string search only')
      }
      return this.split(search).join(typeof repl === 'function' ? String(repl()) : String(repl))
    }
  }

  // Promise.allSettled (Chrome 76)
  if (typeof (Promise as any).allSettled !== 'function') {
    ;(Promise as any).allSettled = (values: any[]) =>
      Promise.all(
        values.map((v) =>
          Promise.resolve(v).then(
            (value: any) => ({ status: 'fulfilled', value }),
            (reason: any) => ({ status: 'rejected', reason }),
          ),
        ),
      )
  }

  // String.prototype.matchAll (Chrome 73)
  if (typeof (String.prototype as any).matchAll !== 'function') {
    ;(String.prototype as any).matchAll = function matchAll(this: string, re: RegExp) {
      const flags = re.flags.indexOf('g') >= 0 ? re.flags : re.flags + 'g'
      const clone = new RegExp(re.source, flags)
      const out: RegExpExecArray[] = []
      let m: RegExpExecArray | null
      while ((m = clone.exec(this)) !== null) {
        out.push(m)
        if (m[0] === '') clone.lastIndex++
      }
      return out[Symbol.iterator]()
    }
  }
})()

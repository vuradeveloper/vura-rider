// ─────────────────────────────────────────────────────────────────────────────
// webviewGuard — fail LOUDLY and legibly on old/broken Android System WebViews
// instead of rendering the "unstyled HTML" mess the Huawei incident produced.
//
// Gates (installWebviewGuard, called before React mounts):
//   1. Chrome major parsed from the UA (WebView UAs carry `Chrome/x`). Below
//      MIN -> full-screen "Please update Android System WebView / Chrome"
//      WITH the detected version; the app is NOT mounted. The screen is
//      inline-styled, so it shows even when every stylesheet is dead.
//   2. flex-gap probe (<84) -> html.no-flex-gap class; src/legacy-compat.css
//      re-creates the Tailwind gap utilities with margins under that class.
//   3. stylesheet health on window load: at least one same-origin sheet with
//      rules, else the same fatal screen.
// Leaflet failures report through reportLeafletLoadFailure() (wired into
// LeafletMap's script onerror). Uncaught errors/rejections go through
// installGlobalErrorScreens() — nothing dies silently.
//
// Telemetry: the driver heartbeat socket event carries NO payload fields
// (backend.ts `driver:heartbeat`) and the server contract must not change in
// this fix — so the WebView version is LOGGED at boot (logcat-visible) and
// mirrored into localStorage['vura.webview'] for field debugging.
// ─────────────────────────────────────────────────────────────────────────────
export const MIN_WEBVIEW_CHROME_MAJOR = 70

/** Pure: Chrome/Chromium major version from a UA string, else null. */
export function chromeMajorFromUA(ua: string): number | null {
  const m = /Chrome\/(\d+)\./.exec(ua || '')
  return m ? parseInt(m[1], 10) : null
}

/** Flex `gap` landed in Chrome 84 — probe it for real, don't sniff the UA. */
export function detectFlexGapSupport(doc: Document = document): boolean {
  try {
    const d = doc.createElement('div')
    d.style.cssText = 'display:flex;gap:1px;position:absolute;visibility:hidden'
    const a = doc.createElement('div')
    a.style.cssText = 'width:10px;height:10px'
    const b = doc.createElement('div')
    b.style.cssText = 'width:10px;height:10px'
    d.appendChild(a)
    d.appendChild(b)
    ;(doc.body || doc.documentElement).appendChild(d)
    const ok = b.offsetLeft > a.offsetLeft
    if (d.parentNode) d.parentNode.removeChild(d)
    return ok
  } catch {
    return false
  }
}

let fatalShown = false

/**
 * Full-screen, inline-styled message that works with EVERY stylesheet dead.
 * Idempotent: the first fatal wins (no stacking, no error loops).
 */
export function showFatalScreen(title: string, detail: string): void {
  if (fatalShown || typeof document === 'undefined') return
  fatalShown = true
  try {
    const overlay = document.createElement('div')
    overlay.setAttribute('data-vura-guard', '1')
    // NO `inset` shorthand (<87) — explicit sides.
    overlay.style.cssText =
      'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;' +
      'background:#ffffff;color:#1a1a1a;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;text-align:center;' +
      'padding:32px 28px;font-family:Roboto,Helvetica,Arial,sans-serif'
    const h = document.createElement('div')
    h.textContent = title
    h.style.cssText = 'font-size:20px;font-weight:700;line-height:1.35;margin-bottom:14px'
    const p = document.createElement('div')
    p.textContent = detail
    p.style.cssText = 'font-size:14px;line-height:1.5;color:#4a4a4a;max-width:420px'
    overlay.appendChild(h)
    overlay.appendChild(p)
    const btn = document.createElement('button')
    btn.textContent = 'Reload'
    btn.style.cssText =
      'margin-top:22px;padding:12px 30px;border:0;border-radius:10px;background:#EA4335;' +
      'color:#fff;font-size:15px;font-weight:700'
    btn.onclick = () => location.reload()
    overlay.appendChild(btn)
    ;(document.body || document.documentElement).appendChild(overlay)
  } catch {
    /* never throw out of the guard */
  }
}

/** Leaflet script failed to load (wired from LeafletMap's onerror). */
export function reportLeafletLoadFailure(): void {
  showFatalScreen(
    'Map failed to load',
    'The map engine could not load. Please update Android System WebView / Chrome, then reopen Vura Rider.',
  )
}

/**
 * Boot gate. Returns ok=false when a fatal screen is up — the caller must NOT
 * mount the app in that case.
 */
export function installWebviewGuard(win: Window = window, doc: Document = document): { ok: boolean } {
  // Flex-gap fallback class (design unchanged on capable engines).
  try {
    doc.documentElement.classList.toggle('no-flex-gap', !detectFlexGapSupport(doc))
  } catch {
    /* classList unavailable → nothing to toggle */
  }

  const major = chromeMajorFromUA(win.navigator.userAgent)
  // Log-only telemetry (heartbeat carries no fields — server contract frozen).
  console.log(`[vura] WebView Chrome major=${major === null ? 'unknown' : major} (min ${MIN_WEBVIEW_CHROME_MAJOR})`)
  try {
    const store = (win as any).localStorage
    if (store) store.setItem('vura.webview', major === null ? '' : String(major))
  } catch {
    /* storage full — debug nicety only */
  }

  if (major !== null && major < MIN_WEBVIEW_CHROME_MAJOR) {
    showFatalScreen(
      'Please update Android System WebView / Chrome',
      `Detected Chrome ${major}; this app needs Android System WebView ${MIN_WEBVIEW_CHROME_MAJOR} or newer. ` +
        'Update "Android System WebView" (or Chrome) from your app store, then reopen Vura Rider.',
    )
    return { ok: false }
  }

  // Stylesheet health — after load, give links time to parse.
  const checkStylesheets = () => {
    try {
      let ok = false
      const sheets = doc.styleSheets
      for (let i = 0; i < sheets.length; i++) {
        try {
          if (sheets[i].cssRules && sheets[i].cssRules.length > 0) {
            ok = true
            break
          }
        } catch {
          // Cross-origin sheet: presence without an exception means it loaded.
          ok = true
          break
        }
      }
      if (!ok) {
        showFatalScreen(
          'Styles failed to load',
          'The app stylesheet is missing or empty. Please update Android System WebView / Chrome and reopen Vura Rider.',
        )
      }
    } catch {
      /* defensive */
    }
  }
  if (doc.readyState === 'complete') setTimeout(checkStylesheets, 0)
  else win.addEventListener('load', () => setTimeout(checkStylesheets, 0))

  return { ok: true }
}

/** Uncaught errors / rejections → readable screen, never a silent white page. */
export function installGlobalErrorScreens(win: Window = window): void {
  win.addEventListener('error', (ev: ErrorEvent) => {
    // Resource load errors surface here with no message; only script errors.
    if (ev && ev.message) {
      showFatalScreen('Something went wrong', String(ev.message).slice(0, 240))
    }
  })
  win.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const reason: any = (ev as any)?.reason
    const msg = (reason && (reason.message || String(reason))) || 'Unknown error'
    showFatalScreen('Something went wrong', String(msg).slice(0, 240))
  })
}
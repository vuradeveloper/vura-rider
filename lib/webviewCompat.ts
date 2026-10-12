// ─────────────────────────────────────────────────────────────────────────────
// webviewCompat — the rider app's OLD-WEBVIEW contract, same floor as the
// driver app's fix/old-webview-compat branch (Chrome/Android 70).
//
// The rider app itself is React Native (Hermes compiles it — the Android
// System WebView version is irrelevant for the native screens). The WebView is
// used in three places, and THIS module governs them:
//   1. The map (components/MapView.native.tsx loads lib/mapHtml.ts HTML with
//      bundled Leaflet 1.9.4) — guarded by MAP_PAGE_GUARD_JS (below): an old
//      engine gets a plain "Please update Android System WebView" screen
//      (with the detected version) instead of a broken map, and the version is
//      posted to React Native, which overlays the same guidance natively.
//   2. Paystack checkout (components/PaymentWebView.tsx) — an external page;
//      the app shows its error screen with an update hint (nothing local to
//      downlevel — the page itself is Paystack's).
//   3. Nothing else — everything else is Hermes-compiled native JS.
// Guaranteed minimum: Android System WebView / Chrome 70. Below that the app
// never shows a broken UI — it shows the update screen instead.
// ─────────────────────────────────────────────────────────────────────────────

/** Same floor as the driver app (vite target chrome70 + webviewGuard). */
export const MIN_WEBVIEW_CHROME_MAJOR = 70

/** Pure: Chrome/Chromium major version from a UA string, else null. */
export function chromeMajorFromUA(ua: string): number | null {
  const m = /Chrome\/(\d+)\./.exec(ua || "");
  return m ? parseInt(m[1], 10) : null;
}

/** True when the UA is parseable AND below the floor. Unknown UA → false (the
 *  page-side baseline-API check is the second net). */
export function webviewTooOld(ua: string): boolean {
  const major = chromeMajorFromUA(ua);
  return major !== null && major < MIN_WEBVIEW_CHROME_MAJOR;
}

/**
 * FIRST script of the map page — ES3-safe on purpose (it must run on the very
 * engines it is judging). Sets window.__VURA_WV_OK and posts the detected
 * version to React Native when the engine is below the floor.
 */
export const MAP_PAGE_GUARD_JS = `(function(){
  try {
    var ua = navigator.userAgent || '';
    var m = /Chrome\\/(\\d+)\\./.exec(ua);
    var major = m ? parseInt(m[1], 10) : 0;
    var ok = major >= ${MIN_WEBVIEW_CHROME_MAJOR};
    if (!ok && major === 0) {
      ok = !!(window.Promise && window.Map && window.URL && window.XMLHttpRequest && window.requestAnimationFrame);
    }
    window.__VURA_WV_OK = ok;
    if (!ok && window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'webview-too-old', version: m ? m[1] : 'unknown' }));
    }
  } catch (e) {
    window.__VURA_WV_OK = true;
  }
})();`

// Notice copy — ONE source of truth for both the TS-side string and the
// in-page ES5 function (a drift test in webviewCompat.test.ts pins them).
const NOTICE_STYLE =
  'position:fixed;top:0;left:0;right:0;bottom:0;background:#ffffff;color:#1a1a1a;' +
  'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
  'text-align:center;padding:32px 28px;font-family:Roboto,Helvetica,Arial,sans-serif'
const NOTICE_TITLE_STYLE = 'font-size:20px;font-weight:700;line-height:1.35;margin-bottom:14px'
const NOTICE_BODY_STYLE = 'font-size:14px;line-height:1.5;color:#4a4a4a;max-width:420px'
const NOTICE_TITLE = 'Please update Android System WebView'
function noticeBody(detected: string): string {
  return (
    `The map needs Android System WebView (or Chrome) version ${MIN_WEBVIEW_CHROME_MAJOR} or newer. ` +
    `This device reports version ${detected}. Update it from the Play Store, Huawei AppGallery or a ` +
    `system update, then reopen Vura.`
  )
}

/**
 * Plain-HTML update screen — inline styles only (no stylesheet, no `inset`
 * shorthand, no flex-gap, no modern CSS) so it renders with EVERY stylesheet
 * feature dead. `detected` is shown verbatim so support can see the field
 * version. Used by the map page loader AND for tests.
 */
export function updateScreenHtml(detected: string): string {
  return (
    `<div style="${NOTICE_STYLE}">` +
    `<div style="${NOTICE_TITLE_STYLE}">${NOTICE_TITLE}</div>` +
    `<div style="${NOTICE_BODY_STYLE}">${noticeBody(detected)}</div>` +
    `</div>`
  )
}

/**
 * The SAME notice as ES5 function source, embedded into the map page's loader
 * so an old engine paints it with no stylesheet and no bundler involved.
 */
export const UPDATE_SCREEN_FN_JS =
  'function(v){return \'<div style="' +
  NOTICE_STYLE +
  '"><div style="' +
  NOTICE_TITLE_STYLE +
  '">' +
  NOTICE_TITLE +
  '</div><div style="' +
  NOTICE_BODY_STYLE +
  '">The map needs Android System WebView (or Chrome) version ' +
  MIN_WEBVIEW_CHROME_MAJOR +
  ' or newer. This device reports version \' + v + \'. Update it from the Play Store, Huawei AppGallery or a system update, then reopen Vura.</div></div>\';}'
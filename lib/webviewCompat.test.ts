// ─────────────────────────────────────────────────────────────────────────────
// webviewCompat.test.ts — the rider repo's OLD-WEBVIEW SCAN GATE (node --test).
//
// Part 1 pins the guard contract (UA parsing, floor, notice copy).
// Part 2 is the (b) "reproduce from code" scan: every payload that ships INTO
// the map WebView (bundled Leaflet 1.9.4 JS + CSS, and all page-side code in
// lib/mapHtml.ts) is scanned for the features old WebViews cannot PARSE (JS)
// or would SILENTLY DISCARD (CSS) — the exact regressions that broke the
// driver app on Huawei. Zero tolerance: any hit fails the test.
//
// Run: npm run test:webview   (node --test lib/webviewCompat.test.ts)
// ─────────────────────────────────────────────────────────────────────────────
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAP_PAGE_GUARD_JS,
  MIN_WEBVIEW_CHROME_MAJOR,
  UPDATE_SCREEN_FN_JS,
  chromeMajorFromUA,
  updateScreenHtml,
  webviewTooOld,
} from "./webviewCompat.ts";

// ── banned-feature lists (same contract as the driver's scan-legacy-compat) ──

const BANNED_JS: Array<[string, RegExp]> = [
  ["optional chaining ?.", /(?:[\w)\]"'])\?\.(?!\d)/g],
  ["nullish coalescing ??", /\?\?/g],
  // Real private-field syntax only — `this.#x` or a statement-level `#x =`.
  // A plain /#[A-Za-z_]\w*/ check false-positives on CSS hex colours (#fff;)
  // and id selectors (#map {) that legitimately live inside the page strings.
  ["private class fields #x", /(?:\.#[A-Za-z_]\w*|(?:^|[\s;{])#[A-Za-z_]\w*\s*=)/g],
  ["static { } blocks", /\bstatic\s*\{/g],
];
const BANNED_CSS: Array<[string, RegExp]> = [
  ["@layer", /@layer[\s;{]/],
  [":is(", /:is\(/],
  [":where(", /:where\(/],
  [":has(", /:has\(/],
  ["inset shorthand", /(?:^|[;{\s])inset:/],
  ["@container at-rule", /(?:^|[;}{\n])\s*@container[\s{]/],
  ["@scope at-rule", /(?:^|[;}{\n])\s*@scope[\s{]/],
  ["media range syntax", /@media[^{]*[<>]=?/],
  ["color-mix()", /color-mix\(/],
  ["oklch()", /oklch\(/],
];

function scanJs(name: string, src: string): void {
  for (const [label, re] of BANNED_JS) {
    const hits = [...src.matchAll(new RegExp(re.source, "g"))].length;
    assert.equal(hits, 0, `${name}: ${label} found ${hits}x`);
  }
}

function scanCss(name: string, src: string): void {
  for (const [label, re] of BANNED_CSS) {
    const hits = [...src.matchAll(new RegExp(re.source, "g"))].length;
    assert.equal(hits, 0, `${name}: ${label} found ${hits}x`);
  }
}

/** Same pure base64 decoder lib/leafletBundle.ts uses (no Buffer/atob needed). */
function b64decode(b64: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = b64.replace(/=+$/, "");
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = alphabet.indexOf(clean[i]);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

// ── Part 1: guard contract ──────────────────────────────────────────────────

test("chromeMajorFromUA: parses the WebView/Chrome UAs that matter in the field", () => {
  // Typical Huawei EMUI 9-10 System WebView (the incident device class).
  assert.equal(
    chromeMajorFromUA(
      "Mozilla/5.0 (Linux; Android 9; LRA-LX2 Build/HUAWEILRA-LX2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/66.0.3359.139 Mobile Safari/537.36",
    ),
    66,
  );
  // Modern WebView.
  assert.equal(
    chromeMajorFromUA(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36",
    ),
    120,
  );
  assert.equal(chromeMajorFromUA("Mozilla/5.0 (Linux; Android 11) Chrome/91.0.4472.77"), 91);
  assert.equal(chromeMajorFromUA("Mozilla/5.0 (Linux; Android 4.4.2)"), null);
  assert.equal(chromeMajorFromUA(""), null);
});

test("MIN_WEBVIEW_CHROME_MAJOR matches the driver app's floor (chrome70)", () => {
  assert.equal(MIN_WEBVIEW_CHROME_MAJOR, 70);
});

test("webviewTooOld: below the floor → true; at/above or unknown → false", () => {
  assert.equal(webviewTooOld("Chrome/66.0.3359.139 Mobile"), true);
  assert.equal(webviewTooOld("Chrome/70.0.3538.80 Mobile"), false);
  assert.equal(webviewTooOld("Chrome/120.0.0.0 Mobile"), false);
  assert.equal(webviewTooOld("Mozilla/5.0 (Linux; Android 4.4.2)"), false);
});

test("MAP_PAGE_GUARD_JS: ES3-safe — zero banned tokens, carries the floor", () => {
  scanJs("MAP_PAGE_GUARD_JS", MAP_PAGE_GUARD_JS);
  assert.ok(MAP_PAGE_GUARD_JS.includes(">= 70"));
  assert.ok(MAP_PAGE_GUARD_JS.includes("webview-too-old"));
});

test("updateScreenHtml: shows the detected version + floor, zero banned tokens", () => {
  const html = updateScreenHtml("66");
  assert.ok(html.includes("Please update Android System WebView"));
  assert.ok(html.includes("version 70"));
  assert.ok(html.includes("reports version 66"));
  assert.ok(html.includes("AppGallery"));
  scanJs("updateScreenHtml", html);
  scanCss("updateScreenHtml", html);
});

test("notice copy: the in-page ES5 function and the TS string cannot drift", () => {
  scanJs("UPDATE_SCREEN_FN_JS", UPDATE_SCREEN_FN_JS);
  assert.ok(UPDATE_SCREEN_FN_JS.includes("Please update Android System WebView"));
  assert.ok(UPDATE_SCREEN_FN_JS.includes("AppGallery"));
  assert.ok(UPDATE_SCREEN_FN_JS.includes(String(MIN_WEBVIEW_CHROME_MAJOR)));
});

// ── Part 2: scan every payload that ships INTO the map WebView ──────────────

function leafletPayloads(): { js: string; css: string } {
  const src = readFileSync(new URL("./leafletBundle.ts", import.meta.url), "utf8");
  const b64s = [...src.matchAll(/decodeB64\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.equal(b64s.length, 2, "expected LEAFLET_JS + LEAFLET_CSS base64 payloads");
  return { js: b64decode(b64s[0]), css: b64decode(b64s[1]) };
}

test("bundled Leaflet 1.9.4 JS: no banned JS features (Chrome/70 parses it)", () => {
  const { js } = leafletPayloads();
  assert.ok(js.includes("Leaflet 1.9.4"), "decoded payload should be Leaflet JS");
  scanJs("LEAFLET_JS", js);
});

test("bundled Leaflet CSS: no banned CSS features (old engines discard those)", () => {
  const { css } = leafletPayloads();
  scanCss("LEAFLET_CSS", css);
});

test("lib/mapHtml.ts page code: no banned JS or CSS features anywhere", () => {
  const src = readFileSync(new URL("./mapHtml.ts", import.meta.url), "utf8");
  // The TS file's own code is Hermes-side, but scanning it too keeps the gate
  // simple and catches page-string regressions at the source level.
  scanJs("mapHtml.ts", src);
  scanCss("mapHtml.ts", src);
});
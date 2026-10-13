import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MIN_WEBVIEW_CHROME_MAJOR,
  chromeMajorFromUA,
} from './webviewGuard.ts'

test('chromeMajorFromUA: parses the WebView/Chrome UAs that matter in the field', () => {
  // Typical Huawei EMUI 9-10 System WebView (the incident device class).
  assert.equal(
    chromeMajorFromUA(
      'Mozilla/5.0 (Linux; Android 9; LRA-LX2 Build/HUAWEILRA-LX2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/66.0.3359.139 Mobile Safari/537.36',
    ),
    66,
  )
  // Modern Pixel-style WebView.
  assert.equal(
    chromeMajorFromUA(
      'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36',
    ),
    120,
  )
  // Plain Chrome (no wv marker) — still parseable.
  assert.equal(chromeMajorFromUA('Mozilla/5.0 (Linux; Android 11) Chrome/91.0.4472.77'), 91)
  // No Chrome token at all (old WebView/UC/quirk) → null: the guard treats
  // unknown as "maybe fine" and lets the stylesheet + error screens catch it.
  assert.equal(chromeMajorFromUA('Mozilla/5.0 (Linux; Android 4.4.2)'), null)
  assert.equal(chromeMajorFromUA(''), null)
})

test('MIN_WEBVIEW_CHROME_MAJOR matches the build floor (vite target chrome70)', () => {
  assert.equal(MIN_WEBVIEW_CHROME_MAJOR, 70)
})
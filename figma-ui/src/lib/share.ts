// Shared clipboard + native share-sheet helpers for the rider app.
//
// The Android WebView frequently rejects navigator.clipboard and has no
// navigator.share, which is why "Copy link" could claim success while the
// clipboard stayed empty and no share chooser opened. ShareLink is the app's
// own small Capacitor plugin (Java 17) that writes the real Android clipboard
// and opens the ACTION_SEND chooser.
import { Capacitor, registerPlugin } from '@capacitor/core'

type ShareLinkPlugin = {
  copy(options: { text: string }): Promise<{ copied: boolean; error?: string }>
  share(options: { url: string; title?: string; text?: string }): Promise<{ shared: boolean; error?: string }>
  exitApp(): Promise<void>
}

const ShareLink = registerPlugin<ShareLinkPlugin>('ShareLink')

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      const res = await ShareLink.copy({ text })
      return res?.copied === true
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export async function openShareSheet(url: string): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      const res = await ShareLink.share({
        url,
        title: 'Track my Vura ride',
        text: 'Follow my trip live:',
      })
      return res?.shared === true
    }
    const nav: any = navigator
    if (typeof nav?.share === 'function') {
      await nav.share({ title: 'Track my Vura ride', text: 'Follow my trip live:', url })
      return true
    }
  } catch {
    /* user dismissed the chooser, or no share target is installed */
  }
  return false
}

/**
 * Close the Android task. Used by the maintenance lock: a rider who was
 * signed in is logged out and the app is closed immediately; the next launch
 * shows the landing page with Login/Create account disabled.
 */
export async function closeApp(): Promise<void> {
  try {
    if (Capacitor.isNativePlatform()) {
      await ShareLink.exitApp()
      return
    }
    window.close()
  } catch {
    /* the landing page is still shown if the native close is unavailable */
  }
}

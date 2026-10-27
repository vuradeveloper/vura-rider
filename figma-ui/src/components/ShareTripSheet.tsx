import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { API_URL, on, shareTrip, shareTripLink } from '../lib/backend'

/**
 * ShareTripSheet — the real Share Trip flow.
 *
 * The old button emitted `share:generate` and showed "Trip link shared" without
 * ever giving the rider a link, so nothing could actually be shared. This sheet
 * mints the public tracking link (REST, with the socket event as a fallback) and
 * hands it to the phone's share targets: WhatsApp, Telegram, Facebook, X, SMS,
 * email, clipboard or the native share sheet.
 *
 * The link is minted fresh each time the sheet opens: a stale token from an old
 * trip must never be shared by mistake.
 */

function toAbsolute(raw: string): string {
  const u = String(raw || '').trim()
  if (!u) return ''
  if (/^https?:\/\//i.test(u)) return u
  return API_URL.replace(/\/$/, '') + (u.startsWith('/') ? '' : '/') + u
}

const SHARE_TEXT = 'Follow my Vura trip live — tap the link to see where I am:'

type Target = {
  id: string
  label: string
  bg: string
  fg: string
  icon: ReactNode
  href?: (url: string) => string
}

const targets: Target[] = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    bg: '#25D366',
    fg: '#FFFFFF',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 004.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0012.04 2zm0 18.15h-.01a8.2 8.2 0 01-4.18-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 01-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 012.41 5.82c0 4.54-3.7 8.23-8.23 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.12-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.12-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.12-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.14-1.18-.06-.1-.22-.16-.47-.28z" />
      </svg>
    ),
    href: (url) => `https://wa.me/?text=${encodeURIComponent(`${SHARE_TEXT}\n${url}`)}`,
  },
  {
    id: 'telegram',
    label: 'Telegram',
    bg: '#229ED9',
    fg: '#FFFFFF',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        <path d="M21.9 4.3l-3.1 14.6c-.2 1-.8 1.2-1.7.8l-4.6-3.4-2.2 2.1c-.2.2-.5.5-1 .5l.3-4.7 8.5-7.7c.4-.3-.1-.5-.6-.2L7.1 12.5 2.6 11c-1-.3-1-1 .2-1.5L20.5 2.7c.8-.3 1.5.2 1.4 1.6z" />
      </svg>
    ),
    href: (url) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(SHARE_TEXT)}`,
  },
  {
    id: 'facebook',
    label: 'Facebook',
    bg: '#1877F2',
    fg: '#FFFFFF',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        <path d="M13.5 22v-8h2.7l.4-3.2h-3.1V8.7c0-.9.3-1.6 1.6-1.6h1.7V4.2c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.4H7.4V14h2.7v8h3.4z" />
      </svg>
    ),
    href: (url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  },
  {
    id: 'x',
    label: 'X',
    bg: '#111111',
    fg: '#FFFFFF',
    icon: (
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
        <path d="M17.5 3h3l-6.6 7.6L21.8 21h-6.1l-4.8-6.3L5.4 21h-3l7.1-8.1L2.5 3h6.2l4.3 5.7L17.5 3zm-1.1 16.2h1.7L7.7 4.7H5.9l10.5 14.5z" />
      </svg>
    ),
    href: (url) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(SHARE_TEXT)}`,
  },
  {
    id: 'sms',
    label: 'SMS',
    bg: '#34A853',
    fg: '#FFFFFF',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.4 8.4 0 01-9 8.4 8.9 8.9 0 01-4-.9L3 21l1.9-4.9a8.4 8.4 0 01-.9-3.8 8.4 8.4 0 018.5-8.4 8.4 8.4 0 018.5 8.4z" />
      </svg>
    ),
    href: (url) => `sms:?&body=${encodeURIComponent(`${SHARE_TEXT} ${url}`)}`,
  },
  {
    id: 'email',
    label: 'Email',
    bg: '#EA4335',
    fg: '#FFFFFF',
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 6 9-6" />
      </svg>
    ),
    href: (url) => `mailto:?subject=${encodeURIComponent('Follow my Vura trip')}&body=${encodeURIComponent(`${SHARE_TEXT}\n\n${url}`)}`,
  },
]

function openScheme(url: string) {
  // sms: / mailto: are not http(s), so Capacitor's Browser plugin cannot open
  // them; assigning location is the reliable path on both Android and iOS.
  try {
    window.location.href = url
  } catch {
    /* nothing else to try */
  }
}

export default function ShareTripSheet({
  open,
  rideId,
  onClose,
}: {
  open: boolean
  rideId: string | null
  onClose: () => void
}) {
  const [link, setLink] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [attempt, setAttempt] = useState(0)
  const [copied, setCopied] = useState(false)
  const [toast, setToast] = useState('')

  useEffect(() => {
    if (!open || !rideId) return
    let alive = true
    let offShare: (() => void) | null = null
    let timer: number | undefined

    setLink('')
    setStatus('loading')
    setCopied(false)
    setToast('')

    const finish = (raw: string) => {
      if (!alive) return
      const url = toAbsolute(raw)
      if (!url) return
      setLink(url)
      setStatus('ready')
      if (offShare) { offShare(); offShare = null }
      if (timer) { window.clearTimeout(timer); timer = undefined }
    }

    // Socket fallback: subscribe BEFORE asking so the reply can never race us.
    offShare = on('share:generated', (d: any) => {
      if (String(d?.rideId || '') !== String(rideId)) return
      if (d?.shareUrl) finish(String(d.shareUrl))
    })

    void (async () => {
      // REST is the primary path: it persists the token and returns an absolute
      // https URL. The socket event only knows a relative path and can be lost
      // if this socket missed the ride room after a reconnect.
      try {
        const r = await shareTripLink(rideId)
        if (alive && r?.shareUrl) { finish(r.shareUrl); return }
      } catch {
        /* fall through to the socket */
      }
      if (!alive) return
      void shareTrip(rideId).catch(() => undefined)
      timer = window.setTimeout(() => {
        if (alive) setStatus((s) => (s === 'loading' ? 'error' : s))
      }, 9000)
    })()

    return () => {
      alive = false
      if (offShare) offShare()
      if (timer) window.clearTimeout(timer)
    }
  }, [open, rideId, attempt])

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setToast('Link copied')
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Older WebViews have no clipboard API — use a hidden textarea.
      try {
        const ta = document.createElement('textarea')
        ta.value = link
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
        setCopied(true)
        setToast('Link copied')
        window.setTimeout(() => setCopied(false), 1800)
      } catch {
        setToast('Could not copy — press and hold the link instead')
      }
    }
  }

  function shareTarget(t: Target) {
    if (!link || !t.href) return
    openScheme(t.href(link))
  }

  async function nativeShare() {
    if (!link) return
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
    if (nav.share) {
      try {
        await nav.share({ title: 'Follow my Vura trip', text: SHARE_TEXT, url: link })
        return
      } catch {
        /* the rider dismissed the sheet — fall back to copying */
      }
    }
    await copy()
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/40 flex items-end"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full bg-white rounded-t-3xl p-5 pb-8 max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Share your trip"
      >
        <div className="w-8 h-1 bg-[#E8E8E8] rounded-full mx-auto mb-4" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-bold text-[#1A1A1A]">Share your trip</h2>
            <p className="text-[12px] text-[#6B6B6B] mt-1 leading-relaxed">
              Send a live link so someone can follow your ride and see when you arrive.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 w-8 h-8 rounded-full bg-[#F7F7F7] text-[#6B6B6B] text-[18px] leading-none active:bg-[#EBEBEB]"
          >
            ×
          </button>
        </div>

        {status === 'loading' && (
          <div className="flex items-center gap-2.5 bg-[#F7F7F7] rounded-2xl px-4 py-3.5 mt-4">
            <span className="w-4 h-4 rounded-full border-2 border-[#EA4335]/30 border-t-[#EA4335] animate-spin" />
            <p className="text-[13px] text-[#6B6B6B] font-medium">Creating your trip link…</p>
          </div>
        )}

        {status === 'error' && (
          <div className="bg-[#FEF0EF] border border-[#F5C6C2] rounded-2xl px-4 py-3.5 mt-4">
            <p className="text-[13px] font-semibold text-[#C5221F]">Couldn't create the link</p>
            <p className="text-[12px] text-[#7A2E28] mt-0.5">Check your connection and try again.</p>
            <button
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-2.5 text-[13px] font-bold text-[#C5221F] underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        )}

        {status === 'ready' && (
          <>
            <div className="flex items-center gap-2 bg-[#F7F7F7] border border-[#EBEBEB] rounded-2xl px-3.5 py-3 mt-4">
              <p className="flex-1 min-w-0 text-[12px] text-[#4A4A4A] font-medium truncate" title={link}>
                {link}
              </p>
              <button
                onClick={() => void copy()}
                className={`shrink-0 text-[12px] font-bold px-3 py-1.5 rounded-lg active:opacity-70 ${copied ? 'bg-[#E6F4EA] text-[#137333]' : 'bg-white border border-[#EBEBEB] text-[#1A1A1A]'}`}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <div className="grid grid-cols-4 gap-x-2 gap-y-4 mt-5">
              {targets.map((t) => (
                <button
                  key={t.id}
                  onClick={() => shareTarget(t)}
                  className="flex flex-col items-center gap-1.5 active:opacity-70"
                  aria-label={`Share on ${t.label}`}
                >
                  <span
                    className="w-12 h-12 rounded-full flex items-center justify-center"
                    style={{ background: t.bg, color: t.fg }}
                  >
                    {t.icon}
                  </span>
                  <span className="text-[11px] font-semibold text-[#4A4A4A]">{t.label}</span>
                </button>
              ))}
              <button onClick={() => void copy()} className="flex flex-col items-center gap-1.5 active:opacity-70" aria-label="Copy link">
                <span className="w-12 h-12 rounded-full flex items-center justify-center bg-[#F2F2F2] text-[#1A1A1A]">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <rect x="9" y="9" width="12" height="12" rx="2" />
                    <path d="M5 15V5a2 2 0 012-2h10" />
                  </svg>
                </span>
                <span className="text-[11px] font-semibold text-[#4A4A4A]">{copied ? 'Copied' : 'Copy link'}</span>
              </button>
              <button onClick={() => void nativeShare()} className="flex flex-col items-center gap-1.5 active:opacity-70" aria-label="More sharing options">
                <span className="w-12 h-12 rounded-full flex items-center justify-center bg-[#F2F2F2] text-[#1A1A1A]">
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <circle cx="18" cy="5" r="3" />
                    <circle cx="6" cy="12" r="3" />
                    <circle cx="18" cy="19" r="3" />
                    <path d="M8.6 10.7l6.8-3.4M8.6 13.3l6.8 3.4" />
                  </svg>
                </span>
                <span className="text-[11px] font-semibold text-[#4A4A4A]">More</span>
              </button>
            </div>

            <p className="text-[11px] text-[#ADADAD] mt-5 leading-relaxed">
              The link stays live while this trip is in progress. Stop sharing any time from Safety.
            </p>
          </>
        )}

        {toast && <p className="text-center text-[12px] font-semibold text-[#137333] mt-3">{toast}</p>}
      </div>
    </div>
  )
}

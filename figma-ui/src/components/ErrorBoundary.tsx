import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

/**
 * Turns a crash into a readable message instead of a blank white page.
 *
 * Why this exists: when a render throws, React unmounts the WHOLE tree — in a
 * Capacitor WebView that is an empty white screen with nothing on it to tell a
 * bug from a dead battery. Reported from the field on 27 Sep 2026 ("after I
 * choose a location, the page with the prices just turns white") and there was
 * literally nothing on screen to diagnose.
 *
 * This shows the error text, the stack, the screen and the device, keeps the
 * last few crashes in localStorage (`vura.lastCrash`) and offers Reload +
 * Continue so a rider or driver is never stuck on a dead screen.
 *
 * Every caught error is also POSTed to the server's device-log sink when a write
 * key is baked in at build time (`VITE_DEVLOG_KEY`), so the same message can be
 * read from ops without asking anyone for a screenshot. Without the key the
 * reporting is silently skipped — the on-screen report still works.
 */

type Props = { children: ReactNode; app?: 'rider' | 'driver' }
type State = { error: Error | null; where: string }

const DEVLOG_KEY = (import.meta as any).env?.VITE_DEVLOG_KEY as string | undefined
const DEVLOG_URL = 'https://api.ridevura.com/api/dev/logs'

function deviceId() {
  try {
    const k = 'vura.deviceId'
    let v = localStorage.getItem(k)
    if (!v) {
      v = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
      localStorage.setItem(k, v)
    }
    return v
  } catch { return 'unknown' }
}

function report(app: string, err: Error, where: string) {
  const entry = {
    app,
    deviceId: deviceId(),
    level: 'error',
    tag: 'app-crash',
    message: `${err?.name || 'Error'}: ${err?.message || String(err)}`.slice(0, 2000),
    data: { where, stack: (err?.stack || '').slice(0, 4000), ua: navigator.userAgent, at: new Date().toISOString() },
  }
  // Keep it locally too — the phone may be offline when this fires.
  try {
    const prev = JSON.parse(localStorage.getItem('vura.lastCrash') || '[]')
    localStorage.setItem('vura.lastCrash', JSON.stringify([entry, ...prev].slice(0, 5)))
  } catch { /* storage full or unavailable */ }
  if (!DEVLOG_KEY) return
  try {
    fetch(DEVLOG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-dev-log-key': DEVLOG_KEY },
      body: JSON.stringify({ entries: [entry] }),
      keepalive: true,
    }).catch(() => { /* never let reporting throw */ })
  } catch { /* ignore */ }
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, where: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const where = (info?.componentStack || '').trim().split('\n').slice(0, 6).join('\n')
    this.setState({ where })
    report(this.props.app || 'rider', error, where)
  }

  render() {
    const { error, where } = this.state
    if (!error) return this.props.children

    const msg = error?.message || String(error)
    return (
      <div className="min-h-screen bg-[#F7F7F7] flex flex-col">
        <div className="bg-white border-b border-[#F2F2F2] px-5 pt-14 pb-4">
          <h1 className="text-[20px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            Something went wrong
          </h1>
          <p className="text-[12px] text-[#6B6B6B] mt-1">
            This screen hit an error instead of loading. The details below are enough to fix it —
            Reload usually gets you moving again.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <div className="bg-white rounded-2xl border border-[#F5C6C2] p-4">
            <p className="text-[10px] uppercase tracking-widest text-[#C5221F] font-bold">Error</p>
            <p className="text-[13px] text-[#1A1A1A] font-semibold mt-1.5" style={{ wordBreak: 'break-word' }}>
              {msg}
            </p>
            {!!where && (
              <>
                <p className="text-[10px] uppercase tracking-widest text-[#ADADAD] font-bold mt-4">Where</p>
                <pre className="text-[10px] text-[#4A4A4A] mt-1.5 whitespace-pre-wrap" style={{ wordBreak: 'break-word' }}>
                  {where}
                </pre>
              </>
            )}
            <p className="text-[10px] uppercase tracking-widest text-[#ADADAD] font-bold mt-4">Stack</p>
            <pre className="text-[10px] text-[#6B6B6B] mt-1.5 whitespace-pre-wrap" style={{ wordBreak: 'break-word' }}>
              {(error?.stack || 'no stack').slice(0, 1200)}
            </pre>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={() => window.location.reload()}
              className="flex-1 bg-[#EA4335] active:bg-[#C5221F] text-white font-semibold text-[14px] py-3.5 rounded-2xl"
            >
              Reload
            </button>
            <button
              onClick={() => this.setState({ error: null, where: '' })}
              className="flex-1 border border-[#EBEBEB] bg-white text-[#1A1A1A] font-semibold text-[14px] py-3.5 rounded-2xl active:bg-[#F7F7F7]"
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    )
  }
}

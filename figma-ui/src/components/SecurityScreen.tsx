import { useEffect, useState } from 'react'
import { Header } from './SettingsScreen'
import {
  DeviceSession,
  SecurityEvent,
  SecurityStatus,
  disableTwoFactor,
  enableTwoFactor,
  getDeviceSessions,
  getSecurityActivity,
  getSecurityStatus,
  regenerateRecoveryCodes,
  revokeAllDeviceSessions,
  revokeDeviceSession,
  signOut,
  startTwoFactorSetup,
} from '../lib/backend'

/**
 * Account → Settings → Security & devices.
 *
 * Everything here talks to the real server: authenticator-app 2FA with
 * recovery codes, the live device list, remote sign-out and the security
 * activity log. No local-only toggles.
 */

const EVENT_LABELS: Record<string, string> = {
  new_device_sign_in: 'New device signed in',
  device_signed_out: 'Device signed out',
  all_sessions_revoked: 'All devices signed out',
  '2fa_enabled': 'Two-factor authentication turned on',
  '2fa_disabled': 'Two-factor authentication turned off',
  '2fa_recovery_code_used': 'Recovery code used',
  '2fa_recovery_codes_regenerated': 'Recovery codes regenerated',
  '2fa_reset_by_support': '2FA reset by Vura support',
  email_changed: 'Account email changed',
}

function when(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} hr ago`
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
}

function deviceLabel(s: DeviceSession): string {
  return s.device_name || (s.platform === 'android' ? 'Android device' : s.platform === 'ios' ? 'iPhone' : 'Vura')
}

function statusPill(on: boolean) {
  return on
    ? 'bg-[#E6F4EA] text-[#137333]'
    : 'bg-[#FCE8E6] text-[#C5221F]'
}

function formatSecret(secret: string): string {
  return String(secret || '').replace(/(.{4})/g, '$1 ').trim()
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}

export default function SecurityScreen({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<SecurityStatus | null>(null)
  const [sessions, setSessions] = useState<DeviceSession[]>([])
  const [events, setEvents] = useState<SecurityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [view, setView] = useState<'main' | 'setup' | 'recovery' | 'disable' | 'regenerate'>('main')
  const [secret, setSecret] = useState('')
  const [otpauth, setOtpauth] = useState('')
  const [code, setCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [savedCodes, setSavedCodes] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [confirmAll, setConfirmAll] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [s, d, a] = await Promise.all([
        getSecurityStatus(),
        getDeviceSessions().catch(() => ({ sessions: [] as DeviceSession[] })),
        getSecurityActivity().catch(() => ({ events: [] as SecurityEvent[] })),
      ])
      setStatus(s)
      setSessions(d.sessions || [])
      setEvents(a.events || [])
    } catch (e: any) {
      setError(e?.message || 'Could not load your security settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function beginSetup() {
    setBusy(true)
    setActionError('')
    try {
      const res = await startTwoFactorSetup()
      setSecret(res.secret)
      setOtpauth(res.otpauth_uri)
      setCode('')
      setView('setup')
    } catch (e: any) {
      setActionError(e?.message || 'Could not start setup')
    } finally {
      setBusy(false)
    }
  }

  async function confirmEnable() {
    setBusy(true)
    setActionError('')
    try {
      const res = await enableTwoFactor(code.trim())
      setRecoveryCodes(res.recovery_codes || [])
      setSavedCodes(false)
      setView('recovery')
      await load()
    } catch (e: any) {
      setActionError(e?.message || 'Could not turn on 2FA')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDisable() {
    setBusy(true)
    setActionError('')
    try {
      await disableTwoFactor(code.trim())
      setNotice('Two-factor authentication is off. Turn it back on as soon as you can.')
      setView('main')
      setCode('')
      await load()
    } catch (e: any) {
      setActionError(e?.message || 'Could not turn off 2FA')
    } finally {
      setBusy(false)
    }
  }

  async function confirmRegenerate() {
    setBusy(true)
    setActionError('')
    try {
      const res = await regenerateRecoveryCodes(code.trim())
      setRecoveryCodes(res.recovery_codes || [])
      setSavedCodes(false)
      setView('recovery')
      await load()
    } catch (e: any) {
      setActionError(e?.message || 'Could not create new recovery codes')
    } finally {
      setBusy(false)
    }
  }

  async function removeDevice(s: DeviceSession) {
    setBusy(true)
    setActionError('')
    try {
      const res = await revokeDeviceSession(s.id)
      if (res.current) {
        signOut()
        window.dispatchEvent(new CustomEvent('vura:signed-out'))
        return
      }
      setSessions((prev) => prev.filter((x) => x.id !== s.id))
    } catch (e: any) {
      setActionError(e?.message || 'Could not sign out that device')
    } finally {
      setBusy(false)
    }
  }

  async function signOutEverywhere() {
    setBusy(true)
    setActionError('')
    try {
      await revokeAllDeviceSessions()
      signOut()
      window.dispatchEvent(new CustomEvent('vura:signed-out'))
    } catch (e: any) {
      setActionError(e?.message || 'Could not sign out your devices')
      setBusy(false)
    }
  }

  const enabled = !!status?.two_factor_enabled

  // ── Recovery codes (shown once) ────────────────────────────────────────────
  if (view === 'recovery') {
    return (
      <div className="flex flex-col h-screen bg-[#F7F7F7]">
        <Header title="Recovery codes" sub="Save these somewhere safe" onBack={() => setView('main')} />
        <div className="flex-1 overflow-y-auto px-4 pb-24 pt-5">
          <div className="rounded-2xl bg-[#FFF7E6] border border-[#F5D9A8] px-4 py-3 text-[12px] text-[#8A5A00] font-semibold leading-relaxed">
            These codes are shown once. Each one signs you in if you lose your authenticator. Keep them offline — a
            photo in your gallery is not safe.
          </div>

          <div className="mt-4 rounded-2xl bg-white border border-[#F0F0F0] p-4 grid grid-cols-2 gap-2">
            {recoveryCodes.map((c) => (
              <div key={c} className="rounded-xl bg-[#F7F7F7] px-3 py-2.5 text-center font-mono text-[13px] font-bold tracking-wide text-[#1A1A1A]">
                {c}
              </div>
            ))}
          </div>

          <button
            onClick={() => void copyText(recoveryCodes.join('\n'))}
            className="mt-4 w-full h-11 rounded-xl border border-[#EBEBEB] bg-white text-[13px] font-bold text-[#1A1A1A] active:bg-[#F7F7F7]"
          >
            Copy all codes
          </button>

          <button
            onClick={() => setSavedCodes((v) => !v)}
            className="mt-5 w-full flex items-start gap-3 text-left"
          >
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${savedCodes ? 'bg-[#EA4335] border-[#EA4335]' : 'bg-white border-[#C4C4C4]'}`}>
              {savedCodes && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
              )}
            </span>
            <span className="text-[12px] text-[#4A4A4A] leading-relaxed">
              I have saved these codes somewhere safe and understand they will never be shown again.
            </span>
          </button>

          <button
            onClick={() => setView('main')}
            disabled={!savedCodes}
            className="mt-5 w-full h-12 rounded-2xl bg-[#EA4335] text-white text-[14px] font-bold active:opacity-90 disabled:bg-[#F7F7F7] disabled:text-[#C4C4C4] disabled:border disabled:border-[#EBEBEB]"
          >
            Done
          </button>
        </div>
      </div>
    )
  }

  // ── Setup ──────────────────────────────────────────────────────────────────
  if (view === 'setup') {
    return (
      <div className="flex flex-col h-screen bg-[#F7F7F7]">
        <Header title="Set up 2FA" sub="Use an authenticator app" onBack={() => setView('main')} />
        <div className="flex-1 overflow-y-auto px-4 pb-24 pt-5">
          <div className="rounded-2xl bg-white border border-[#F0F0F0] p-4">
            <p className="text-[13px] font-bold text-[#1A1A1A]">1. Install an authenticator app</p>
            <p className="text-[12px] text-[#6B6B6B] mt-1 leading-relaxed">
              Google Authenticator, Microsoft Authenticator or Authy. Vura does not see or store the codes it generates.
            </p>

            <p className="text-[13px] font-bold text-[#1A1A1A] mt-5">2. Add Vura to the app</p>
            <p className="text-[12px] text-[#6B6B6B] mt-1 leading-relaxed">
              Choose “Enter a setup key”, then paste this key:
            </p>
            <div className="mt-3 rounded-xl bg-[#F7F7F7] border border-[#EBEBEB] px-3 py-3">
              <p className="font-mono text-[15px] font-bold text-[#1A1A1A] tracking-[0.12em] break-all">{formatSecret(secret)}</p>
              <p className="text-[10.5px] text-[#ADADAD] mt-2">Account: Vura · Time-based · 6 digits · 30 seconds</p>
            </div>
            <button
              onClick={() => void copyText(secret)}
              className="mt-2 text-[12px] font-semibold text-[#EA4335]"
            >
              Copy setup key
            </button>
            {otpauth ? (
              <button
                onClick={() => void copyText(otpauth)}
                className="ml-4 mt-2 text-[12px] font-semibold text-[#6B6B6B]"
              >
                Copy setup link
              </button>
            ) : null}

            <p className="text-[13px] font-bold text-[#1A1A1A] mt-6">3. Enter the 6-digit code</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="mt-3 w-full h-14 rounded-2xl border border-[#EBEBEB] bg-white text-center font-mono text-[24px] tracking-[0.35em] text-[#1A1A1A] outline-none focus:border-[#EA4335]"
            />
          </div>

          {actionError && (
            <div className="mt-4 rounded-xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3 text-[12px] font-semibold text-[#C5221F]">
              {actionError}
            </div>
          )}

          <button
            onClick={() => void confirmEnable()}
            disabled={busy || code.trim().length !== 6}
            className="mt-5 w-full h-12 rounded-2xl bg-[#EA4335] text-white text-[14px] font-bold active:opacity-90 disabled:bg-[#F7F7F7] disabled:text-[#C4C4C4] disabled:border disabled:border-[#EBEBEB]"
          >
            {busy ? 'Checking…' : 'Turn on 2FA'}
          </button>
        </div>
      </div>
    )
  }

  // ── Turn off / new codes ───────────────────────────────────────────────────
  if (view === 'disable' || view === 'regenerate') {
    const disabling = view === 'disable'
    return (
      <div className="flex flex-col h-screen bg-[#F7F7F7]">
        <Header
          title={disabling ? 'Turn off 2FA' : 'New recovery codes'}
          sub="Confirm with your authenticator"
          onBack={() => setView('main')}
        />
        <div className="flex-1 overflow-y-auto px-4 pb-24 pt-5">
          <div className="rounded-2xl bg-white border border-[#F0F0F0] p-4">
            <p className="text-[12px] text-[#6B6B6B] leading-relaxed">
              {disabling
                ? 'Turning 2FA off makes your account easier to take over if someone learns your password. Enter the current 6-digit code to confirm.'
                : 'Your old recovery codes will stop working immediately. Enter the current 6-digit code to create a new set.'}
            </p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="mt-4 w-full h-14 rounded-2xl border border-[#EBEBEB] bg-white text-center font-mono text-[24px] tracking-[0.35em] text-[#1A1A1A] outline-none focus:border-[#EA4335]"
            />
          </div>

          {actionError && (
            <div className="mt-4 rounded-xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3 text-[12px] font-semibold text-[#C5221F]">
              {actionError}
            </div>
          )}

          <button
            onClick={() => void (disabling ? confirmDisable() : confirmRegenerate())}
            disabled={busy || code.trim().length !== 6}
            className={`mt-5 w-full h-12 rounded-2xl text-[14px] font-bold active:opacity-90 disabled:bg-[#F7F7F7] disabled:text-[#C4C4C4] disabled:border disabled:border-[#EBEBEB] ${disabling ? 'bg-[#C5221F] text-white' : 'bg-[#EA4335] text-white'}`}
          >
            {busy ? 'Checking…' : disabling ? 'Turn off 2FA' : 'Create new codes'}
          </button>
        </div>
      </div>
    )
  }

  // ── Main ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <Header title="Security & devices" sub="2FA, sign-ins and recovery" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pb-24 pt-5">
        {notice && (
          <div className="rounded-xl bg-[#E6F4EA] border border-[#CEEAD6] px-4 py-3 text-[12px] font-semibold text-[#137333] mb-4">
            {notice}
          </div>
        )}
        {error && (
          <div className="rounded-xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3 text-[12px] font-semibold text-[#C5221F] mb-4">
            {error}
          </div>
        )}
        {actionError && (
          <div className="rounded-xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3 text-[12px] font-semibold text-[#C5221F] mb-4">
            {actionError}
          </div>
        )}

        {/* 2FA */}
        <div className="rounded-2xl bg-white border border-[#F0F0F0] p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-[#FEF0EF] flex items-center justify-center shrink-0">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EA4335" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-[14px] font-bold text-[#1A1A1A]">Two-factor authentication</p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusPill(enabled)}`}>
                  {enabled ? 'ON' : 'OFF'}
                </span>
              </div>
              <p className="text-[11.5px] text-[#6B6B6B] mt-1 leading-relaxed">
                {enabled
                  ? `A 6-digit code from your authenticator app is required when you sign in. Recovery codes left: ${status?.recovery_codes_left ?? 0}.`
                  : 'Add a second step at sign-in, so a stolen password alone cannot open your account.'}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="mt-4 h-10 rounded-xl bg-[#F7F7F7] animate-pulse" />
          ) : enabled ? (
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => { setView('regenerate'); setCode(''); setActionError('') }}
                className="flex-1 h-10 rounded-xl border border-[#EBEBEB] bg-white text-[12px] font-bold text-[#1A1A1A] active:bg-[#F7F7F7]"
              >
                New recovery codes
              </button>
              <button
                onClick={() => { setView('disable'); setCode(''); setActionError('') }}
                className="flex-1 h-10 rounded-xl border border-[#F5C6C2] bg-white text-[12px] font-bold text-[#C5221F] active:bg-[#FEF0EF]"
              >
                Turn off
              </button>
            </div>
          ) : (
            <button
              onClick={() => void beginSetup()}
              disabled={busy}
              className="mt-4 w-full h-10 rounded-xl bg-[#EA4335] text-[13px] font-bold text-white active:opacity-90 disabled:opacity-60"
            >
              {busy ? 'Starting…' : 'Turn on 2FA'}
            </button>
          )}
        </div>

        {/* Devices */}
        <div className="mt-4 flex items-center justify-between px-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[#ADADAD]">Where you are signed in</p>
          <button onClick={() => void load()} className="text-[11px] font-semibold text-[#EA4335]">Refresh</button>
        </div>
        <div className="mt-2 rounded-2xl bg-white border border-[#F0F0F0] overflow-hidden shadow-sm">
          {sessions.length === 0 ? (
            <p className="px-4 py-5 text-[12px] text-[#ADADAD]">
              No devices recorded yet. This phone registers automatically after the next sign-in.
            </p>
          ) : (
            sessions.map((s, i) => (
              <div key={s.id} className={`flex items-center gap-3 px-4 py-3.5 ${i < sessions.length - 1 ? 'border-b border-[#F5F5F5]' : ''}`}>
                <div className="w-9 h-9 rounded-full bg-[#F7F7F7] flex items-center justify-center shrink-0">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#6B6B6B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="7" y="2" width="10" height="20" rx="2" />
                    <line x1="11" y1="18" x2="13" y2="18" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-[#1A1A1A] truncate">{deviceLabel(s)}</p>
                    {s.current && (
                      <span className="rounded-full bg-[#E6F4EA] px-2 py-0.5 text-[9.5px] font-bold text-[#137333]">THIS PHONE</span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#ADADAD] mt-0.5">
                    {s.app === 'driver' ? 'Vura Driver' : s.app === 'rider' ? 'Vura Ride' : 'Vura'}
                    {s.app_version ? ` ${s.app_version}` : ''} · {when(s.last_seen_at)}
                  </p>
                </div>
                {!s.current && (
                  <button
                    onClick={() => void removeDevice(s)}
                    disabled={busy}
                    className="text-[11px] font-bold text-[#C5221F] disabled:opacity-50"
                  >
                    Sign out
                  </button>
                )}
              </div>
            ))
          )}
        </div>

        {sessions.length > 0 && (
          <div className="mt-3 rounded-2xl bg-white border border-[#F5C6C2] p-4">
            <p className="text-[13px] font-bold text-[#1A1A1A]">Lost your phone?</p>
            <p className="text-[11.5px] text-[#6B6B6B] mt-1 leading-relaxed">
              Signing out everywhere ends every session immediately, including this one. You will need your password
              {enabled ? ' and your authenticator or a recovery code' : ''} to sign back in.
            </p>
            {!confirmAll ? (
              <button
                onClick={() => setConfirmAll(true)}
                className="mt-3 w-full h-10 rounded-xl border border-[#C5221F] text-[12px] font-bold text-[#C5221F] active:bg-[#FEF0EF]"
              >
                Sign out of all devices
              </button>
            ) : (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => setConfirmAll(false)}
                  className="flex-1 h-10 rounded-xl border border-[#EBEBEB] text-[12px] font-bold text-[#4A4A4A]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void signOutEverywhere()}
                  disabled={busy}
                  className="flex-1 h-10 rounded-xl bg-[#C5221F] text-[12px] font-bold text-white disabled:opacity-60"
                >
                  {busy ? 'Signing out…' : 'Yes, sign out everywhere'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Activity */}
        <p className="mt-6 px-1 text-[11px] font-bold uppercase tracking-widest text-[#ADADAD]">Recent security activity</p>
        <div className="mt-2 rounded-2xl bg-white border border-[#F0F0F0] overflow-hidden shadow-sm">
          {events.length === 0 ? (
            <p className="px-4 py-5 text-[12px] text-[#ADADAD]">No security activity recorded yet.</p>
          ) : (
            events.slice(0, 12).map((e, i) => (
              <div key={e.id} className={`px-4 py-3 ${i < Math.min(events.length, 12) - 1 ? 'border-b border-[#F5F5F5]' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[12.5px] font-semibold text-[#1A1A1A]">{EVENT_LABELS[e.event] || e.event}</p>
                  <p className="text-[10.5px] text-[#ADADAD] shrink-0">{when(e.created_at)}</p>
                </div>
                {e.detail?.device ? (
                  <p className="text-[10.5px] text-[#ADADAD] mt-0.5">{String(e.detail.device)}</p>
                ) : null}
              </div>
            ))
          )}
        </div>

        <p className="mt-5 px-1 text-[11px] text-[#ADADAD] leading-relaxed">
          Vura will never ask for your password or a 6-digit code by email, WhatsApp or phone. If someone does, it is
          not us.
        </p>
      </div>
    </div>
  )
}

import { useState } from 'react'

/**
 * Driver Settings + the Help Center and Report-an-Issue pages.
 *
 * Ported from the React Native driver app:
 *   app/settings.tsx  -> the settings list
 *   app/help.tsx      -> "Help Center" (recent trip, topics, contact)
 *   app/dispute.tsx   -> "Report an Issue" (issue type, reason, description)
 */

export const SUPPORT_EMAIL = 'support@vura.app'

export const CHEV = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C4C4C4" strokeWidth="2" strokeLinecap="round">
    <path d="M9 18l6-6-6-6" />
  </svg>
)

/** Small round back button. */
export function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-9 h-9 rounded-full border border-[#EBEBEB] flex items-center justify-center shrink-0 active:bg-[#F7F7F7]"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="19" y1="12" x2="5" y2="12" />
        <polyline points="12 19 5 12 12 5" />
      </svg>
    </button>
  )
}

export function Header({ title, sub, onBack }: { title: string; sub?: string; onBack: () => void }) {
  return (
    <div className="pt-14 px-5 pb-4 bg-white border-b border-[#F2F2F2] flex items-center gap-3">
      <BackBtn onClick={onBack} />
      <div className="flex-1 min-w-0">
        <h1 className="text-[22px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{title}</h1>
        {sub ? <p className="text-[11px] text-[#ADADAD] mt-0.5">{sub}</p> : null}
      </div>
    </div>
  )
}

export function Field({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-[#4A4A4A] mb-1 ml-0.5">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 rounded-xl bg-[#F7F7F7] border border-[#EBEBEB] px-3 text-[13px] text-[#1A1A1A] outline-none focus:border-[#EA4335] placeholder:text-[#C4C4C4]"
      />
    </div>
  )
}

/** Waze on/off switch — the same setting the native app stores on the device. */
export function WazeToggle() {
  const [on, setOn] = useState(() => {
    try { return localStorage.getItem('vura.waze.enabled') !== 'false' } catch { return true }
  })
  const toggle = () => {
    const next = !on
    setOn(next)
    try { localStorage.setItem('vura.waze.enabled', next ? 'true' : 'false') } catch { /* ignore */ }
  }
  return (
    <button onClick={toggle} className="w-full flex items-center justify-between px-4 py-3.5 active:bg-[#F7F7F7]">
      <div className="text-left">
        <span className="text-[14px] text-[#1A1A1A]">Waze Navigation</span>
        <p className="text-[11px] text-[#ADADAD] mt-0.5">Open Waze for pickup and drop-off</p>
      </div>
      <span className={`w-11 h-6 rounded-full flex items-center px-0.5 shrink-0 ${on ? 'bg-[#34A853] justify-end' : 'bg-[#E0E0E0] justify-start'}`}>
        <span className="w-5 h-5 rounded-full bg-white" />
      </span>
    </button>
  )
}


export function SettingsScreen({
  onBack, onHelp, onReport, onWallet,
}: { onBack: () => void; onHelp: () => void; onReport: () => void; onWallet: () => void }) {
  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <Header title="Settings" sub="Navigation, payouts and support" onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-24 pt-4">

        {/* Navigation — Waze Navigation lives here, as requested. */}
        <div className="bg-white mx-4 rounded-2xl border border-[#F0F0F0] overflow-hidden shadow-sm">
          <p className="text-[10px] uppercase tracking-widest text-[#ADADAD] font-semibold px-4 pt-3.5 pb-1.5">Navigation</p>
          <WazeToggle />
        </div>

        {/* Payments — points at the one Payments and Withdrawals screen so the bank
            details are entered in a single place (no duplicate/diverging forms). */}
        <div className="bg-white mx-4 mt-3 rounded-2xl border border-[#F0F0F0] overflow-hidden shadow-sm">
          <p className="text-[10px] uppercase tracking-widest text-[#ADADAD] font-semibold px-4 pt-3.5 pb-1.5">Payments</p>
          <button onClick={onWallet} className="w-full flex items-center justify-between px-4 py-3.5 border-t border-[#F5F5F5] active:bg-[#F7F7F7]">
            <div className="text-left">
              <span className="text-[14px] text-[#1A1A1A]">Bank Account</span>
              <p className="text-[11px] text-[#ADADAD] mt-0.5">Add the account your earnings are paid into</p>
            </div>
            {CHEV}
          </button>
        </div>

        {/* Support */}
        <div className="bg-white mx-4 mt-3 rounded-2xl border border-[#F0F0F0] overflow-hidden shadow-sm">
          <p className="text-[10px] uppercase tracking-widest text-[#ADADAD] font-semibold px-4 pt-3.5 pb-1.5">Support</p>
          <button onClick={onHelp} className="w-full flex items-center justify-between px-4 py-3.5 border-t border-[#F5F5F5] active:bg-[#F7F7F7]">
            <div className="text-left">
              <span className="text-[14px] text-[#1A1A1A]">Help Center</span>
              <p className="text-[11px] text-[#ADADAD] mt-0.5">Past trips, topics and support</p>
            </div>
            {CHEV}
          </button>
          <button onClick={onReport} className="w-full flex items-center justify-between px-4 py-3.5 border-t border-[#F5F5F5] active:bg-[#F7F7F7]">
            <div className="text-left">
              <span className="text-[14px] text-[#1A1A1A]">Report an Issue</span>
              <p className="text-[11px] text-[#ADADAD] mt-0.5">Fares, ratings, lost items</p>
            </div>
            {CHEV}
          </button>
        </div>

        <p className="text-[11px] text-[#ADADAD] text-center mt-5 px-6">Vura Driver · {SUPPORT_EMAIL}</p>
      </div>
    </div>
  )
}

/**
 * Help Center — the port of the native app/help.tsx page: a recent-trip card,
 * an "All topics" accordion, and a Contact Support action.
 */
export function HelpCenter({ onBack, onTrips, recentTrip }: {
  onBack: () => void
  onTrips: () => void
  recentTrip?: { title: string; sub: string } | null
}) {
  const [open, setOpen] = useState<string | null>(null)
  const topics = [
    { id: 'trip', title: 'Trip Issues and Refunds' },
    { id: 'account', title: 'Account and Payment Options' },
    { id: 'safety', title: 'Report a Safety Incident' },
    { id: 'support', title: 'Support Messages' },
  ]

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <Header title="Help" sub="Past trips, topics and support" onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-24 pt-5 px-4">

        <p className="text-[13px] font-bold text-[#1A1A1A] mb-2.5">Recent Trip</p>
        <button onClick={onTrips} className="w-full rounded-2xl bg-white border border-[#F0F0F0] p-4 flex items-center justify-between shadow-sm active:bg-[#F7F7F7]">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-12 h-12 rounded-full bg-[#F7F7F7] flex flex-col items-center justify-center shrink-0">
              <span className="text-[9px] uppercase font-bold text-[#ADADAD]">Trip</span>
              <span className="text-[15px] font-extrabold leading-tight text-[#1A1A1A]">›</span>
            </div>
            <div className="min-w-0 text-left">
              <p className="text-[13px] font-bold text-[#1A1A1A] truncate">{recentTrip?.title || 'Toyota Prius'}</p>
              <p className="text-[11px] text-[#ADADAD] mt-0.5 truncate">{recentTrip?.sub || 'R 15.90 · Cancelled'}</p>
            </div>
          </div>
          {CHEV}
        </button>
        <button onClick={onTrips} className="mt-2 text-[11px] font-bold text-[#EA4335] ml-2 active:opacity-70">
          View all past trips
        </button>

        <p className="text-[13px] font-bold text-[#1A1A1A] mt-6 mb-2.5">All topics</p>
        <div className="rounded-2xl bg-white border border-[#F0F0F0] overflow-hidden shadow-sm">
          {topics.map((t) => (
            <div key={t.id} className="border-b border-[#F5F5F5] last:border-b-0">
              <button
                onClick={() => setOpen(open === t.id ? null : t.id)}
                className="w-full flex items-center gap-3 p-4 active:bg-[#F7F7F7]"
              >
                <div className="w-8 h-8 rounded-full bg-[#F7F7F7] flex items-center justify-center shrink-0">
                  <span className="w-2 h-2 rounded-full bg-[#EA4335]" />
                </div>
                <span className="text-[13px] font-bold text-[#1A1A1A] flex-1 text-left">{t.title}</span>
                {CHEV}
              </button>
              {open === t.id && (
                <div className="px-4 pb-4">
                  <div className="bg-[#F7F7F7] rounded-xl p-4">
                    <p className="text-[13px] font-bold text-[#1A1A1A]">Support Assistant</p>
                    <p className="text-[11px] text-[#ADADAD] mt-1">
                      Our team is available to assist you with {t.title.toLowerCase()}. We typically reply within 2 hours.
                    </p>
                    <a
                      href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t.title)}`}
                      className="mt-3 inline-block bg-[#EA4335] text-white px-3 py-1.5 rounded-lg text-[11px] font-bold"
                    >
                      Contact Support
                    </a>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="mt-5 w-full h-12 rounded-2xl bg-white border border-[#EBEBEB] flex items-center justify-center text-[13px] font-bold text-[#EA4335] active:bg-[#FEF0EF]"
        >
          Email {SUPPORT_EMAIL}
        </a>
      </div>
    </div>
  )
}

/**
 * Report an Issue — the port of the native app/dispute.tsx page: pick an issue
 * type, an optional reason, a required description, then submit. The native
 * screen posts to a DisputeService; this server exposes no disputes route
 * (verified: /api/support and /api/help both 404), so the report is submitted
 * by email and the failure is surfaced instead of being silently swallowed.
 */
export function ReportIssue({ onBack, rideId }: { onBack: () => void; rideId?: string | null }) {
  const types = [
    { id: 'cancellation_fee', label: 'Cancellation fee' },
    { id: 'refund', label: 'Refund request' },
    { id: 'rating', label: 'Rating issue' },
    { id: 'lost_item', label: 'Lost item' },
    { id: 'other', label: 'Other' },
  ]
  const [type, setType] = useState('refund')
  const [reason, setReason] = useState('')
  const [description, setDescription] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const submit = () => {
    if (!description.trim()) {
      setError('Please describe what happened')
      return
    }
    setError('')
    const label = types.find((t) => t.id === type)?.label || type
    const body = [
      `Issue type: ${label}`,
      reason.trim() ? `Reason: ${reason.trim()}` : 'Reason: (not given)',
      rideId ? `Ride ID: ${rideId}` : 'Ride ID: (none)',
      '',
      description.trim(),
    ].join('\n')
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
      `Issue report — ${label}`
    )}&body=${encodeURIComponent(body)}`
    setSent(true)
  }

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <Header title="Report an Issue" sub="We're here to help resolve any problems" onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-24 pt-6 px-4">

        {sent && (
          <div className="rounded-xl bg-[#E6F4EA] border border-[#CEEAD6] px-4 py-3 text-[12px] font-semibold text-[#137333] mb-5">
            Your report is ready in your email app — press send and our team will review it.
          </div>
        )}

        <p className="text-[11px] font-bold text-[#ADADAD] uppercase mb-3">Issue type</p>
        <div className="flex flex-wrap gap-2 mb-6">
          {types.map((t) => {
            const active = type === t.id
            return (
              <button
                key={t.id}
                onClick={() => setType(t.id)}
                className={`rounded-full px-4 py-2.5 text-[12px] font-bold border ${
                  active ? 'bg-[#EA4335] text-white border-[#EA4335]' : 'bg-[#F7F7F7] text-[#1A1A1A] border-[#EBEBEB]'
                }`}
              >
                {t.label}
              </button>
            )
          })}
        </div>

        {error && (
          <div className="rounded-xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3 text-[12px] font-semibold text-[#C5221F] mb-4">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <Field label="Reason (optional)" value={reason} onChange={setReason} placeholder="Brief reason" />
          <div>
            <label className="block text-[11px] font-bold text-[#ADADAD] uppercase mb-1.5 ml-1">Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what happened in detail..."
              rows={6}
              className="w-full rounded-xl border border-[#EBEBEB] bg-white px-4 py-3.5 text-[13px] font-medium text-[#1A1A1A] outline-none focus:border-[#EA4335] placeholder:text-[#C4C4C4] resize-none"
            />
          </div>
        </div>

        <button
          onClick={submit}
          className="mt-6 w-full h-12 rounded-2xl bg-[#EA4335] text-white text-[14px] font-bold active:opacity-90"
          style={{ boxShadow: '0 4px 16px rgba(234,67,53,0.28)' }}
        >
          Submit report
        </button>
      </div>
    </div>
  )
}

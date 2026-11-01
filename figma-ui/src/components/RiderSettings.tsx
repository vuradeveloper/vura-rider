import { useState } from 'react'
import { Header } from './SettingsScreen'
import { deleteAccount, openExternalUrl } from '../lib/backend'

const TERMS_URL = 'https://www.ridevura.com/terms'
const PRIVACY_URL = 'https://www.ridevura.com/privacy'

/**
 * Settings — the hub that replaced the dead "Safety" section on the Account page.
 *
 * Asked for on 27 Sep 2026: "Under Safety change that button to Settings and then
 * under it put those buttons inside. Make all those buttons redirect somewhere,
 * and also inside Settings have a user's details profile and a section they can
 * upload their ID document."
 *
 * Every row navigates to a real screen — nothing here is a placeholder. The
 * safety rows open the Safety Center (emergency contacts, SOS, live trip
 * sharing), the account rows open Payment Methods / Promos & Invites / Your
 * Details, and Support opens the Help Center and Report an Issue screens that
 * already talk to the disputes API.
 */
export default function RiderSettings({
  onBack, onProfile, onPayments, onPromos, onSafety, onNotifications, onHelp, onReport, onGuidelines, onDelete,
}: {
  onBack: () => void
  onProfile: () => void
  onPayments: () => void
  onPromos: () => void
  onSafety: () => void
  onNotifications: () => void
  onHelp: () => void
  onReport: () => void
  onGuidelines: () => void
  onDelete: () => void
}) {
  const sections: { section: string; items: { label: string; sub?: string; action: () => void; danger?: boolean }[] }[] = [
    {
      section: 'Account',
      items: [
        { label: 'Your Details', sub: 'Name, phone and your ID document', action: onProfile },
        { label: 'Payment Methods', sub: 'Cards saved on your account', action: onPayments },
        { label: 'Promos & Invites', sub: 'Offers, promo codes and referrals', action: onPromos },
      ],
    },
    {
      section: 'Safety',
      items: [
        { label: 'Emergency Contacts', sub: 'People we alert if something happens', action: onSafety },
        { label: 'Share Trip Status', sub: 'Send a live link for your trip', action: onSafety },
        { label: 'Community Guidelines', action: onGuidelines },
      ],
    },
    {
      section: 'Preferences',
      items: [{ label: 'Notifications', action: onNotifications }],
    },
    {
      section: 'Legal & privacy',
      items: [
        { label: 'Privacy Policy', sub: 'How we collect, use and protect your data', action: () => { void openExternalUrl(PRIVACY_URL) } },
        { label: 'Terms of Service', sub: 'The rules that apply when you use Vura', action: () => { void openExternalUrl(TERMS_URL) } },
      ],
    },
    {
      section: 'Support',
      items: [
        { label: 'Help Center', action: onHelp },
        { label: 'Report an Issue', action: onReport },
      ],
    },
    {
      section: 'Account removal',
      items: [
        { label: 'Delete account', sub: 'Permanently delete your account and data', action: onDelete, danger: true },
      ],
    },
  ]

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <Header title="Settings" sub="Your account, safety and support" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {sections.map((sec) => (
          <div key={sec.section} className="bg-white mt-3 rounded-2xl border border-[#F0F0F0] overflow-hidden shadow-sm">
            <p className="text-[10px] uppercase tracking-widest text-[#ADADAD] font-semibold px-4 pt-3.5 pb-1">
              {sec.section}
            </p>
            {sec.items.map((it, i) => (
              <button
                key={it.label}
                onClick={it.action}
                className={`w-full flex items-center justify-between px-4 py-3.5 active:bg-[#F7F7F7] text-left ${
                  i < sec.items.length - 1 ? 'border-b border-[#F5F5F5]' : ''
                }`}
              >
                <span className="min-w-0 pr-3">
                  <span className={`block text-[14px] ${it.danger ? 'text-[#C5221F] font-semibold' : 'text-[#1A1A1A]'}`}>{it.label}</span>
                  {it.sub && <span className="block text-[11px] text-[#ADADAD] mt-0.5">{it.sub}</span>}
                </span>
                <span className="text-[#C4C4C4] text-[18px] leading-none shrink-0">›</span>
              </button>
            ))}
          </div>
        ))}
        <p className="text-[11px] text-[#ADADAD] text-center mt-5">Vura · rider app</p>
      </div>
    </div>
  )
}

/**
 * In-app account deletion — required by Google Play and the App Store.
 *
 * The server (POST /api/users/delete) deletes the DB row and every dependent
 * record and removes the Firebase identity, so this is a real deletion, not a
 * sign-out. The screen explains the consequences and asks for an explicit
 * confirmation before the destructive call.
 */
export function DeleteAccount({ onBack, onDeleted }: { onBack: () => void; onDeleted: () => void }) {
  const [understood, setUnderstood] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function doDelete() {
    setBusy(true)
    setError('')
    try {
      await deleteAccount()
      onDeleted()
    } catch (e: any) {
      setError(e?.message || 'Could not delete your account. Please try again or contact support.')
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <Header title="Delete account" sub="This cannot be undone" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-24">
        <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 shadow-sm">
          <p className="text-[15px] font-semibold text-[#1A1A1A]">What will be deleted</p>
          <ul className="mt-2 space-y-1.5">
            {[
              'Your profile, login and phone number',
              'Your ride history and receipts',
              'Saved places and payment methods',
              'Emergency contacts, ratings and messages',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2 text-[12px] text-[#6B6B6B] leading-relaxed">
                <span className="text-[#C5221F] mt-0.5">•</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-[#ADADAD] mt-3 leading-relaxed">
            Records we are legally required to keep (for example completed trip and payment records) may be
            retained for the period required by law. Read our{' '}
            <button type="button" onClick={() => { void openExternalUrl(PRIVACY_URL) }} className="text-[#EA4335] font-semibold underline underline-offset-2">Privacy Policy</button>.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 shadow-sm mt-3">
          <button
            type="button"
            role="checkbox"
            aria-checked={understood}
            onClick={() => setUnderstood(v => !v)}
            className="w-full flex items-start gap-3 text-left">
            <span className={`w-5 h-5 rounded-[6px] flex items-center justify-center shrink-0 mt-0.5 border transition-colors ${understood ? 'bg-[#C5221F] border-[#C5221F]' : 'bg-white border-[#C4C4C4]'}`}>
              {understood && (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
            </span>
            <span className="text-[12px] text-[#6B6B6B] leading-relaxed">
              I understand that my account and the data above will be permanently deleted.
            </span>
          </button>
        </div>

        {error && (
          <div className="rounded-2xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3 mt-3">
            <p className="text-[12px] text-[#C5221F] font-semibold">{error}</p>
          </div>
        )}

        {!confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={!understood}
            className={`w-full font-bold text-[15px] py-4 rounded-2xl mt-4 transition-colors ${understood ? 'bg-[#C5221F] text-white active:bg-[#A50E0E]' : 'bg-[#EBEBEB] text-[#C4C4C4]'}`}>
            Delete my account
          </button>
        ) : (
          <div className="bg-white rounded-2xl border border-[#F5C6C2] p-4 shadow-sm mt-4">
            <p className="text-[14px] font-semibold text-[#1A1A1A]">Delete this account permanently?</p>
            <p className="text-[12px] text-[#6B6B6B] mt-1 leading-relaxed">
              You will be signed out and this account cannot be recovered.
            </p>
            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="flex-1 bg-[#F7F7F7] border border-[#EBEBEB] text-[#1A1A1A] font-semibold text-[14px] py-3 rounded-xl active:bg-[#F0F0F0]">
                Cancel
              </button>
              <button
                type="button"
                onClick={doDelete}
                disabled={busy}
                className="flex-1 bg-[#C5221F] text-white font-bold text-[14px] py-3 rounded-xl active:bg-[#A50E0E]">
                {busy ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** The community rules, in the app rather than a link to a page that may not exist. */
export function Guidelines({ onBack }: { onBack: () => void }) {
  const rules = [
    ['Ride honestly', 'Only one account per person. Do not share codes to farm rewards, and do not request rides you do not intend to take.'],
    ['Stay safe', 'Wear your seatbelt, confirm the car and number plate before you get in, and share your trip when travelling alone or at night.'],
    ['Pay what you owe', 'Cash fares are paid at the end of the trip. Card fares are charged to the card you selected. Unpaid fares block new requests.'],
    ['Rate fairly', 'Ratings keep the platform safe. Rate the trip, not a bad day.'],
    ['Report problems', 'Use Report an Issue for anything from a lost item to an unsafe driver. Reports are reviewed by our team.'],
  ]
  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <Header title="Community Guidelines" sub="How we keep Vura safe" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-24">
        <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 shadow-sm">
          {rules.map(([title, body], i) => (
            <div key={title} className={`py-3 ${i < rules.length - 1 ? 'border-b border-[#F5F5F5]' : ''}`}>
              <p className="text-[14px] font-semibold text-[#1A1A1A]">{title}</p>
              <p className="text-[12px] text-[#6B6B6B] mt-1 leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

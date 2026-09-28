import { Header } from './SettingsScreen'

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
  onBack, onProfile, onPayments, onPromos, onSafety, onNotifications, onHelp, onReport, onGuidelines,
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
}) {
  const sections: { section: string; items: { label: string; sub?: string; action: () => void }[] }[] = [
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
      section: 'Support',
      items: [
        { label: 'Help Center', action: onHelp },
        { label: 'Report an Issue', action: onReport },
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
                  <span className="block text-[14px] text-[#1A1A1A]">{it.label}</span>
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

/** The community rules, in the app rather than a link to a page that may not exist. */
export function Guidelines({ onBack }: { onBack: () => void }) {
  const rules = [
    ['Be respectful', 'Treat every rider and driver the way you would want to be treated. Abuse, harassment or discrimination ends the trip and the account.'],
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

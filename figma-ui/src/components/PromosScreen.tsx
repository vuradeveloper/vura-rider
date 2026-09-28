import { useEffect, useState } from 'react'
import { Header } from './SettingsScreen'
import {
  claimReferralCode,
  getAffiliateReferrals,
  getAffiliateSummary,
  getAffiliateTransactions,
  registerAffiliate,
  type AffiliateReferral,
  type AffiliateSummary,
  type AffiliateTransaction,
} from '../lib/backend'

/** The two offers the old Promotions screen carried. */
const OFFERS = [
  { title: '20% off your next 3 rides', desc: 'Up to R50 per ride. Valid until end of month.' },
  { title: 'R100 Welcome Bonus', desc: 'Applied automatically on your first ride.' },
]

const STATUS: Record<string, { label: string; bg: string; fg: string; dot: string }> = {
  pending: { label: 'Pending', bg: '#FFF7E6', fg: '#8A5A00', dot: '#FBBC04' },
  settled: { label: 'Settled', bg: '#EAF7EE', fg: '#1E7B43', dot: '#34A853' },
  disqualified: { label: 'Disqualified', bg: '#FCE8E6', fg: '#C5221F', dot: '#EA4335' },
  lapsed: { label: 'Expired', bg: '#F7F7F7', fg: '#6B6B6B', dot: '#9E9E9E' },
}

/**
 * Promos / Invite & earn.
 *
 * The old app had this as `app/promotions.tsx` (offers + a promo-code box that
 * did nothing) and an affiliate service whose only screen was the referrals list.
 * This is the whole feature on one screen, wired to the live contracts:
 *   POST /api/affiliates/register        join the programme
 *   GET  /api/affiliates/me              my code, status, balance
 *   GET  /api/affiliates/me/referrals    who joined with my code + their status
 *   GET  /api/affiliates/me/transactions what I have earned
 *   POST /api/affiliates/claim           redeem someone else's code
 */
export default function PromosScreen({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState('')
  const [claimMsg, setClaimMsg] = useState('')
  const [claiming, setClaiming] = useState(false)

  const [aff, setAff] = useState<AffiliateSummary | null>(null)
  const [referrals, setReferrals] = useState<AffiliateReferral[]>([])
  const [txs, setTxs] = useState<AffiliateTransaction[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    void (async () => {
      const me = await getAffiliateSummary().catch(() => null)
      if (!alive) return
      const mine = me?.affiliate ?? null
      setAff(mine)
      if (!mine) return
      const [r, t] = await Promise.all([
        getAffiliateReferrals().catch(() => ({ referrals: [] as AffiliateReferral[] })),
        getAffiliateTransactions().catch(() => ({ transactions: [] as AffiliateTransaction[] })),
      ])
      if (!alive) return
      setReferrals(Array.isArray(r?.referrals) ? r.referrals : [])
      setTxs(Array.isArray(t?.transactions) ? t.transactions : [])
    })()
    return () => { alive = false }
  }, [tick])

  const myCode = String(aff?.referral_code || aff?.code || '')

  async function join() {
    setBusy(true)
    setMsg('')
    try {
      await registerAffiliate()
      setTick((x) => x + 1)
      setMsg('You are in — share your code to start earning.')
    } catch (e: any) {
      setMsg(e?.message || 'Could not join the programme right now.')
    } finally {
      setBusy(false)
    }
  }

  async function claim() {
    const c = code.trim()
    if (!c) return
    setClaiming(true)
    setClaimMsg('')
    try {
      const r = await claimReferralCode(c)
      setClaimMsg(r?.alreadyReferred
        ? 'This account has already used an invite code.'
        : 'Code accepted — your reward is on the way.')
      if (!r?.alreadyReferred) setCode('')
    } catch (e: any) {
      setClaimMsg(e?.message || 'That code was not accepted.')
    } finally {
      setClaiming(false)
    }
  }

  async function share() {
    const text = `Join me on Vura. Use my code ${myCode} when you sign up.`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Vura', text })
        return
      }
      await navigator.clipboard.writeText(text)
      setMsg('Invite copied — paste it to whoever you send it to.')
    } catch {
      setMsg(`Your code is ${myCode}`)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <Header title="Promos & Invites" sub="Offers, promo codes and referrals" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-24">
        {/* Have a code? — this is the box the old Promotions screen showed but
            never wired to anything. */}
        <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 shadow-sm">
          <p className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold mb-2">Have a code?</p>
          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter promo or invite code"
              className="flex-1 min-w-0 rounded-xl border border-[#E8E8E8] bg-white px-3.5 py-3 text-[14px] text-[#1A1A1A] outline-none focus:border-[#1A1A1A]"
            />
            <button
              onClick={claim}
              disabled={claiming || !code.trim()}
              className="shrink-0 rounded-2xl bg-[#EA4335] active:bg-[#C5221F] text-white px-5 font-semibold text-[13px] disabled:opacity-50"
            >
              {claiming ? '…' : 'Apply'}
            </button>
          </div>
          {!!claimMsg && <p className="text-[11px] text-[#6B6B6B] font-medium mt-2">{claimMsg}</p>}
        </div>

        <p className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold mt-4 mb-2">Active offers</p>
        <div className="flex flex-col gap-2">
          {OFFERS.map((o) => (
            <div key={o.title} className="bg-white rounded-2xl border border-[#F0F0F0] p-4 flex items-start gap-3 shadow-sm">
              <div className="w-10 h-10 rounded-full bg-[#FCE8E6] flex items-center justify-center shrink-0">
                <span className="text-[17px]">🎁</span>
              </div>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-[#1A1A1A]">{o.title}</p>
                <p className="text-[12px] text-[#6B6B6B] mt-1 leading-snug">{o.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold mt-4 mb-2">Invite &amp; earn</p>
        <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 shadow-sm">
          {!aff ? (
            <>
              <p className="text-[14px] font-semibold text-[#1A1A1A]">Earn by inviting friends</p>
              <p className="text-[12px] text-[#6B6B6B] mt-1 leading-relaxed">
                Join the programme, share your code, and earn a reward when a friend takes their first ride.
              </p>
              <button
                onClick={join}
                disabled={busy}
                className="mt-3 w-full bg-[#1A1A1A] active:bg-black text-white font-semibold text-[14px] py-3.5 rounded-2xl disabled:opacity-60"
              >
                {busy ? 'Joining…' : 'Join the programme'}
              </button>
            </>
          ) : (
            <>
              <p className="text-[11px] text-[#ADADAD] font-semibold uppercase tracking-wider">Your invite code</p>
              <p className="text-[26px] font-bold text-[#1A1A1A] mt-1" style={{ fontFamily: 'JetBrains Mono, monospace', letterSpacing: '2px' }}>
                {myCode || '—'}
              </p>

              <div className="flex gap-2 mt-3">
                <button
                  onClick={share}
                  className="flex-1 bg-[#EA4335] active:bg-[#C5221F] text-white font-semibold text-[13px] py-3 rounded-2xl"
                >
                  Share invite
                </button>
                <button
                  onClick={() => {
                    try { void navigator.clipboard?.writeText(myCode) } catch { /* clipboard unavailable */ }
                    setMsg('Code copied.')
                  }}
                  className="flex-1 border border-[#EBEBEB] bg-white font-semibold text-[13px] py-3 rounded-2xl active:bg-[#F7F7F7]"
                >
                  Copy code
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-4">
                {[
                  { l: 'Referrals', v: String(referrals.length) },
                  { l: 'Earned', v: 'R' + txs.reduce((a, t) => a + Number(t.amount || 0), 0).toFixed(2) },
                  { l: 'Status', v: String(aff.status || 'active') },
                ].map((s) => (
                  <div key={s.l} className="bg-[#F7F7F7] rounded-2xl p-3 text-center border border-[#F0F0F0]">
                    <p className="text-[15px] font-bold text-[#1A1A1A] capitalize truncate">{s.v}</p>
                    <p className="text-[10px] text-[#ADADAD] mt-0.5 font-semibold">{s.l}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {referrals.length > 0 && (
          <>
            <p className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold mt-4 mb-2">
              People who joined with your code
            </p>
            <div className="bg-white rounded-2xl border border-[#F0F0F0] overflow-hidden shadow-sm">
              {referrals.map((r, i) => {
                const st = STATUS[String(r.status || 'pending')] || STATUS.pending
                return (
                  <div key={r.id} className={`flex items-center gap-3 px-4 py-3.5 ${i < referrals.length - 1 ? 'border-b border-[#F5F5F5]' : ''}`}>
                    <div className="w-9 h-9 rounded-full bg-[#F2F2F2] flex items-center justify-center shrink-0">
                      <span className="text-[13px] font-bold text-[#6B6B6B]">
                        {String(r.referred_name || '?').charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-[#1A1A1A] truncate">{r.referred_name || 'Vura rider'}</p>
                      <p className="text-[11px] text-[#ADADAD] mt-0.5">
                        {r.created_at
                          ? new Date(r.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })
                          : ''}
                      </p>
                    </div>
                    {Number(r.rewarded_amount) > 0 && (
                      <span className="shrink-0 text-[12px] font-bold text-[#1E7B43]">
                        R{Number(r.rewarded_amount).toFixed(2)}
                      </span>
                    )}
                    <span className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: st.bg, color: st.fg }}>
                      {st.label}
                    </span>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {txs.length > 0 && (
          <>
            <p className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold mt-4 mb-2">Earnings</p>
            <div className="bg-white rounded-2xl border border-[#F0F0F0] overflow-hidden shadow-sm">
              {txs.map((t, i) => (
                <div key={t.id} className={`flex items-center justify-between px-4 py-3 ${i < txs.length - 1 ? 'border-b border-[#F5F5F5]' : ''}`}>
                  <div className="min-w-0 pr-2">
                    <p className="text-[13px] text-[#1A1A1A] font-semibold capitalize">{t.kind || 'Referral reward'}</p>
                    <p className="text-[11px] text-[#ADADAD] mt-0.5">
                      {t.created_at ? new Date(t.created_at).toLocaleDateString('en-ZA') : ''}
                    </p>
                  </div>
                  <span
                    className={`text-[14px] font-bold shrink-0 ${Number(t.amount) < 0 ? 'text-[#C5221F]' : 'text-[#1A1A1A]'}`}
                    style={{ fontFamily: 'JetBrains Mono, monospace' }}
                  >
                    {Number(t.amount) < 0 ? '-' : '+'}R{Math.abs(Number(t.amount || 0)).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}

        {!!msg && <p className="text-[12px] text-[#6B6B6B] font-medium mt-3 leading-snug">{msg}</p>}
      </div>
    </div>
  )
}

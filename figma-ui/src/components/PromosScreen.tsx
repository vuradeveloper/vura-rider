import { useEffect, useState } from 'react'
import { Header } from './SettingsScreen'
import {
  claimReferralCode,
  getActivePromos,
  getAffiliateReferrals,
  getAffiliateSummary,
  getAffiliateTransactions,
  registerAffiliate,
  type ActivePromo,
  type AffiliateReferral,
  type AffiliateSummary,
  type AffiliateTransaction,
} from '../lib/backend'

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

  // REAL active offers — the server's window+audience-filtered promos
  // (GET /api/promos/active?side=rider). Nothing hardcoded: what Vura actually
  // runs (e.g. WINTER40) is exactly what appears here, live.
  const [offers, setOffers] = useState<ActivePromo[] | null>(null)
  useEffect(() => {
    getActivePromos('rider')
      .then((r) => setOffers(Array.isArray(r?.promos) ? r.promos : []))
      .catch(() => setOffers([]))
  }, [])

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
          {offers === null ? (
            <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 shadow-sm">
              <p className="text-[12px] text-[#ADADAD]">Checking for offers…</p>
            </div>
          ) : offers.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 shadow-sm text-center">
              <p className="text-[13px] font-semibold text-[#1A1A1A]">No active offers right now</p>
              <p className="text-[12px] text-[#ADADAD] mt-1 leading-snug">
                Real offers only — when Vura runs one, it lands here automatically.
              </p>
            </div>
          ) : offers.map((o) => {
            const pct = Number(o.discount_pct) || 0
            const fixed = Number(o.discount_fixed) || 0
            const off = pct > 0 ? `${pct}% off your ride` : fixed > 0 ? `R${fixed.toFixed(2)} off your ride` : ''
            const usable = o.usable !== false
            const meta = [
              o.rides_limit ? `${o.rides_limit} ride${Number(o.rides_limit) === 1 ? '' : 's'}` : '',
              o.valid_days ? `valid ${o.valid_days} days` : '',
              o.expires_at
                ? `until ${new Date(o.expires_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}`
                : '',
            ].filter(Boolean).join(' · ')
            return (
              <div key={o.id} className={`bg-white rounded-2xl border border-[#F0F0F0] p-4 flex items-start gap-3 shadow-sm ${usable ? '' : 'opacity-60'}`}>
                <div className="w-10 h-10 rounded-full bg-[#FCE8E6] flex items-center justify-center shrink-0">
                  <span className="text-[15px] font-bold text-[#EA4335]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>%</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-semibold text-[#1A1A1A] truncate">{o.title}</p>
                    <span className="shrink-0 rounded bg-[#F7F7F7] border border-[#EBEBEB] px-1.5 py-0.5 text-[10px] font-bold text-[#6B6B6B]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                      {o.code}
                    </span>
                  </div>
                  {o.subtitle ? (
                    <p className="text-[12px] text-[#6B6B6B] mt-1 leading-snug">{o.subtitle}</p>
                  ) : null}
                  <p className="text-[12px] text-[#EA4335] font-semibold mt-1">
                    {off}{usable ? '' : ' · used up for you'}
                  </p>
                  {meta ? <p className="text-[11px] text-[#ADADAD] mt-1">{meta}</p> : null}
                </div>
              </div>
            )
          })}
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

              <div className="mt-3 bg-[#E6F4EA] border border-[#CEEAD6] rounded-xl px-3 py-2.5">
                <p className="text-[12px] font-semibold text-[#137333]">
                  Balance to spend: R{Number(aff.balance || 0).toFixed(2)}
                </p>
                <p className="text-[11px] text-[#3C6B46] mt-0.5 leading-snug">
                  Flip "Use invite credit" on when you book a trip and it comes off that fare — it's yours to choose, trip by trip.
                </p>
              </div>
            </>
          )}
        </div>

        {referrals.length > 0 && (
          <>
            <p className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold mt-4 mb-2">
              People you invited
            </p>
            <div className="bg-white rounded-2xl border border-[#F0F0F0] overflow-hidden shadow-sm">
              {referrals.map((r, i) => {
                const st = STATUS[String(r.status || 'pending')] || STATUS.pending
                const joined = r.created_at
                  ? new Date(r.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
                  : ''
                const settled = r.settled_at
                  ? new Date(r.settled_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
                  : ''
                const s = String(r.status || 'pending')
                const line =
                  s === 'settled'
                    ? `First ride done${settled ? ` ${settled}` : ''} — R5 paid`
                    : s === 'lapsed'
                      ? `No first ride within 90 days${joined ? ` · joined ${joined}` : ''}`
                      : s === 'disqualified'
                        ? 'Reward cancelled'
                        : `Joined${joined ? ` ${joined}` : ''} — waiting for their first ride`
                return (
                  <div key={r.id} className={`flex items-center gap-3 px-4 py-3.5 ${i < referrals.length - 1 ? 'border-b border-[#F5F5F5]' : ''}`}>
                    <div className="w-9 h-9 rounded-full bg-[#F2F2F2] flex items-center justify-center shrink-0">
                      <span className="text-[13px] font-bold text-[#6B6B6B]">
                        {String(r.referred_name || r.referred_email || '?').charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-[#1A1A1A] truncate">{r.referred_name || r.referred_email || 'Vura rider'}</p>
                      <p className="text-[11px] text-[#ADADAD] mt-0.5">{line}</p>
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

        {aff && referrals.length === 0 && (
          <>
            <p className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold mt-4 mb-2">
              People you invited
            </p>
            <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 shadow-sm">
              <p className="text-[13px] font-semibold text-[#1A1A1A]">No invites yet</p>
              <p className="text-[12px] text-[#ADADAD] mt-1 leading-snug">
                Share your code — everyone who joins with it appears here with their status.
              </p>
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

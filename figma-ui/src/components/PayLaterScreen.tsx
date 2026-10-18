import { useCallback, useEffect, useState } from 'react'
import {
  acceptPayLaterTerms,
  enrollPayLater,
  getPayLaterEligibility,
  PayLaterEligibility,
  repayPayLaterBalance,
  setPayLaterAutoDebit,
} from '../lib/backend'

/**
 * Ride Now, Pay Later — the rider's balance, BOTH progress bars and the three
 * repayment options from the brief:
 *
 *   1. Unlock bar    — completed PAID rides on the same card vs the threshold
 *                      (locked riders see exactly how far off they are);
 *   2. Ride-to-repay — every N completed rides clears R X off the balance;
 *   3. Repay now     — "Pay what I owe" by saved card (ledger moves when the
 *                      charge.success webhook confirms, not when we ask);
 *   4. Auto-debit    — opt-in consent + revocable toggle, retry days shown.
 *
 * Balance / limit / due date / terms state all come from ONE server blob
 * (GET /api/payments/pay-later/eligibility) so this screen can never drift
 * from the numbers the booking guard enforces.
 */

const fmtRand = (n: any) => {
  const num = Number(n)
  const safe = Number.isFinite(num) ? num : 0
  const [whole, frac] = safe.toFixed(2).split('.')
  return `R${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`
}

const fmtDate = (iso: string | null) => {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long' })
}

const BACK_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
)

function Bar({ pct, color }: { pct: number; color: string }) {
  const w = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0))
  return (
    <div className="h-2.5 rounded-full bg-[#F1F1F1] overflow-hidden">
      <div className="h-2.5 rounded-full transition-all duration-500" style={{ width: `${w}%`, background: color }} />
    </div>
  )
}

type Flash = { kind: 'ok' | 'err'; text: string } | null

export default function PayLaterScreen({ onBack }: { onBack: () => void }) {
  const [elig, setElig] = useState<PayLaterEligibility | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [flash, setFlash] = useState<Flash>(null)

  const [busy, setBusy] = useState<'repay' | 'terms' | 'auto' | 'activate' | null>(null)
  const [repayAmount, setRepayAmount] = useState('')

  const load = useCallback(async () => {
    try {
      const e = await getPayLaterEligibility()
      setElig(e)
      setError('')
      // Prefill "pay what I owe" with the full balance whenever it changes.
      setRepayAmount((prev) => (prev ? prev : e.outstanding_r > 0 ? String(e.outstanding_r) : ''))
    } catch (e: any) {
      setError(e?.message || 'Could not load your Pay Later status.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // ── Actions ────────────────────────────────────────────────────────────────

  async function activate() {
    if (busy) return
    setBusy('activate'); setFlash(null)
    try {
      await enrollPayLater()
      // Enrollment alone leaves terms unaccepted — the booking guard requires
      // both, so accept immediately (the rider tapped through the offer).
      if (!elig?.terms_accepted_at) await acceptPayLaterTerms()
      setFlash({ kind: 'ok', text: 'Ride Now, Pay Later is active on your account.' })
      await load()
    } catch (e: any) {
      setFlash({ kind: 'err', text: e?.message || 'Could not activate Pay Later.' })
    } finally { setBusy(null) }
  }

  async function acceptTerms() {
    if (busy) return
    setBusy('terms'); setFlash(null)
    try {
      await acceptPayLaterTerms()
      setFlash({ kind: 'ok', text: 'Terms accepted — you can now book rides with Pay Later.' })
      await load()
    } catch (e: any) {
      setFlash({ kind: 'err', text: e?.message || 'Could not record your acceptance.' })
    } finally { setBusy(null) }
  }

  async function repay() {
    if (busy) return
    setBusy('repay'); setFlash(null)
    try {
      const raw = String(repayAmount || '').replace(/[^\d.]/g, '')
      const amt = Number(raw)
      const res = await repayPayLaterBalance(Number.isFinite(amt) && amt > 0 ? amt : undefined)
      if (res.status === 'confirmed') {
        setFlash({ kind: 'ok', text: `Repaid ${fmtRand(res.amount ?? amt)} — your balance is cleared.` })
      } else {
        setFlash({
          kind: 'ok',
          text: res.message || 'Repayment sent — your balance updates as soon as your bank confirms it.',
        })
      }
      setRepayAmount('')
      await load()
    } catch (e: any) {
      setFlash({ kind: 'err', text: e?.message || 'Could not start the repayment.' })
    } finally { setBusy(null) }
  }

  async function toggleAutoDebit(next: boolean) {
    if (busy) return
    setBusy('auto'); setFlash(null)
    try {
      const res = await setPayLaterAutoDebit(next)
      setFlash({
        kind: 'ok',
        text: res.enabled
          ? 'Auto-debit on — we will collect your balance on the due date (you can turn this off any time).'
          : 'Auto-debit off — you stay in control; repay manually before your due date.',
      })
      await load()
    } catch (e: any) {
      setFlash({ kind: 'err', text: e?.message || 'Could not update auto-debit.' })
    } finally { setBusy(null) }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const locked = !!elig && !elig.unlocked
  const unlocked = !!elig?.unlocked
  const enrolled = !!elig?.enrolled
  const outstanding = Number(elig?.outstanding_r || 0)
  const repayCycle = elig?.ride_to_repay
  const canAuto = !!elig?.has_card && !!elig?.terms_accepted_at
  const autoOn = !!elig?.auto_debit.enabled
  const totalRides = elig?.ride_breakdown?.total_completed ?? elig?.rides_completed ?? 0
  const paidByCard = elig?.ride_breakdown?.paid_by_card ?? elig?.rides_completed ?? 0
  const sameCard = elig?.ride_breakdown?.same_card ?? elig?.rides_completed ?? 0
  const excludedByFarm = elig?.ride_breakdown?.excluded_by_farm ?? 0
  const ridesCounted = elig?.rides_completed ?? 0

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <div className="pt-14 px-5 pb-4 bg-white border-b border-[#F2F2F2] flex items-center gap-3">
        <button onClick={onBack} aria-label="Back" className="w-9 h-9 -ml-1.5 rounded-full flex items-center justify-center active:bg-[#F2F2F2]">
          {BACK_ICON}
        </button>
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold text-[#1A1A1A] leading-tight" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            Ride Now, Pay Later
          </h1>
          <p className="text-[11px] text-[#ADADAD]">Ride today, settle your balance at month-end</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-10">
        {loading && (
          <div className="mx-4 mt-5 rounded-2xl bg-white border border-[#F0F0F0] px-4 py-8 text-center">
            <div className="w-6 h-6 mx-auto rounded-full border-2 border-[#D0D0D0] border-t-[#EA4335] animate-spin" />
            <p className="text-[12px] text-[#ADADAD] mt-3">Loading your status…</p>
          </div>
        )}

        {!loading && error && (
          <div className="mx-4 mt-5 rounded-xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3 text-[12px] font-semibold text-[#C5221F]">
            {error}
          </div>
        )}

        {!loading && !error && elig && (
          <>
            {flash && (
              <div className={`mx-4 mt-4 rounded-xl px-4 py-3 text-[12px] font-semibold border ${flash.kind === 'ok'
                ? 'bg-[#E6F4EA] border-[#B7E1C5] text-[#1E8E3E]'
                : 'bg-[#FCE8E6] border border-[#F5C6C2] text-[#C5221F]'}`}>
                {flash.text}
              </div>
            )}

            {/* Past due — the booking guard blocks new pay-later rides until repaid. */}
            {enrolled && elig.past_due && (
              <div className="mx-4 mt-4 rounded-xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3">
                <p className="text-[12px] font-bold text-[#C5221F]">
                  {fmtRand(elig.past_due_r)} is past its due date
                  {fmtDate(elig.due_date) ? ` (due ${fmtDate(elig.due_date)})` : ''}.
                </p>
                <p className="text-[11px] text-[#C5221F]/80 mt-1">
                  Repay below to keep using Pay Later. Cash and card rides are unaffected.
                </p>
              </div>
            )}

            {/* ── Balance card (enrolled) ── */}
            <div className="mx-4 mt-4 rounded-2xl bg-white border border-[#F0F0F0] p-5 shadow-sm">
              <p className="text-[10px] uppercase tracking-widest text-[#ADADAD] font-semibold">Outstanding balance</p>
              <p className="text-[30px] font-bold text-[#1A1A1A] leading-tight mt-1" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                {fmtRand(outstanding)}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="bg-[#F7F7F7] rounded-xl px-3 py-2.5">
                  <p className="text-[10px] text-[#ADADAD] font-semibold uppercase tracking-wider">Limit</p>
                  <p className="text-[14px] font-semibold text-[#1A1A1A]">{fmtRand(elig.limit_r)}</p>
                </div>
                <div className="bg-[#F7F7F7] rounded-xl px-3 py-2.5">
                  <p className="text-[10px] text-[#ADADAD] font-semibold uppercase tracking-wider">Available</p>
                  <p className={`text-[14px] font-semibold ${elig.available_r <= 0 ? 'text-[#C5221F]' : 'text-[#1E8E3E]'}`}>
                    {fmtRand(elig.available_r)}
                  </p>
                </div>
              </div>
              <p className="text-[11px] text-[#6B6B6B] mt-3 leading-snug">
                {outstanding > 0
                  ? `Due ${fmtDate(elig.due_date) || 'at month-end'} · auto-collected only if auto-debit is on`
                  : 'Nothing owed right now — your full limit is available.'}
                {elig.has_card && elig.card_last4 ? ` · card •••• ${elig.card_last4}` : ''}
              </p>
            </div>

            {/* ── Progress bar 1: UNLOCK (locked riders) ── */}
            {locked && (
              <div className="mx-4 mt-3 rounded-2xl bg-white border border-[#F0F0F0] p-5 shadow-sm">
                <div className="flex items-baseline justify-between mb-2">
                  <p className="text-[13px] font-bold text-[#1A1A1A]">Unlock progress</p>
                  <p className="text-[12px] font-semibold text-[#34A853]">
                    {elig.rides_completed} of {elig.rides_required} rides
                  </p>
                </div>
                <Bar pct={elig.progress_pct} color="#34A853" />
                <p className="text-[11px] text-[#6B6B6B] mt-2.5 leading-snug">
                  Complete {Math.max(0, elig.rides_required - elig.rides_completed)} more paid ride
                  {elig.rides_required - elig.rides_completed === 1 ? '' : 's'} on your saved card to unlock
                  Ride Now, Pay Later.
                </p>
                {/* WHY the count can be lower than ride history — spell out the
                    three filters instead of leaving riders to guess. */}
                <div className="mt-2.5 bg-[#F7F7F7] rounded-xl px-3 py-2.5">
                  <p className="text-[10px] font-semibold text-[#4A4A4A] uppercase tracking-wider mb-1">
                    Why {ridesCounted} of {totalRides}?
                  </p>
                  <p className="text-[10px] text-[#6B6B6B] leading-snug">
                    You have <b>{totalRides}</b> completed rides — <b>{paidByCard}</b> were paid by card
                    (cash doesn't count), <b>{sameCard}</b> with your current card (re-adding a card restarts
                    the count), and each driver counts for at most 4 of your rides together (anti-farming)
                    {' '}→ <b>{ridesCounted} counted</b>
                    {excludedByFarm > 0 ? `, ${excludedByFarm} excluded by the driver cap` : ''}.
                  </p>
                </div>
              </div>
            )}

            {/* ── Unlocked, not yet activated ── */}
            {unlocked && !enrolled && (
              <div className="mx-4 mt-3 rounded-2xl bg-white border border-[#F0F0F0] p-5 shadow-sm">
                <div className="flex items-baseline justify-between mb-2">
                  <p className="text-[13px] font-bold text-[#1A1A1A]">You’ve unlocked Pay Later</p>
                  <p className="text-[12px] font-semibold text-[#34A853]">
                    {elig.rides_completed}/{elig.rides_required} rides ✓
                  </p>
                </div>
                <Bar pct={100} color="#34A853" />
                <p className="text-[11px] text-[#6B6B6B] mt-2.5 leading-snug">
                  {elig.has_card
                    ? `Activate to ride now and repay at month-end from your card •••• ${elig.card_last4 || 'saved card'}.`
                    : 'Add a saved card under Payment Methods first — Pay Later repays from your card.'}
                </p>
                <button
                  onClick={activate}
                  disabled={busy !== null || !elig.has_card}
                  className="w-full mt-3.5 h-11 rounded-xl bg-[#EA4335] text-white text-[13px] font-bold active:opacity-90 disabled:opacity-50"
                >
                  {busy === 'activate' ? 'Activating…' : 'Activate Ride Now, Pay Later'}
                </button>
              </div>
            )}

            {/* ── Terms acceptance (server refuses pay-later bookings without it) ── */}
            {enrolled && !elig.terms_accepted_at && (
              <div className="mx-4 mt-3 rounded-2xl border border-[#FBBC04]/60 bg-[#FFF8E1] p-4">
                <p className="text-[12px] font-bold text-[#8A6D00]">Accept the Pay Later terms</p>
                <p className="text-[11px] text-[#8A6D00]/80 mt-1 leading-snug">
                  You’ll owe the fare at month-end, or clear it faster with ride-to-repay.
                  Accept to book rides with Pay Later.
                </p>
                <button
                  onClick={acceptTerms}
                  disabled={busy !== null}
                  className="mt-3 h-10 px-5 rounded-xl bg-[#1A1A1A] text-white text-[12px] font-bold active:opacity-90 disabled:opacity-50"
                >
                  {busy === 'terms' ? 'Recording…' : 'Accept terms'}
                </button>
              </div>
            )}

            {/* ── Progress bar 2: RIDE-TO-REPAY (balance owed) ── */}
            {enrolled && outstanding > 0 && repayCycle && (
              <div className="mx-4 mt-3 rounded-2xl bg-white border border-[#F0F0F0] p-5 shadow-sm">
                <div className="flex items-baseline justify-between mb-2">
                  <p className="text-[13px] font-bold text-[#1A1A1A]">Ride to repay</p>
                  <p className="text-[12px] font-semibold text-[#4285F4]">
                    {repayCycle.rides_done} of {repayCycle.rides_required} rides
                  </p>
                </div>
                <Bar
                  pct={repayCycle.rides_required > 0 ? (repayCycle.rides_done / repayCycle.rides_required) * 100 : 0}
                  color="#4285F4"
                />
                <p className="text-[11px] text-[#6B6B6B] mt-2.5 leading-snug">
                  {repayCycle.rides_left > 0
                    ? `${repayCycle.rides_left} more ride${repayCycle.rides_left === 1 ? '' : 's'} clear ${fmtRand(repayCycle.amount_per_ride_r)} off your balance — on top of the fare you already owe for them.`
                    : `Your next completed ride clears ${fmtRand(repayCycle.amount_per_ride_r)} off your balance.`}
                  {' '}Progress resets every {repayCycle.rides_required} rides until your {fmtRand(outstanding)} is settled.
                </p>
              </div>
            )}

            {/* ── Repayment option A: "Pay what I owe" by saved card ── */}
            {enrolled && (
              <div className="mx-4 mt-3 rounded-2xl bg-white border border-[#F0F0F0] p-5 shadow-sm">
                <p className="text-[10px] uppercase tracking-widest text-[#ADADAD] font-semibold mb-3">Repay your balance</p>
                {outstanding > 0 ? (
                  <>
                    <div className="flex gap-2.5">
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] font-semibold text-[#6B6B6B]">R</span>
                        <input
                          value={repayAmount}
                          onChange={(e) => setRepayAmount(e.target.value.replace(/[^\d.]/g, ''))}
                          inputMode="decimal"
                          placeholder={outstanding.toFixed(2)}
                          className="w-full h-11 rounded-xl bg-[#F7F7F7] border border-[#EBEBEB] pl-7 pr-3 text-[14px] font-semibold text-[#1A1A1A] outline-none focus:border-[#EA4335]"
                        />
                      </div>
                      <button
                        onClick={repay}
                        disabled={busy !== null || !elig.has_card}
                        className="h-11 px-4 rounded-xl bg-[#EA4335] text-white text-[13px] font-bold active:opacity-90 disabled:opacity-50"
                      >
                        {busy === 'repay' ? 'Sending…' : 'Pay now'}
                      </button>
                    </div>
                    <div className="flex items-center justify-between mt-2.5">
                      <button
                        onClick={() => setRepayAmount(String(outstanding))}
                        className="text-[11px] font-bold text-[#4285F4]"
                      >
                        Pay full {fmtRand(outstanding)}
                      </button>
                      <button
                        onClick={() => setRepayAmount(String(Math.max(1, Math.min(outstanding, 25))))}
                        className="text-[11px] font-bold text-[#4285F4]"
                      >
                        Part payment R25
                      </button>
                    </div>
                    <p className="text-[10px] text-[#ADADAD] mt-2.5 leading-snug">
                      {elig.has_card
                        ? `Charges your saved card •••• ${elig.card_last4 || ''} through Paystack. Your balance updates when your bank confirms the payment.`
                        : 'Add a saved card under Payment Methods to repay from the app.'}
                    </p>
                  </>
                ) : (
                  <p className="text-[12px] text-[#1E8E3E] font-semibold">
                    Nothing owed — ride now and your balance builds for month-end.
                  </p>
                )}
              </div>
            )}

            {/* ── Repayment option B: auto-debit with explicit consent ── */}
            {enrolled && (
              <div className="mx-4 mt-3 mb-4 rounded-2xl bg-white border border-[#F0F0F0] p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[13px] font-bold text-[#1A1A1A]">Auto-debit my card</p>
                    <p className="text-[11px] text-[#6B6B6B] mt-1 leading-snug">
                      On your due date{elig.auto_debit.threshold_r > 0 ? `, or once your balance reaches ${fmtRand(elig.auto_debit.threshold_r)}` : ''}
                      , we charge your saved card for what you owe{elig.auto_debit.retry_days.length > 0 ? ` (retries on day ${elig.auto_debit.retry_days.join(', day ')})` : ''}.
                      Turn it off any time — no mandate, no surprises.
                    </p>
                    {autoOn && elig.auto_debit.consent_at && (
                      <p className="text-[10px] text-[#34A853] font-semibold mt-1.5">
                        Consent given {new Date(elig.auto_debit.consent_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    )}
                    {!canAuto && (
                      <p className="text-[10px] text-[#8A6D00] font-semibold mt-1.5">
                        {elig.has_card ? 'Accept the terms first.' : 'Add a saved card first.'}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => toggleAutoDebit(!autoOn)}
                    disabled={busy !== null || !canAuto}
                    aria-pressed={autoOn}
                    className={`shrink-0 w-12 h-7 rounded-full relative transition-colors disabled:opacity-40 ${autoOn ? 'bg-[#34A853]' : 'bg-[#E0E0E0]'}`}
                  >
                    <span
                      className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-all ${autoOn ? 'left-[22px]' : 'left-0.5'}`}
                    />
                  </button>
                </div>
                {busy === 'auto' && <p className="text-[10px] text-[#ADADAD] mt-2">Saving…</p>}
              </div>
            )}

            {/* Locked riders still see what awaits them + how to speed it up. */}
            {locked && (
              <div className="mx-4 mt-3 mb-4 rounded-2xl border border-[#F0F0F0] bg-white/60 p-4">
                <p className="text-[11px] text-[#6B6B6B] leading-snug">
                  Once unlocked you’ll ride now and repay at month-end, clear parts of the balance with each ride
                  (ride-to-repay), or let auto-debit settle it for you — always from your saved Paystack card.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}


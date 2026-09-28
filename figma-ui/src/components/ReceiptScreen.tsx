import { useEffect, useState } from 'react'
import { Header } from './SettingsScreen'
import {
  formatRand,
  getPaymentMethods,
  getRideReceipt,
  reportLostItem,
  sendTip,
  submitRating,
  type PaymentMethod,
} from '../lib/backend'

/**
 * Trip receipt — the port of the native app/ride/receipt.tsx page, and the only
 * place a rider can do the three things that used to be impossible in the port:
 * rate the driver, tip them, and report a lost item.
 *
 * Contracts (server source + live probes):
 *   GET  /api/rides/:id/receipt -> { receipt: { id, ride_id, pickup_address,
 *        destination_address, distance_km, duration_mins, fare,
 *        ride_request_fee, payment_method, payment_status, created_at,
 *        completed_at, driver_name, driver_phone, vehicle_make, vehicle_model,
 *        license_plate, receipt_number } }
 *   POST /api/ratings            -> { rideId, score, comment }
 *   POST /api/tips               -> { rideId, amount, paymentMethodId? } and the
 *        server really charges the saved card: with no card it answers 400
 *        "No saved card available to tip with…", which is shown to the rider.
 *   POST /api/disputes/lost-item -> { rideId, itemName, itemDescription }
 */

function Sv({ inner, c = '#1A1A1A', size = 16 }: { inner: string; c?: string; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c}
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  )
}

const HEART = '<path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l8.84 8.84 8.84-8.84a5.5 5.5 0 000-7.78z"/>'
const CALL = '<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.18 19.79 19.79 0 01.22 4.6 2 2 0 012.18 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 9.91a16 16 0 006.06 6.06l1.48-1.48a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>'
const CARD = '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>'
const BAG = '<path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/>'
const STAR = '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'

/** "12 Aug · 18:40" — the same shape the rest of the app uses. */
function when(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function ReceiptScreen({
  rideId,
  onBack,
  onReportIssue,
}: {
  rideId: string | null
  onBack: () => void
  /** Opens the dispute screen with this trip attached. */
  onReportIssue: (rideId?: string) => void
}) {
  const [receipt, setReceipt] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  // Rating
  const [stars, setStars] = useState(0)
  const [comment, setComment] = useState('')
  const [rated, setRated] = useState(false)
  const [ratingBusy, setRatingBusy] = useState(false)

  // Tip
  const [showTip, setShowTip] = useState(false)
  const [tipSent, setTipSent] = useState<number | null>(null)
  const [customTip, setCustomTip] = useState('')
  const [cards, setCards] = useState<PaymentMethod[]>([])
  const [cardId, setCardId] = useState<string | null>(null)
  const [tipBusy, setTipBusy] = useState(false)

  // Lost item
  const [showLost, setShowLost] = useState(false)
  const [itemName, setItemName] = useState('')
  const [itemDesc, setItemDesc] = useState('')
  const [lostBusy, setLostBusy] = useState(false)
  const [lostSent, setLostSent] = useState(false)

  useEffect(() => {
    if (!rideId) { setLoading(false); setError('No trip selected.'); return }
    let alive = true
    getRideReceipt(rideId)
      .then((r) => { if (alive) setReceipt(r) })
      .catch((e: any) => { if (alive) setError(`Could not load the receipt: ${e?.message || 'unknown error'}`) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [rideId])

  // Saved cards, so a cash ride can still be tipped from a card. Card rides are
  // charged to the card that paid for the trip (the server's default).
  useEffect(() => {
    getPaymentMethods()
      .then((rows) => {
        setCards(rows || [])
        const preferred = (rows || []).find((c) => c.is_default) || (rows || [])[0]
        if (preferred) setCardId(preferred.id)
      })
      .catch(() => {})
  }, [])

  function flash(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(''), 4000)
  }

  async function rate(score: number) {
    if (!rideId) return
    setStars(score)
    setRatingBusy(true)
    try {
      await submitRating(rideId, score, comment.trim() || undefined)
      setRated(true)
      flash('Thanks — your rating was sent.')
    } catch (e: any) {
      setError(`Could not save your rating: ${e?.message || 'unknown error'}`)
    } finally { setRatingBusy(false) }
  }

  async function tip(amount: number) {
    if (!rideId || !(amount > 0)) return
    setTipBusy(true)
    setError('')
    try {
      // Cash rides name the card explicitly; card rides let the server use the
      // rider's default (the same card that paid).
      const useCard = receipt?.payment_method === 'card' ? undefined : cardId || undefined
      await sendTip(rideId, amount, useCard)
      setTipSent(amount)
      setShowTip(false)
      flash(`Tip sent — ${formatRand(amount)} is on its way to ${receipt?.driver_name || 'your driver'}.`)
    } catch (e: any) {
      // The server's own message is the useful one ("No saved card available to
      // tip with…", "Your card does not have enough funds…").
      setError(`Could not send the tip: ${e?.message || 'unknown error'}`)
    } finally { setTipBusy(false) }
  }

  async function sendLostItem() {
    if (!rideId || !itemName.trim()) {
      setError('Please describe the item you lost.')
      return
    }
    setLostBusy(true)
    setError('')
    try {
      await reportLostItem({ rideId, itemName: itemName.trim(), itemDescription: itemDesc.trim() })
      setLostSent(true)
      setShowLost(false)
      flash('Reported — we told the driver and will follow up.')
    } catch (e: any) {
      setError(`Could not report the item: ${e?.message || 'unknown error'}`)
    } finally { setLostBusy(false) }
  }

  const fare = Number(receipt?.fare || 0)
  const fee = Number(receipt?.ride_request_fee || 0)
  const total = fare + fee + Number(tipSent || 0)
  const suggestions = [0.1, 0.15, 0.2, 0.25].map((p) => ({
    label: `${Math.round(p * 100)}%`,
    amount: Math.round(fare * p),
  })).filter((s) => s.amount > 0)

  const row = (label: string, value: string, strong = false) => (
    <div className="flex items-center justify-between">
      <span className={`text-[13px] ${strong ? 'font-bold text-[#1A1A1A]' : 'text-[#6B6B6B]'}`}>{label}</span>
      <span className={`text-[13px] ${strong ? 'font-extrabold text-[#1A1A1A]' : 'font-semibold text-[#1A1A1A]'}`}>{value}</span>
    </div>
  )

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <Header title="Trip receipt" sub={receipt?.receipt_number || 'Your fare breakdown'} onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-24 pt-5 px-4">

        {error && (
          <div className="rounded-xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3 text-[12px] font-semibold text-[#C5221F] mb-3">{error}</div>
        )}
        {toast && (
          <div className="rounded-xl bg-[#E6F4EA] border border-[#CEEAD6] px-4 py-3 text-[12px] font-semibold text-[#137333] mb-3">{toast}</div>
        )}

        {loading ? (
          <p className="text-[12px] text-[#ADADAD] text-center py-10">Loading your receipt…</p>
        ) : !receipt ? (
          <div className="bg-white rounded-2xl border border-[#F0F0F0] px-4 py-8 text-center shadow-sm">
            <p className="text-[14px] font-bold text-[#1A1A1A]">No receipt found</p>
            <p className="text-[12px] text-[#ADADAD] mt-1">This trip has no fare record yet.</p>
          </div>
        ) : (
          <>
            {/* Total + trip summary */}
            <div className="bg-white rounded-2xl border border-[#F0F0F0] p-5 shadow-sm text-center">
              <p className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold">Total</p>
              <p className="text-[34px] font-bold text-[#1A1A1A] leading-tight" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                {formatRand(total)}
              </p>
              <p className="text-[12px] text-[#ADADAD] mt-1">{when(receipt.completed_at || receipt.created_at)}</p>
            </div>

            <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 mt-3 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex flex-col items-center gap-1 pt-1.5 shrink-0">
                  <div className="w-2 h-2 rounded-full bg-[#1A1A1A]" />
                  <div className="w-px h-6 bg-[#E8E8E8]" />
                  <div className="w-2 h-2 rounded-full bg-[#EA4335]" />
                </div>
                <div className="flex flex-col gap-3 flex-1 min-w-0">
                  <p className="text-[13px] text-[#1A1A1A] font-semibold leading-none truncate">{receipt.pickup_address || 'Pickup'}</p>
                  <p className="text-[13px] text-[#1A1A1A] font-semibold leading-none truncate">{receipt.destination_address || 'Drop-off'}</p>
                </div>
              </div>
              <div className="flex gap-4 mt-4 pt-3 border-t border-[#F5F5F5]">
                <div>
                  <p className="text-[11px] text-[#ADADAD]">Distance</p>
                  <p className="text-[13px] font-bold text-[#1A1A1A]">{Number(receipt.distance_km || 0).toFixed(1)} km</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#ADADAD]">Duration</p>
                  <p className="text-[13px] font-bold text-[#1A1A1A]">{Math.round(Number(receipt.duration_mins || 0))} min</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-[11px] text-[#ADADAD]">Paid with</p>
                  <p className="text-[13px] font-bold text-[#1A1A1A] capitalize">{receipt.payment_method || 'cash'}</p>
                </div>
              </div>
            </div>

            {/* Fare breakdown */}
            <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 mt-3 shadow-sm flex flex-col gap-2.5">
              {row('Fare', formatRand(fare))}
              {row('Service fee', formatRand(fee))}
              {tipSent != null && row('Driver tip', formatRand(tipSent))}
              <div className="border-t border-[#F5F5F5] my-0.5" />
              {row('Total', formatRand(total), true)}
              <div className="flex items-center gap-2 mt-1">
                <div className={`w-2 h-2 rounded-full ${String(receipt.payment_status || '').toLowerCase() === 'completed' ? 'bg-[#137333]' : 'bg-[#F9AB00]'}`} />
                <span className="text-[11px] font-semibold text-[#6B6B6B] capitalize">{receipt.payment_status || 'pending'}</span>
              </div>
            </div>

            {/* Driver — real name, vehicle and plate from the ride row. */}
            {receipt.driver_name && (
              <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 mt-3 shadow-sm flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-[#EA4335] flex items-center justify-center shrink-0">
                  <span className="text-[13px] font-bold text-white">
                    {String(receipt.driver_name).split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-[#1A1A1A] capitalize truncate">{receipt.driver_name}</p>
                  <p className="text-[11px] text-[#ADADAD] truncate">
                    {[receipt.vehicle_make, receipt.vehicle_model, receipt.license_plate].filter(Boolean).join(' · ') || 'Vehicle'}
                  </p>
                </div>
                {receipt.driver_phone && (
                  <a href={`tel:${receipt.driver_phone}`} className="w-9 h-9 rounded-full border border-[#EBEBEB] flex items-center justify-center active:bg-[#F7F7F7] shrink-0">
                    <Sv inner={CALL} c="#1A1A1A" size={15} />
                  </a>
                )}
              </div>
            )}

            {/* Rating — the unrated-trip prompt the native receipt shows. */}
            <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 mt-3 shadow-sm">
              <p className="text-[14px] font-bold text-[#1A1A1A]">Rate {receipt.driver_name || 'your driver'}</p>
              <p className="text-[12px] text-[#6B6B6B] mt-0.5">
                {rated ? 'Thanks for the feedback.' : 'How was your trip?'}
              </p>
              <div className="flex gap-2 mt-3">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => rate(n)} disabled={ratingBusy} className="active:scale-95 transition-transform disabled:opacity-60">
                    <Sv inner={STAR} c={n <= stars ? '#FBBC04' : '#EBEBEB'} size={26} />
                  </button>
                ))}
              </div>
              {!rated && stars > 0 && (
                <div className="mt-3">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Add a comment (optional)"
                    rows={3}
                    className="w-full rounded-xl border border-[#EBEBEB] bg-white px-4 py-3 text-[13px] font-medium text-[#1A1A1A] outline-none focus:border-[#EA4335] placeholder:text-[#C4C4C4] resize-none"
                  />
                  <button
                    onClick={() => rate(stars)}
                    disabled={ratingBusy}
                    className="mt-2 w-full bg-[#1A1A1A] text-white font-semibold text-[13px] py-3 rounded-xl active:bg-black disabled:opacity-60"
                  >
                    {ratingBusy ? 'Sending…' : 'Submit rating'}
                  </button>
                </div>
              )}
            </div>

            {/* Tip — a real charge against the rider's saved card. */}
            {tipSent != null ? (
              <div className="rounded-2xl bg-[#E6F4EA] border border-[#CEEAD6] px-4 py-4 mt-3 flex items-center gap-2">
                <Sv inner={HEART} c="#137333" size={16} />
                <span className="text-[13px] font-bold text-[#137333]">
                  You tipped {formatRand(tipSent)} — thank you!
                </span>
              </div>
            ) : !showTip ? (
              <button
                onClick={() => { setShowTip(true); setError('') }}
                className="w-full rounded-2xl bg-[#E6F4EA] border border-[#CEEAD6] px-4 py-4 mt-3 flex items-center justify-center gap-2 active:bg-[#D8EDDF]"
              >
                <Sv inner={HEART} c="#137333" size={16} />
                <span className="text-[13px] font-bold text-[#137333]">
                  Add a tip for {receipt.driver_name || 'your driver'}
                </span>
              </button>
            ) : (
              <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 mt-3 shadow-sm">
                <p className="text-[14px] font-bold text-[#1A1A1A]">Tip your driver</p>

                {receipt.payment_method !== 'card' && (
                  <div className="mt-3">
                    <p className="text-[11px] font-bold text-[#ADADAD] uppercase mb-2">Pay tip with</p>
                    {cards.length === 0 ? (
                      <div className="rounded-xl bg-[#FEF7E0] border border-[#FEEFC3] px-3 py-2.5">
                        <p className="text-[12px] text-[#8A6D00]">
                          No saved card yet. Add one from the payment sheet the next time you book a ride.
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {cards.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => setCardId(c.id)}
                            className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${
                              cardId === c.id ? 'border-[#EA4335] bg-[#FEF0EF]' : 'border-[#EBEBEB] bg-white'
                            }`}
                          >
                            <span className="flex items-center gap-2 text-[13px] font-semibold text-[#1A1A1A]">
                              <Sv inner={CARD} c="#4A4A4A" size={15} /> •••• {c.last4 || '****'}
                            </span>
                            <span className="text-[11px] text-[#ADADAD]">{c.card_type || 'card'}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mt-3">
                  {suggestions.map((s) => (
                    <button
                      key={s.label}
                      onClick={() => tip(s.amount)}
                      disabled={tipBusy}
                      className="flex-1 min-w-[72px] rounded-xl bg-[#F7F7F7] border border-[#EBEBEB] py-2.5 disabled:opacity-60"
                    >
                      <span className="block text-[11px] font-bold text-[#ADADAD]">{s.label}</span>
                      <span className="block text-[13px] font-extrabold text-[#1A1A1A]">{formatRand(s.amount)}</span>
                    </button>
                  ))}
                </div>

                <div className="flex gap-2 mt-3">
                  <input
                    value={customTip}
                    onChange={(e) => setCustomTip(e.target.value)}
                    inputMode="decimal"
                    placeholder="Custom amount"
                    className="flex-1 h-11 rounded-xl bg-[#F7F7F7] border border-[#EBEBEB] px-3 text-[13px] text-[#1A1A1A] outline-none focus:border-[#EA4335] placeholder:text-[#C4C4C4]"
                  />
                  <button
                    onClick={() => tip(Number(customTip))}
                    disabled={tipBusy || !(Number(customTip) > 0)}
                    className="px-5 bg-[#EA4335] text-white font-semibold text-[13px] rounded-xl active:bg-[#C5221F] disabled:opacity-50"
                  >
                    {tipBusy ? 'Sending…' : 'Send tip'}
                  </button>
                </div>
                <button onClick={() => setShowTip(false)} className="w-full mt-2 text-[12px] font-semibold text-[#6B6B6B] py-2">
                  Not now
                </button>
              </div>
            )}

            {/* Lost item — the native app's app/lost-item.tsx path. */}
            {lostSent ? (
              <div className="rounded-2xl bg-[#E6F4EA] border border-[#CEEAD6] px-4 py-4 mt-3 flex items-center gap-2">
                <Sv inner={BAG} c="#137333" size={16} />
                <span className="text-[13px] font-bold text-[#137333]">Lost item reported — the driver has been told.</span>
              </div>
            ) : !showLost ? (
              <button
                onClick={() => { setShowLost(true); setError('') }}
                className="w-full bg-white rounded-2xl border border-[#F0F0F0] px-4 py-4 mt-3 shadow-sm flex items-center gap-3 active:bg-[#F7F7F7]"
              >
                <Sv inner={BAG} c="#1A1A1A" size={17} />
                <span className="flex-1 text-left text-[13px] font-semibold text-[#1A1A1A]">I left something in the car</span>
                <span className="text-[#C4C4C4] text-[18px] leading-none">›</span>
              </button>
            ) : (
              <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 mt-3 shadow-sm">
                <p className="text-[14px] font-bold text-[#1A1A1A]">Lost item</p>
                <p className="text-[12px] text-[#6B6B6B] mt-0.5">We'll pass this to {receipt.driver_name || 'your driver'}.</p>
                <input
                  value={itemName}
                  onChange={(e) => setItemName(e.target.value)}
                  placeholder="What did you leave? e.g. black backpack"
                  className="w-full h-11 rounded-xl bg-[#F7F7F7] border border-[#EBEBEB] px-3 mt-3 text-[13px] text-[#1A1A1A] outline-none focus:border-[#EA4335] placeholder:text-[#C4C4C4]"
                />
                <textarea
                  value={itemDesc}
                  onChange={(e) => setItemDesc(e.target.value)}
                  placeholder="Where were you sitting? Anything else that helps."
                  rows={3}
                  className="w-full rounded-xl border border-[#EBEBEB] bg-white px-4 py-3 mt-2 text-[13px] font-medium text-[#1A1A1A] outline-none focus:border-[#EA4335] placeholder:text-[#C4C4C4] resize-none"
                />
                <div className="flex gap-2 mt-3">
                  <button onClick={() => setShowLost(false)} className="flex-1 border border-[#EBEBEB] text-[#4A4A4A] font-semibold text-[13px] py-3 rounded-xl active:bg-[#F7F7F7]">
                    Cancel
                  </button>
                  <button
                    onClick={sendLostItem}
                    disabled={lostBusy}
                    className="flex-1 bg-[#EA4335] text-white font-semibold text-[13px] py-3 rounded-xl active:bg-[#C5221F] disabled:opacity-60"
                  >
                    {lostBusy ? 'Reporting…' : 'Report item'}
                  </button>
                </div>
              </div>
            )}

            {/* Disputes — POST /api/disputes with this ride attached. */}
            <button
              onClick={() => onReportIssue(rideId || undefined)}
              className="w-full border border-[#EBEBEB] text-[#4A4A4A] font-semibold text-[13px] py-4 rounded-2xl mt-3 active:bg-[#F7F7F7]"
            >
              Report an issue with this trip
            </button>
          </>
        )}
      </div>
    </div>
  )
}

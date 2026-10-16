import { useEffect, useRef, useState } from 'react'
import { getRidePayment, openExternalUrl, type RidePaymentState } from '../lib/backend'

/**
 * Ride payment status — the card-preauthorization "return page" as a live card.
 *
 * After booking (and after Paystack's secure tab closes) this polls
 * GET /api/rides/:id/payment and tells the rider the exact state of their money:
 *
 *   HOLD_PENDING     "Holding funds on your card" (+ open the secure page)
 *   HOLD_ACTIVE      "Funds held — searching for your driver"  /  "Ride in progress"
 *   CAPTURE_PENDING  "Ride finished — confirming your payment"
 *   PAID             "Payment complete"
 *   RELEASED         "Your funds have been released"
 *   PAYMENT_FAILED   "Payment failed" (with support guidance)
 *
 * Cash / pay-later rides (NONE) render nothing. Polling stops on terminal
 * states; read failures keep the last known state and show a quiet retry hint
 * instead of blanking the card.
 */
export default function RidePaymentStatus({
  rideId,
  className = '',
}: {
  rideId: string | null
  className?: string
}) {
  const [state, setState] = useState<RidePaymentState | null>(null)
  const [readError, setReadError] = useState('')
  const [opening, setOpening] = useState(false)
  const terminal = useRef(false)

  useEffect(() => {
    if (!rideId) return
    let alive = true
    terminal.current = false

    const poll = async () => {
      try {
        const s = await getRidePayment(rideId)
        if (!alive) return
        setState(s)
        setReadError('')
        const ps = String(s?.paymentStatus || 'NONE')
        if (ps === 'PAID' || ps === 'RELEASED' || ps === 'PAYMENT_FAILED' || ps === 'HOLD_EXPIRED') {
          terminal.current = true
        }
      } catch (e: any) {
        if (alive) setReadError(e?.message || 'Could not read the payment status')
      }
    }

    void poll()
    const timer = setInterval(() => {
      if (!terminal.current) void poll()
    }, 3000)
    return () => { alive = false; clearInterval(timer) }
  }, [rideId])

  if (!rideId || !state) return null
  const ps = String(state.paymentStatus || 'NONE')
  if (ps === 'NONE') return null // cash / pay-later — no card, no card UI

  const held =
    state.holdAmountCents != null ? `R${(Number(state.holdAmountCents) / 100).toFixed(2)}` : null
  const inTrip = ['accepted', 'driver_arrived', 'in_progress'].includes(String(state.rideStatus))

  let tone: 'amber' | 'blue' | 'green' | 'red' = 'amber'
  let title = ''
  let sub = ''
  let spinner = false

  switch (ps) {
    case 'HOLD_PENDING':
      tone = 'amber'
      spinner = true
      title = 'Holding funds on your card'
      sub = 'Nothing is charged — only held. Complete the secure payment page to confirm your card.'
      break
    case 'HOLD_ACTIVE':
      tone = 'blue'
      if (inTrip) {
        title = 'Ride in progress — funds held'
        sub = `${held ? `${held} is` : 'Your fare is'} held on your card (not charged). You pay only when the ride ends.`
      } else {
        spinner = true
        title = 'Funds held — searching for your driver'
        sub = `${held ? `${held} held` : 'Funds held'} on your card, not charged. Released automatically if no driver is found.`
      }
      break
    case 'CAPTURE_PENDING':
      tone = 'amber'
      spinner = true
      title = 'Ride finished — confirming payment'
      sub = 'Your bank is confirming the final fare. This takes a few seconds.'
      break
    case 'PAID':
      tone = 'green'
      title = 'Payment complete'
      sub =
        state.capturedAmount != null
          ? `R${Number(state.capturedAmount).toFixed(2)} paid — thanks for riding with Vura.`
          : 'Thanks for riding with Vura!'
      break
    case 'RELEASED':
      tone = 'green'
      title = 'Your funds have been released'
      sub = 'The hold is gone — nothing was charged.'
      break
    case 'PAYMENT_FAILED':
      tone = 'red'
      title = 'Payment failed'
      sub = 'Your bank could not confirm the fare. Nothing extra was taken — please contact support to resolve it.'
      break
    case 'HOLD_EXPIRED':
      tone = 'red'
      title = 'The hold expired'
      sub = 'The hold window passed without a ride completing, so the funds were freed. Nothing was charged.'
      break
  }

  const tones = {
    amber: { border: 'border-[#F5E0C3]', bg: 'bg-[#FFF8EE]', dot: '#E8A33D' },
    blue: { border: 'border-[#D6E4F5]', bg: 'bg-[#F3F8FE]', dot: '#1A73E8' },
    green: { border: 'border-[#CDEBD9]', bg: 'bg-[#F1FBF5]', dot: '#137333' },
    red: { border: 'border-[#F5C6C2]', bg: 'bg-[#FEF3F2]', dot: '#C5221F' },
  }[tone]

  return (
    <div className={`rounded-2xl border ${tones.border} ${tones.bg} px-4 py-3.5 ${className}`}>
      <div className="flex items-start gap-3">
        {spinner ? (
          <div className="w-4 h-4 mt-0.5 rounded-full border-2 border-[#E0E0E0] border-t-[#EA4335] animate-spin shrink-0" />
        ) : (
          <span className="w-2.5 h-2.5 mt-1.5 rounded-full shrink-0" style={{ background: tones.dot }} />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-[#1A1A1A]">{title}</p>
          <p className="text-[12px] text-[#6B6B6B] mt-0.5 leading-snug">{sub}</p>
          {ps === 'HOLD_PENDING' && state.authorizationUrl && (
            <button
              onClick={async () => {
                if (opening) return
                setOpening(true)
                try {
                  await openExternalUrl(state.authorizationUrl!)
                } finally {
                  setOpening(false)
                }
              }}
              disabled={opening}
              className="mt-2.5 w-full bg-[#EA4335] active:bg-[#C5221F] disabled:opacity-60 text-white font-semibold text-[13px] py-2.5 rounded-xl"
            >
              {opening ? 'Opening…' : 'Open the secure payment page'}
            </button>
          )}
          {readError && (
            <p className="text-[11px] text-[#ADADAD] mt-1">
              Status update failed — retrying… ({readError})
            </p>
          )}
          {state.reference && (
            <p className="text-[10px] text-[#ADADAD] mt-1 font-mono truncate">ref {state.reference}</p>
          )}
        </div>
      </div>
    </div>
  )
}


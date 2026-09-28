import { useEffect, useState } from 'react'
import { Header } from './SettingsScreen'
import {
  deletePaymentMethod,
  getPaymentMethods,
  openExternalUrl,
  registerPaystackCard,
  verifyPayment,
  type PaymentMethod,
} from '../lib/backend'

/**
 * Payment Methods — the cards on the account.
 *
 * The Settings row used to be a dead button (field report 27 Sep 2026: "when I
 * open Payment Methods let it pull the person's cards"). This lists what the
 * server actually holds on GET /api/payments/methods, lets a card be removed, and
 * adds one through Paystack's hosted checkout — the same two-step flow the
 * booking screen uses (register -> secure page in a Custom Tab -> poll verify).
 */
export default function PaymentMethods({ onBack }: { onBack: () => void }) {
  const [cards, setCards] = useState<PaymentMethod[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [removing, setRemoving] = useState('')

  async function load() {
    setLoading(true)
    // The endpoint returns a bare array (verified live); anything else is treated
    // as "no cards" so a shape change can never blank the screen.
    const rows = await getPaymentMethods().catch(() => [] as PaymentMethod[])
    setCards(Array.isArray(rows) ? rows : [])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  async function add() {
    if (busy) return
    setBusy(true)
    setMsg('Opening the secure payment page…')
    try {
      const reg = await registerPaystackCard()
      if (!reg?.reference || !reg?.authorizationUrl) {
        setMsg(reg?.error || 'Could not start card setup. Please try again.')
        return
      }
      await openExternalUrl(reg.authorizationUrl)
      setMsg('Waiting for your bank to confirm…')

      // Poll until the server has the card. `abandoned` is Paystack's resting
      // status for a checkout nobody has paid yet, so it only counts as final
      // after a grace period; `failed` is a genuine decline.
      const startedAt = Date.now()
      const ABANDON_GRACE = 2 * 60 * 1000
      const CEILING = 15 * 60 * 1000
      for (;;) {
        await new Promise((r) => setTimeout(r, 3000))
        const v = await verifyPayment(reg.reference).catch(() => null)
        const status = v?.status
        if (status === 'success' || status === 'completed' || status === 'refunded') {
          await load()
          setMsg('Card added.')
          return
        }
        if (status === 'failed' || (status === 'abandoned' && Date.now() - startedAt >= ABANDON_GRACE)) {
          setMsg(`The payment page didn't complete (${status}). No card was saved.`)
          return
        }
        if (Date.now() - startedAt > CEILING) {
          setMsg('Still waiting for bank approval. The card saves as soon as it is approved.')
          return
        }
      }
    } catch (e: any) {
      setMsg(e?.message || 'Could not add the card.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    setRemoving(id)
    const before = cards
    setCards((rows) => rows.filter((c) => c.id !== id))
    try {
      await deletePaymentMethod(id)
      setMsg('Card removed.')
    } catch (e: any) {
      setCards(before)
      setMsg(e?.message || 'Could not remove that card.')
    } finally {
      setRemoving('')
    }
  }

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <Header title="Payment Methods" sub="Cards saved on your account" onBack={onBack} />
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-24">
        <div className="bg-white rounded-2xl border border-[#F0F0F0] overflow-hidden shadow-sm">
          {loading ? (
            <div className="px-4 py-6 flex items-center gap-3">
              <div className="w-4 h-4 rounded-full border-2 border-[#E0E0E0] border-t-[#EA4335] animate-spin" />
              <span className="text-[13px] text-[#6B6B6B]">Loading your cards…</span>
            </div>
          ) : cards.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-[14px] font-semibold text-[#1A1A1A]">No cards saved</p>
              <p className="text-[12px] text-[#6B6B6B] mt-1">
                Add a card to pay for rides without cash. Cash always stays available.
              </p>
            </div>
          ) : (
            cards.map((c, i) => (
              <div
                key={c.id}
                className={`flex items-center gap-3 px-4 py-3.5 ${i < cards.length - 1 ? 'border-b border-[#F5F5F5]' : ''}`}
              >
                <div className="w-10 h-10 rounded-xl bg-[#F7F7F7] border border-[#EBEBEB] flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-bold text-[#6B6B6B] uppercase">
                    {(c.card_type || 'card').slice(0, 4)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-semibold text-[#1A1A1A]">
                    {(c.card_type || 'Card').toUpperCase()} •••• {c.last4 || '····'}
                  </p>
                  <p className="text-[11px] text-[#ADADAD] mt-0.5">
                    {c.bank || 'Saved card'}{c.is_default ? ' · Default' : ''}
                  </p>
                </div>
                <button
                  onClick={() => remove(c.id)}
                  disabled={removing === c.id}
                  className="shrink-0 text-[12px] font-semibold text-[#C5221F] px-3 py-2 rounded-xl border border-[#F5C6C2] active:bg-[#FEF0EF] disabled:opacity-50"
                >
                  {removing === c.id ? '…' : 'Remove'}
                </button>
              </div>
            ))
          )}
        </div>

        <button
          onClick={add}
          disabled={busy}
          className={`mt-3 w-full flex items-center gap-3 px-4 py-4 rounded-2xl border-2 border-dashed transition-all ${
            busy ? 'border-[#F2F2F2] bg-[#F7F7F7] opacity-70' : 'border-[#E8E8E8] bg-white active:bg-[#F7F7F7]'
          }`}
        >
          {busy
            ? <div className="w-4 h-4 rounded-full border-2 border-[#D0D0D0] border-t-[#EA4335] animate-spin" />
            : <span className="w-6 h-6 rounded-full bg-[#1A1A1A] text-white text-[15px] font-bold flex items-center justify-center leading-none">+</span>}
          <span className="text-[13px] text-[#1A1A1A] font-semibold">
            {busy ? 'Waiting for your bank…' : 'Add card'}
          </span>
        </button>

        {!!msg && <p className="text-[11px] text-[#6B6B6B] font-medium mt-2.5 leading-snug">{msg}</p>}

        <p className="text-[11px] text-[#ADADAD] mt-4 leading-relaxed">
          Card payments are handled by Paystack. Vura never sees or stores your card number — only
          the last four digits and the bank, so you can recognise the card here.
        </p>
      </div>
    </div>
  )
}

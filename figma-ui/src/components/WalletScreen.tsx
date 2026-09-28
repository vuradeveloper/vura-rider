import { useCallback, useEffect, useState } from 'react'
import {
  addPaymentMethod,
  Bank,
  deletePaymentMethod,
  getBanks,
  getPaymentMethods,
  getPendingCardEarnings,
  PaymentMethod,
  requestPayout,
} from '../lib/backend'

/**
 * Payments and Withdrawals — modelled on the native app's app/wallet.tsx.
 *
 * The headline figure is the money that arrived on CARD (non-cash) rides, taken
 * from GET /api/payments/driver/earnings/pending — the same call the native
 * wallet makes. Verified live: that endpoint EXCLUDES cash, which is exactly the
 * behaviour asked for. Cash is shown separately so the difference is explicit.
 *
 * Storage mirrors the native app:
 *   server -> the balance figure, saved bank/card records, the bank list
 *   device -> payout history (localStorage, like the old "vura.wallet.*" keys)
 */

const TX_KEY = 'vura.wallet.tx'
const fmtRand = (n: any) => {
  const num = Number(n)
  const safe = Number.isFinite(num) ? num : 0
  const [whole, frac] = safe.toFixed(2).split('.')
  return `R${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac}`
}

type PayoutRecord = {
  id: string
  label: string
  amount: number
  date: string
  status: string
  reference?: string
}

function readTx(): PayoutRecord[] {
  try {
    const raw = localStorage.getItem(TX_KEY)
    return raw ? (JSON.parse(raw) as PayoutRecord[]) : []
  } catch {
    return []
  }
}

function writeTx(rows: PayoutRecord[]) {
  try {
    localStorage.setItem(TX_KEY, JSON.stringify(rows.slice(0, 50)))
  } catch {
    /* storage unavailable */
  }
}

const BACK_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
)

const CHEV = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C4C4C4" strokeWidth="2" strokeLinecap="round">
    <path d="M9 18l6-6-6-6" />
  </svg>
)

function Field({
  label, value, onChange, placeholder, hint,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
}) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-[#4A4A4A] mb-1 ml-0.5">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 rounded-xl bg-[#F7F7F7] border border-[#EBEBEB] px-3 text-[13px] text-[#1A1A1A] outline-none focus:border-[#EA4335] placeholder:text-[#C4C4C4]"
      />
      {hint ? <p className="text-[10px] text-[#ADADAD] mt-1 ml-0.5">{hint}</p> : null}
    </div>
  )
}

export default function WalletScreen({ onBack }: { onBack: () => void }) {
  const [cardMoney, setCardMoney] = useState<number | null>(null)
  const [cardRides, setCardRides] = useState(0)
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [banks, setBanks] = useState<Bank[]>([])
  const [tx, setTx] = useState<PayoutRecord[]>(() => readTx())

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')

  // Add a payout account
  const [adding, setAdding] = useState(false)
  const [bankName, setBankName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [branchCode, setBranchCode] = useState('')
  const [holder, setHolder] = useState('')

  // Withdraw
  const [withdrawing, setWithdrawing] = useState(false)
  const [amount, setAmount] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const [pending, m, b] = await Promise.all([
        getPendingCardEarnings(),
        getPaymentMethods(),
        getBanks(),
      ])
      setCardMoney(Number(pending?.total_earnings) || 0)
      setCardRides(Number(pending?.total_rides) || 0)
      setMethods(Array.isArray(m) ? m : [])
      setBanks(Array.isArray(b) ? b : [])
    } catch (e: any) {
      setError(`Could not load your payment details: ${e?.message || 'unknown error'}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 4500)
    return () => clearTimeout(t)
  }, [toast])

  /** Picking a bank fills the branch code from the bank's own code — the SA
   *  bank "code" the server returns IS the branch/universal code. */
  function chooseBank(name: string) {
    setBankName(name)
    const found = banks.find((x) => x.name === name)
    if (found) setBranchCode(found.code)
  }

  const canSave = bankName.trim() !== '' && accountNumber.replace(/\D/g, '').length >= 6

  /** Saved bank details for a method row (branch code + holder live locally,
   *  because the server's method record has no columns for them). */
  function localDetails(id: string, fallbackLast4?: string | null) {
    try {
      const raw =
        localStorage.getItem(`vura.bank.${id}`) ||
        (fallbackLast4 ? localStorage.getItem(`vura.bank.${fallbackLast4}`) : null)
      return raw
        ? (JSON.parse(raw) as { bankName: string; accountNumber: string; branchCode: string; holder?: string })
        : null
    } catch {
      return null
    }
  }
  // __LOGIC__

  async function saveCard() {
    if (!canSave) return
    setBusy(true)
    setError('')
    const digits = accountNumber.replace(/\D/g, '')
    const last4 = digits.slice(-4) || '0000'
    try {
      // POST /api/payments/methods with a bank-shaped body. Verified live: it
      // accepts card_type, last4 and bank, and echoes back the stored record.
      const created = await addPaymentMethod({ card_type: 'bank', last4, bank: bankName })
      setMethods((prev) => [...prev, created])
      try {
        localStorage.setItem(
          `vura.bank.${created?.id || last4}`,
          JSON.stringify({ bankName, accountNumber: digits, branchCode, holder })
        )
      } catch { /* ignore */ }
      setAdding(false)
      setAccountNumber('')
      setHolder('')
      setToast(`${bankName} ••••${last4} saved — you can withdraw to it`)
    } catch (e: any) {
      setError(`Could not save that account: ${e?.message || 'unknown error'}`)
    } finally {
      setBusy(false)
    }
  }

  async function removeMethod(m: PaymentMethod) {
    setError('')
    try {
      await deletePaymentMethod(m.id)
      setMethods((prev) => prev.filter((x) => x.id !== m.id))
      setToast('Payout account removed')
    } catch (e: any) {
      setError(`Could not remove that account: ${e?.message || 'unknown error'}`)
    }
  }

  async function withdraw() {
    const saved = methods.length ? localDetails(methods[0].id, methods[0].last4) : null
    const target = saved
      ? { bankName: saved.bankName, accountNumber: saved.accountNumber, bankCode: saved.branchCode }
      : { bankName, accountNumber: accountNumber.replace(/\D/g, ''), bankCode: branchCode }

    const amt = Math.round((parseFloat(amount.replace(',', '.')) || 0) * 100) / 100
    if (!target.bankName || !target.accountNumber) {
      setError('Add the bank account you want to withdraw to first.')
      return
    }
    if (amt <= 0) {
      setError('Enter how much you want to withdraw.')
      return
    }
    if (cardMoney != null && amt > cardMoney) {
      setError(`The most you can withdraw is ${fmtRand(cardMoney)} — that is the card money available.`)
      return
    }
    setBusy(true)
    setError('')
    const res = await requestPayout({
      bankCode: target.bankCode || '',
      accountNumber: target.accountNumber,
      bankName: target.bankName,
      amount: amt,
    })
    const record: PayoutRecord = {
      id: String(Date.now()),
      label: `Withdrawal to ${target.bankName} ••••${String(target.accountNumber).slice(-4)}`,
      amount: -amt,
      date: new Date().toISOString(),
      status: res.ok ? 'Sent' : res.unavailable ? 'Queued' : 'Failed',
      reference: res.reference,
    }
    const next = [record, ...tx]
    setTx(next)
    writeTx(next)
    setWithdrawing(false)
    setAmount('')
    if (res.ok) setToast(`${fmtRand(amt)} sent to ${target.bankName}`)
    else if (res.unavailable) setToast(res.message) // honest: nothing moved yet
    else setError(res.message)
    setBusy(false)
    void load()
  }

  const payoutAccount = methods[0] ? localDetails(methods[0].id, methods[0].last4) : null

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      {/* Header */}
      <div className="pt-14 px-5 pb-4 bg-white border-b border-[#F2F2F2] flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 rounded-full border border-[#EBEBEB] flex items-center justify-center shrink-0 active:bg-[#F7F7F7]">
          {BACK_ICON}
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-[22px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Payments and Withdrawals</h1>
          <p className="text-[11px] text-[#ADADAD] mt-0.5">Card earnings, payout account and history</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-24 pt-4">
        {toast && (
          <div className="mx-4 mb-3 rounded-xl bg-[#E6F4EA] border border-[#CEEAD6] px-4 py-3 text-[12px] font-semibold text-[#137333]">{toast}</div>
        )}
        {error && (
          <div className="mx-4 mb-3 rounded-xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3 text-[12px] font-semibold text-[#C5221F]">{error}</div>
        )}

        {/* The card money available to withdraw */}
        <div className="mx-4 bg-white rounded-3xl border border-[#F0F0F0] p-5 shadow-sm">
          <p className="text-[11px] text-[#ADADAD] uppercase tracking-widest font-semibold">Available to withdraw</p>
          <p className="text-[38px] font-bold text-[#1A1A1A] leading-none mt-2" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            {loading ? '—' : fmtRand(cardMoney ?? 0)}
          </p>
          <p className="text-[12px] text-[#6B6B6B] mt-2">
            From <span className="font-semibold">{cardRides}</span> card payment{cardRides === 1 ? '' : 's'}
          </p>
          <div className="mt-3 pt-3 border-t border-[#F5F5F5] flex items-start gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FBBC04] mt-1.5 shrink-0" />
            <p className="text-[11px] text-[#ADADAD]">
              Cash rides are not included — this is only the money that came in on card, the same figure the
              previous driver app showed. Cash is settled separately.
            </p>
          </div>
        </div>

        {/* Withdraw */}
        <div className="mx-4 mt-3 bg-white rounded-2xl border border-[#F0F0F0] overflow-hidden shadow-sm">
          <p className="text-[10px] uppercase tracking-widest text-[#ADADAD] font-semibold px-4 pt-3.5 pb-1.5">Withdraw</p>
          <div className="px-4 py-3 border-t border-[#F5F5F5]">
            <p className="text-[12px] text-[#6B6B6B]">
              To{' '}
              <span className="font-semibold text-[#1A1A1A]">
                {methods[0]
                  ? `${methods[0].bank || methods[0].card_type || 'account'} ••••${methods[0].last4 || '----'}`
                  : 'no account yet'}
              </span>
              {payoutAccount?.branchCode ? <span className="text-[#ADADAD]"> · branch {payoutAccount.branchCode}</span> : null}
            </p>
            {payoutAccount?.holder ? <p className="text-[11px] text-[#ADADAD] mt-0.5">{payoutAccount.holder}</p> : null}
          </div>

          {withdrawing ? (
            <div className="px-4 pb-4 space-y-2.5">
              <Field
                label="Amount to withdraw"
                value={amount}
                onChange={(v) => setAmount(v.replace(/[^\d.,]/g, ''))}
                placeholder={cardMoney != null ? String(cardMoney) : '0.00'}
                hint={cardMoney != null ? `Available ${fmtRand(cardMoney)}` : undefined}
              />
              <div className="flex gap-2.5">
                <button onClick={() => setWithdrawing(false)} className="h-11 px-5 rounded-xl border border-[#EBEBEB] text-[13px] font-bold text-[#1A1A1A]">
                  Cancel
                </button>
                <button
                  onClick={withdraw}
                  disabled={busy || methods.length === 0}
                  className="flex-1 h-11 rounded-xl bg-[#EA4335] text-white text-[13px] font-bold active:opacity-90 disabled:opacity-50"
                >
                  {busy ? 'Submitting…' : 'Withdraw to bank'}
                </button>
              </div>
            </div>
          ) : (
            <div className="px-4 pb-4">
              <button
                onClick={() => setWithdrawing(true)}
                disabled={methods.length === 0}
                className="w-full h-11 rounded-xl bg-[#EA4335] text-white text-[13px] font-bold active:opacity-90 disabled:opacity-50"
              >
                {methods.length === 0 ? 'Add a bank account first' : 'Withdraw to bank'}
              </button>
            </div>
          )}
        </div>
        {/* __ACCOUNT__ */}

        {/* Add a bank account to withdraw to */}
        <div className="mx-4 mt-3 bg-white rounded-2xl border border-[#F0F0F0] overflow-hidden shadow-sm">
          <p className="text-[10px] uppercase tracking-widest text-[#ADADAD] font-semibold px-4 pt-3.5 pb-1.5">Withdraw to</p>

          {methods.length > 0 && (
            <div className="border-t border-[#F5F5F5] divide-y divide-[#F5F5F5]">
              {methods.map((m) => {
                const d = localDetails(m.id, m.last4)
                return (
                  <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[#1A1A1A] font-semibold truncate">
                        {m.bank || m.card_type || 'Account'} ••••{m.last4 || '----'}
                      </p>
                      <p className="text-[11px] text-[#ADADAD] mt-0.5 truncate">
                        {d?.holder ? `${d.holder} · ` : ''}
                        {d?.branchCode ? `branch ${d.branchCode}` : m.is_default ? 'default payout account' : ''}
                      </p>
                    </div>
                    <button
                      onClick={() => removeMethod(m)}
                      className="text-[11px] font-semibold text-[#EA4335] shrink-0 active:opacity-70"
                    >
                      Remove
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {adding ? (
            <div className="px-4 pb-4 pt-3 space-y-2.5 border-t border-[#F5F5F5]">
              {/* Bank — from GET /api/payments/banks (real SA banks + codes) */}
              <div>
                <label className="block text-[11px] font-medium text-[#4A4A4A] mb-1 ml-0.5">Bank</label>
                <select
                  value={bankName}
                  onChange={(e) => chooseBank(e.target.value)}
                  className="w-full h-10 rounded-xl bg-[#F7F7F7] border border-[#EBEBEB] px-3 text-[13px] text-[#1A1A1A] outline-none focus:border-[#EA4335]"
                >
                  <option value="">Select your bank</option>
                  {banks.map((b) => (
                    <option key={b.code} value={b.name}>{b.name}</option>
                  ))}
                </select>
              </div>

              <Field
                label="Bank Account Number"
                value={accountNumber}
                onChange={(v) => setAccountNumber(v.replace(/\D/g, ''))}
                placeholder="62012345678"
              />

              {/* Branch code — auto-filled from the chosen bank, editable */}
              <Field
                label="Branch Code"
                value={branchCode}
                onChange={(v) => setBranchCode(v.replace(/\D/g, ''))}
                placeholder="250655"
                hint="Filled in from the bank you chose — change it if your branch differs"
              />

              <Field
                label="Account Holder"
                value={holder}
                onChange={setHolder}
                placeholder="Name as it appears on the account"
              />

              <div className="flex gap-2.5 pt-0.5">
                <button onClick={() => setAdding(false)} className="h-11 px-5 rounded-xl border border-[#EBEBEB] text-[13px] font-bold text-[#1A1A1A]">
                  Cancel
                </button>
                <button
                  onClick={saveCard}
                  disabled={busy || !canSave}
                  className="flex-1 h-11 rounded-xl bg-[#EA4335] text-white text-[13px] font-bold active:opacity-90 disabled:opacity-50"
                >
                  {busy ? 'Saving…' : 'Save account'}
                </button>
              </div>
            </div>
          ) : (
            <div className="px-4 pb-4 pt-1 border-t border-[#F5F5F5]">
              <button
                onClick={() => setAdding(true)}
                className="w-full h-11 rounded-xl border border-[#EBEBEB] text-[13px] font-bold text-[#EA4335] active:bg-[#FEF0EF]"
              >
                + Add bank account to withdraw to
              </button>
            </div>
          )}
        </div>

        {/* Payout history */}
        <div className="mx-4 mt-3 bg-white rounded-2xl border border-[#F0F0F0] overflow-hidden shadow-sm">
          <p className="text-[10px] uppercase tracking-widest text-[#ADADAD] font-semibold px-4 pt-3.5 pb-1.5">Withdrawal history</p>
          {tx.length === 0 ? (
            <p className="px-4 py-4 text-[12px] text-[#ADADAD] border-t border-[#F5F5F5]">No withdrawals yet.</p>
          ) : (
            <div className="border-t border-[#F5F5F5] divide-y divide-[#F5F5F5]">
              {tx.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0 flex-1 pr-3">
                    <p className="text-[13px] text-[#1A1A1A] font-semibold truncate">{r.label}</p>
                    <p className="text-[11px] text-[#ADADAD] mt-0.5">
                      {new Date(r.date).toLocaleString('en-ZA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {' · '}{r.status}
                    </p>
                  </div>
                  <span className="text-[13px] font-bold text-[#1A1A1A] shrink-0" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                    {fmtRand(r.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
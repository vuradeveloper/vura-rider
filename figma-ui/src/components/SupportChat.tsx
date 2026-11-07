import { useEffect, useRef, useState } from 'react'
import { Header } from './SettingsScreen'
import { formatRand, getLiveChat, getStoredUser, sendLiveChatMessage } from '../lib/backend'
import type { RiderLiveChat } from '../lib/backend'

/**
 * Live support chat (rider side).
 *
 * One conversation at a time: the server keeps the open chat and the rider can
 * start a new one after it is resolved. While the screen is open it polls every
 * 4 seconds, so an ops reply appears without a refresh.
 */
function timeOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit' }).format(d)
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const key = (x: Date) => x.toLocaleDateString('en-ZA')
  if (key(d) === key(today)) return 'Today'
  if (key(d) === key(new Date(today.getTime() - 86400000))) return 'Yesterday'
  return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long' })
}

function initials(name?: string | null, email?: string | null): string {
  const base = String(name || email || '?').trim()
  const parts = base.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return base.slice(0, 2).toUpperCase()
}

export function SupportChat({ onBack }: { onBack: () => void }) {
  const [chat, setChat] = useState<RiderLiveChat | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [startNew, setStartNew] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  const me = getStoredUser()
  const firstName = String(me?.dbUser?.full_name || me?.email || '')
    .split(/[\s@]/)
    .filter(Boolean)[0]

  async function load(silent = false) {
    try {
      const r = await getLiveChat()
      setChat(r?.chat ?? null)
      if (!silent) setError('')
    } catch (e: any) {
      if (!silent) setError(e?.message || 'Could not load support chat.')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(true), 4000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat?.messages.length, startNew, loading])

  async function send() {
    const message = text.trim()
    if (!message || sending) return
    setSending(true)
    setError('')
    try {
      const r = await sendLiveChatMessage(message)
      setChat(r?.chat ?? null)
      setText('')
      setStartNew(false)
    } catch (e: any) {
      setError(e?.message || 'Could not send your message. Please try again.')
    } finally {
      setSending(false)
    }
  }

  const closed = !!chat && (chat.status === 'resolved' || chat.status === 'closed')
  const showWelcome = !chat || startNew
  const showConversation = !!chat && !startNew

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <Header
        title="Live support"
        sub={closed ? 'This conversation is resolved' : 'A real person replies here'}
        onBack={onBack}
      />

      {error && (
        <div className="mx-4 mt-3 rounded-xl border border-[#F5C6C2] bg-[#FCE8E6] px-4 py-2.5 text-[12px] font-semibold text-[#C5221F]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#F0F0F0] border-t-[#EA4335]" />
        </div>
      ) : (
        <>
          <div ref={bodyRef} className="flex-1 overflow-y-auto">
            {showWelcome ? (
              <div className="px-4 pb-4 pt-5">
                <div className="rounded-3xl border border-[#F0F0F0] bg-white p-5 text-center shadow-sm">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#FEF0EF]">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#EA4335" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                    </svg>
                  </div>
                  <h2 className="mt-3 text-[19px] font-semibold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                    Hi{firstName ? ` ${firstName}` : ''} — how can we help?
                  </h2>
                  <p className="mx-auto mt-1.5 max-w-[280px] text-[12px] leading-relaxed text-[#8A8A8A]">
                    Tell us what happened and a Vura support agent will reply here. You can also attach the
                    trip you need help with.
                  </p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {['My trip fare', 'A lost item', 'My driver', 'A refund'].map((q) => (
                      <button
                        key={q}
                        onClick={() => setText(q)}
                        className="rounded-full border border-[#EBEBEB] bg-[#F7F7F7] px-3 py-1.5 text-[11px] font-semibold text-[#4A4A4A] active:bg-[#EFEFEF]"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                  {startNew && (
                    <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-[#EA4335]">
                      Starting a new conversation
                    </p>
                  )}
                </div>

                <div className="mt-4 rounded-2xl border border-[#F0F0F0] bg-white p-4 shadow-sm">
                  <p className="text-[12px] font-semibold text-[#1A1A1A]">What we can help with</p>
                  <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-[#6B6B6B]">
                    <li>• A fare that looks different from the estimate</li>
                    <li>• A lost item or a problem with your driver</li>
                    <li>• Refunds, payment methods and promo codes</li>
                    <li>• Account, login and safety questions</li>
                  </ul>
                </div>
              </div>
            ) : null}

            {showConversation && chat ? (
              <div className="px-4 pb-3 pt-4">
                {chat.ride_id && (
                  <div className="mb-4 rounded-2xl border border-[#F0F0F0] bg-white px-4 py-3 shadow-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#ADADAD]">Trip in this chat</p>
                      <span className="rounded-full bg-[#F7F7F7] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[#6B6B6B]">
                        {String(chat.ride_status || 'ride').replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="mt-1.5 truncate text-[12.5px] font-semibold text-[#1A1A1A]">
                      {chat.pickup_address || 'Pickup'} → {chat.destination_address || 'Drop-off'}
                    </p>
                    {Number(chat.actual_fare || chat.estimated_fare || 0) > 0 && (
                      <p className="mt-0.5 text-[11px] text-[#8A8A8A]">
                        {formatRand(Number(chat.actual_fare || chat.estimated_fare || 0))}
                      </p>
                    )}
                  </div>
                )}

                {closed && (
                  <div className="mb-4 rounded-2xl border border-[#CEEAD6] bg-[#E6F4EA] px-4 py-3">
                    <p className="text-[12px] font-semibold text-[#137333]">This conversation was resolved.</p>
                    <p className="mt-0.5 text-[11px] text-[#1E6B3A]">
                      If you still need help, start a new chat below.
                    </p>
                  </div>
                )}

                {chat.messages.map((m, i) => {
                  const mine = m.author_role === 'rider'
                  const showDay = i === 0 || dayLabel(chat.messages[i - 1].created_at) !== dayLabel(m.created_at)
                  return (
                    <div key={m.id}>
                      {showDay && (
                        <p className="my-3 text-center text-[10px] font-semibold uppercase tracking-wider text-[#ADADAD]">
                          {dayLabel(m.created_at)}
                        </p>
                      )}
                      <div className={`mb-3 flex items-end gap-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                        {!mine && (
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1A1A1A] text-[9px] font-bold text-white">
                            V
                          </div>
                        )}
                        <div className={`max-w-[78%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                          <div
                            className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                              mine
                                ? 'rounded-br-md bg-[#EA4335] text-white'
                                : 'rounded-bl-md border border-[#EBEBEB] bg-white text-[#1A1A1A]'
                            }`}
                          >
                            {m.message}
                          </div>
                          <span className={`mt-1 text-[9.5px] ${mine ? 'text-[#ADADAD]' : 'text-[#B0B0B0]'}`}>
                            {mine ? 'You' : 'Vura support'} · {timeOf(m.created_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}
          </div>

          {closed && !startNew ? (
            <div className="shrink-0 border-t border-[#EBEBEB] bg-white px-4 pb-6 pt-3">
              <button
                onClick={() => setStartNew(true)}
                className="w-full rounded-2xl bg-[#EA4335] py-3.5 text-[14px] font-bold text-white active:bg-[#C5221F]"
              >
                Start a new chat
              </button>
            </div>
          ) : (
            <div className="shrink-0 border-t border-[#EBEBEB] bg-white px-4 pb-6 pt-3">
              <div className="flex items-end gap-2 rounded-2xl border border-[#EBEBEB] bg-[#FAFAFA] px-3 py-2 focus-within:border-[#EA4335]/40">
                <textarea
                  rows={1}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void send()
                    }
                  }}
                  placeholder="Type your message…"
                  maxLength={4000}
                  className="max-h-28 min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[13px] text-[#1A1A1A] outline-none placeholder:text-[#ADADAD]"
                />
                <button
                  onClick={() => void send()}
                  disabled={!text.trim() || sending}
                  className="shrink-0 rounded-xl bg-[#EA4335] px-4 py-2.5 text-[12px] font-bold text-white active:bg-[#C5221F] disabled:opacity-40"
                >
                  {sending ? '…' : 'Send'}
                </button>
              </div>
              <p className="mt-2 text-center text-[10px] text-[#ADADAD]">
                A real Vura support agent replies here. Prefer email?{' '}
                <a href="mailto:support@vura.app" className="font-semibold text-[#EA4335]">
                  support@vura.app
                </a>
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

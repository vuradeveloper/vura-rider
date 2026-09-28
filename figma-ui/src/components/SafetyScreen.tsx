import { useEffect, useState } from 'react'
import { Header, Field } from './SettingsScreen'
import {
  addEmergencyContact,
  deleteEmergencyContact,
  getActiveRide,
  getEmergencyContacts,
  rideCheckOk,
  shareTrip,
  shareTripLink,
  sosRest,
  stopSharingTrip,
  triggerSos,
  type EmergencyContact,
} from '../lib/backend'

/**
 * Safety Center â€” the port of the native app/safety.tsx page.
 *
 * Everything here is a real call, wired to contracts verified against the live
 * server in figma-ui/_safety2.mjs:
 *   GET    /api/safety/contacts     -> { contacts: [] }
 *   POST   /api/safety/contacts     -> 201 + the stored contact
 *   DELETE /api/safety/contacts/:id -> { success: true }, then gone from the list
 *   POST   /api/safety/sos          -> records the emergency + alerts contacts
 *   POST   /api/safety/share        -> { shareToken, shareUrl } (public link)
 *   POST   /api/safety/share/stop   -> stops the link again
 * SOS and sharing are ALSO emitted over the socket ("safety:sos",
 * "share:generate") like the native app does, so the driver and the ops side
 * see them live.
 */

function Sv({ inner, c = '#EA4335', size = 18 }: { inner: string; c?: string; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={c}
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  )
}

const SHIELD = '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'
const WARN = '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
const SHARE = '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="10.7" x2="15.4" y2="6.3"/><line x1="8.6" y1="13.3" x2="15.4" y2="17.7"/>'
const COPY = '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>'
const CALL = '<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.18 19.79 19.79 0 01.22 4.6 2 2 0 012.18 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 9.91a16 16 0 006.06 6.06l1.48-1.48a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>'
const TRASH = '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/>'
const PERSON = '<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>'
const CHECK = '<polyline points="20 6 9 17 4 12"/>'

type ShareInfo = { url: string; token?: string }

/** The public tracking link survives leaving the screen, like the native store. */
const shareKey = (rideId: string) => `vura.share.${rideId}`

export function SafetyScreen({
  rideId,
  onBack,
  onReportIssue,
}: {
  rideId?: string | null
  onBack: () => void
  onReportIssue: () => void
}) {
  const [contacts, setContacts] = useState<EmergencyContact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  // The ride SOS / sharing act on: the one handed in, else the live active ride.
  const [activeId, setActiveId] = useState<string | null>(rideId ?? null)
  const [share, setShare] = useState<ShareInfo | null>(null)
  const [busy, setBusy] = useState('')
  const [sosArmed, setSosArmed] = useState(false)
  const [checkOkSent, setCheckOkSent] = useState(false)

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [relation, setRelation] = useState('')

  useEffect(() => {
    let alive = true
    getEmergencyContacts()
      .then((rows) => { if (alive) setContacts(rows) })
      .catch((e: any) => { if (alive) setError(`Could not load your contacts: ${e?.message || 'unknown error'}`) })
      .finally(() => { if (alive) setLoading(false) })

    // Opened from Account with no ride: ask the server for the ride in progress
    // so SOS / sharing / RideCheck still work while a trip is running.
    if (!rideId) {
      getActiveRide()
        .then((r: any) => { if (alive && r?.id) setActiveId(String(r.id)) })
        .catch(() => {})
    }
    return () => { alive = false }
  }, [rideId])

  // Restore a link minted earlier for this ride.
  useEffect(() => {
    if (!activeId) return
    try {
      const raw = localStorage.getItem(shareKey(activeId))
      if (raw) setShare(JSON.parse(raw) as ShareInfo)
    } catch { /* storage unavailable */ }
  }, [activeId])

  function flash(msg: string) {
    setToast(msg)
    window.setTimeout(() => setToast(''), 4000)
  }

  async function sendSos() {
    if (!activeId) return
    setBusy('sos')
    setError('')
    try {
      // REST records it and alerts the trusted contacts; the socket event is
      // what the driver + ops dashboard in the live session react to.
      await sosRest(activeId)
      await triggerSos(activeId).catch(() => {})
      setSosArmed(false)
      flash('SOS sent — your emergency contacts and our safety team have been alerted.')
    } catch (e: any) {
      setError(`Could not send SOS: ${e?.message || 'unknown error'}`)
    } finally { setBusy('') }
  }

  async function startSharing() {
    if (!activeId) return
    setBusy('share')
    setError('')
    try {
      const res = await shareTripLink(activeId)
      const url = String(res?.shareUrl || '').trim()
      await shareTrip(activeId).catch(() => {})   // socket "share:generate"
      if (url) {
        const info: ShareInfo = { url, token: res?.shareToken }
        setShare(info)
        try { localStorage.setItem(shareKey(activeId), JSON.stringify(info)) } catch { /* ignore */ }
      } else {
        setError('The server did not return a share link for this trip.')
      }
      const nav: any = navigator
      if (url && typeof nav?.share === 'function') {
        nav.share({ title: 'Track my Vura ride', text: 'Follow my trip live:', url }).catch(() => {})
      }
      flash(url ? 'Trip link created — share it with anyone you trust.' : 'Sharing started.')
    } catch (e: any) {
      setError(`Could not share this trip: ${e?.message || 'unknown error'}`)
    } finally { setBusy('') }
  }

  async function stopSharing() {
    if (!activeId) return
    setBusy('stop')
    try {
      await stopSharingTrip(activeId)
      try { localStorage.removeItem(shareKey(activeId)) } catch { /* ignore */ }
      setShare(null)
      flash('Trip sharing stopped.')
    } catch (e: any) {
      setError(`Could not stop sharing: ${e?.message || 'unknown error'}`)
    } finally { setBusy('') }
  }

  async function copyLink() {
    if (!share?.url) return
    try {
      await navigator.clipboard.writeText(share.url)
      flash('Link copied to your clipboard.')
    } catch {
      flash(share.url)
    }
  }

  async function saveContact() {
    if (!name.trim() || !phone.trim()) {
      setError('Name and phone are both required.')
      return
    }
    setBusy('contact')
    setError('')
    try {
      const created = await addEmergencyContact({
        name: name.trim(),
        phone: phone.trim(),
        relationship: relation.trim() || 'Other',
      })
      // The server answers with the stored row; keep a local echo as a fallback
      // so the list still updates if a proxy strips the body.
      setContacts((prev) => [...prev, {
        id: created?.id || `local-${Date.now()}`,
        name: name.trim(), phone: phone.trim(), relationship: relation.trim() || 'Other',
      }])
      setName(''); setPhone(''); setRelation(''); setAdding(false)
      flash('Emergency contact added.')
    } catch (e: any) {
      setError(`Could not save the contact: ${e?.message || 'unknown error'}`)
    } finally { setBusy('') }
  }

  async function removeContact(c: EmergencyContact) {
    if (!c.id) return
    setBusy(c.id)
    try {
      await deleteEmergencyContact(c.id)
      setContacts((prev) => prev.filter((x) => x.id !== c.id))
    } catch (e: any) {
      setError(`Could not remove the contact: ${e?.message || 'unknown error'}`)
    } finally { setBusy('') }
  }

  async function imOk() {
    if (!activeId) return
    await rideCheckOk(activeId).catch(() => {})
    setCheckOkSent(true)
    flash('Thanks — our safety team knows you are okay.')
  }

  const hasRide = !!activeId

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <Header title="Safety Center" sub="Your safety is our priority" onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-24 pt-5 px-4">

        {error && (
          <div className="rounded-xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3 text-[12px] font-semibold text-[#C5221F] mb-3">{error}</div>
        )}
        {toast && (
          <div className="rounded-xl bg-[#E6F4EA] border border-[#CEEAD6] px-4 py-3 text-[12px] font-semibold text-[#137333] mb-3">{toast}</div>
        )}

        {/* Emergency SOS — two taps so it can never fire by accident. */}
        <button
          onClick={() => (sosArmed ? sendSos() : setSosArmed(true))}
          disabled={!hasRide || busy === 'sos'}
          className={`w-full rounded-2xl px-5 py-5 flex flex-col items-center justify-center gap-2 transition-colors ${
            !hasRide ? 'bg-[#F2B8B5]' : sosArmed ? 'bg-[#B3261E]' : 'bg-[#DC362E] active:bg-[#B3261E]'
          } disabled:opacity-70`}
        >
          <Sv inner={WARN} c="#fff" size={30} />
          <span className="text-[17px] font-extrabold text-white">
            {busy === 'sos' ? 'Sending SOS…' : sosArmed ? 'Tap again to send SOS' : 'Emergency SOS'}
          </span>
          <span className="text-[11px] text-white/85 text-center">
            {hasRide
              ? 'Alerts emergency contacts with your live location'
              : 'Available during a trip — no ride in progress'}
          </span>
        </button>
        {sosArmed && (
          <button onClick={() => setSosArmed(false)} className="w-full mt-2 text-[12px] font-semibold text-[#6B6B6B] py-2">
            Cancel
          </button>
        )}

        {/* Trip sharing — the real public tracking link from the server. */}
        <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 mt-5 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Sv inner={SHARE} c="#1A1A1A" size={16} />
            <p className="text-[14px] font-bold text-[#1A1A1A]">Share your trip</p>
          </div>
          <p className="text-[12px] text-[#6B6B6B]">
            {share ? 'Anyone with this link can follow your trip live.' : 'Send a live tracking link to someone you trust.'}
          </p>
          {share && (
            <div className="mt-3 rounded-xl bg-[#F7F7F7] border border-[#EBEBEB] px-3 py-2.5">
              <p className="text-[11px] text-[#4A4A4A] break-all">{share.url}</p>
            </div>
          )}
          <div className="flex gap-2 mt-3">
            {share ? (
              <>
                <button onClick={copyLink} className="flex-1 flex items-center justify-center gap-1.5 border border-[#EBEBEB] text-[#1A1A1A] font-semibold text-[13px] py-3 rounded-xl active:bg-[#F7F7F7]">
                  <Sv inner={COPY} c="#4A4A4A" size={14} /> Copy link
                </button>
                <button onClick={stopSharing} disabled={busy === 'stop'} className="flex-1 border border-[#F5C6C2] text-[#C5221F] font-semibold text-[13px] py-3 rounded-xl active:bg-[#FEF0EF] disabled:opacity-50">
                  {busy === 'stop' ? 'Stopping…' : 'Stop sharing'}
                </button>
              </>
            ) : (
              <button onClick={startSharing} disabled={!hasRide || busy === 'share'} className="w-full bg-[#1A1A1A] text-white font-semibold text-[13px] py-3 rounded-xl active:bg-black disabled:opacity-40">
                {busy === 'share' ? 'Creating link…' : hasRide ? 'Share trip status' : 'Sharing needs an active trip'}
              </button>
            )}
          </div>
        </div>

        {/* RideCheck — the "are you okay?" prompt the server can send mid-ride. */}
        {hasRide && (
          <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 mt-3 shadow-sm flex items-center gap-3">
            <div className="flex-1">
              <p className="text-[14px] font-bold text-[#1A1A1A]">RideCheck</p>
              <p className="text-[12px] text-[#6B6B6B]">
                {checkOkSent ? 'You told us you are okay.' : 'If our team checks in on you, answer here.'}
              </p>
            </div>
            <button
              onClick={imOk}
              disabled={checkOkSent}
              className="px-4 py-2.5 rounded-xl bg-[#E6F4EA] text-[#137333] font-bold text-[12px] active:bg-[#D8EDDF] disabled:opacity-60 shrink-0"
            >
              {checkOkSent ? 'Confirmed' : "I'm OK"}
            </button>
          </div>
        )}

        {/* Emergency contacts — real CRUD against /api/safety/contacts. */}
        <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 mt-3 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sv inner={PERSON} c="#1A1A1A" size={16} />
              <p className="text-[14px] font-bold text-[#1A1A1A]">Emergency contacts</p>
            </div>
            {!adding && (
              <button onClick={() => { setAdding(true); setError('') }} className="text-[12px] font-bold text-[#EA4335] px-3 py-1.5 rounded-full bg-[#FEF0EF]">
                Add
              </button>
            )}
          </div>

          {loading ? (
            <p className="text-[12px] text-[#ADADAD] py-3">Loading your contacts…</p>
          ) : contacts.length === 0 && !adding ? (
            <p className="text-[12px] text-[#ADADAD] py-2">
              No contacts yet. Add the people we should alert if something happens on a trip.
            </p>
          ) : (
            <div className="flex flex-col">
              {contacts.map((c) => (
                <div key={c.id || c.phone} className="flex items-center gap-3 py-2.5 border-b border-[#F5F5F5] last:border-b-0">
                  <div className="w-9 h-9 rounded-full bg-[#F2F2F2] flex items-center justify-center shrink-0">
                    <Sv inner={PERSON} c="#4A4A4A" size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-[#1A1A1A] truncate">{c.name}</p>
                    <p className="text-[11px] text-[#ADADAD] truncate">{c.relationship || 'Contact'} · {c.phone}</p>
                  </div>
                  <a href={`tel:${c.phone}`} className="w-9 h-9 rounded-full border border-[#EBEBEB] flex items-center justify-center active:bg-[#F7F7F7] shrink-0">
                    <Sv inner={CALL} c="#1A1A1A" size={15} />
                  </a>
                  <button
                    onClick={() => removeContact(c)}
                    disabled={busy === c.id}
                    className="w-9 h-9 rounded-full border border-[#F5C6C2] flex items-center justify-center active:bg-[#FEF0EF] shrink-0 disabled:opacity-50"
                  >
                    {busy === c.id ? <span className="text-[10px] text-[#C5221F]">…</span> : <Sv inner={TRASH} c="#C5221F" size={15} />}
                  </button>
                </div>
              ))}
            </div>
          )}

          {adding && (
            <div className="mt-4 pt-4 border-t border-[#F5F5F5] flex flex-col gap-3">
              <Field label="Name *" value={name} onChange={setName} placeholder="e.g. Thandi Mokoena" />
              <Field label="Phone *" value={phone} onChange={setPhone} placeholder="+27 82 111 2222" />
              <Field label="Relationship" value={relation} onChange={setRelation} placeholder="Sister, friend, spouse…" />
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setAdding(false); setName(''); setPhone(''); setRelation('') }}
                  className="flex-1 border border-[#EBEBEB] text-[#4A4A4A] font-semibold text-[13px] py-3 rounded-xl active:bg-[#F7F7F7]"
                >
                  Cancel
                </button>
                <button
                  onClick={saveContact}
                  disabled={busy === 'contact'}
                  className="flex-1 bg-[#EA4335] text-white font-semibold text-[13px] py-3 rounded-xl active:bg-[#C5221F] disabled:opacity-60"
                >
                  {busy === 'contact' ? 'Saving…' : 'Save contact'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Anything else the rider needs to raise goes through the dispute API. */}
        <button
          onClick={onReportIssue}
          className="w-full bg-white rounded-2xl border border-[#F0F0F0] px-4 py-4 mt-3 shadow-sm flex items-center gap-3 active:bg-[#F7F7F7]"
        >
          <Sv inner={SHIELD} c="#EA4335" size={18} />
          <div className="flex-1 text-left">
            <p className="text-[14px] font-bold text-[#1A1A1A]">Report a safety issue</p>
            <p className="text-[12px] text-[#6B6B6B]">Send it to our safety team with the trip attached</p>
          </div>
          <span className="text-[#C4C4C4] text-[18px] leading-none">›</span>
        </button>
      </div>
    </div>
  )
}

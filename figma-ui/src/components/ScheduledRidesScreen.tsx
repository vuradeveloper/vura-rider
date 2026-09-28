import { useEffect, useState } from 'react'
import { Header, Field } from './SettingsScreen'
import {
  cancelScheduledRide,
  formatRand,
  getMyLocation,
  getScheduledRides,
  reverseGeocode,
  scheduleRide,
  searchPlaces,
  type Place,
} from '../lib/backend'

/**
 * Scheduled rides — the port of the native app/scheduled-rides.tsx page.
 *
 * Everything here is a real call, verified against the live server in
 * figma-ui/_safety2.mjs:
 *   GET  /api/rides/scheduled -> { rides: [...] }   (scheduled + live rides:
 *        the server returns status IN ('scheduled','searching','accepted',
 *        'driver_arrived','in_progress') ordered by scheduled_at)
 *   POST /api/rides/schedule  -> 201 { ride }       (status 'scheduled')
 *   POST /api/rides/scheduled/:id/cancel -> { success, cancellation_fee }
 *
 * The server's reservation window is enforced here too so the rider sees the
 * reason instead of a raw 400 (server/src/routes/rides.ts):
 *   • at least 30 minutes ahead  (code RESERVATION_TOO_SOON)
 *   • at most 90 days ahead      (code RESERVATION_TOO_FAR)
 * The cancellation fee is R15 flat once a driver was matched, and R0 while the
 * ride is still scheduled/searching — the server sends the figure back, and it
 * is shown to the rider rather than assumed.
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

const CAL = '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'
const PIN = '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>'
const CAR = '<path d="M5 17H3v-5l2-5h14l2 5v5h-2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>'
const CHARGE = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="10" y1="11" x2="14" y2="11"/>'

/** "Sat 27 Sep · 08:00" — the shape the native scheduled list uses. */
function when(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const day = d.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })
  const time = d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
  return `${day} · ${time}`
}

/** `<input type="datetime-local">` needs local wall-clock time, not UTC. */
function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Rounds up to the next 5 minutes — the same tidy times the native picker shows. */
function plusMinutes(minutes: number) {
  const d = new Date(Date.now() + minutes * 60_000)
  d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0)
  return d
}

function tomorrowAt(hour: number) {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(hour, 0, 0, 0)
  return d
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  searching: 'Finding a driver',
  accepted: 'Driver assigned',
  driver_arrived: 'Driver arrived',
  in_progress: 'Trip in progress',
}

const MIN_LEAD_MS = 30 * 60 * 1000
const MAX_AHEAD_MS = 90 * 24 * 60 * 60 * 1000

export function ScheduledRidesScreen({ onBack }: { onBack: () => void }) {
  const [rides, setRides] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')

  // The reservation form.
  const [adding, setAdding] = useState(false)
  const [pickup, setPickup] = useState<{ address: string; lat: number; lng: number } | null>(null)
  const [destText, setDestText] = useState('')
  const [dest, setDest] = useState<Place | null>(null)
  const [results, setResults] = useState<Place[]>([])
  const [searching, setSearching] = useState(false)
  const [whenValue, setWhenValue] = useState(() => localInput(plusMinutes(45)))
  const [busy, setBusy] = useState('')

  useEffect(() => {
    let alive = true
    getScheduledRides()
      .then((rows) => { if (alive) setRides(rows) })
      .catch((e: any) => { if (alive) setError(`Could not load your reservations: ${e?.message || 'unknown error'}`) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  // Where the car should collect the rider: the device's own fix, named with the
  // real reverse-geocoded address (a "Current location" placeholder told the
  // driver nothing, exactly like the booking screen's old default).
  useEffect(() => {
    if (!adding || pickup) return
    let alive = true
    getMyLocation()
      .then(async (p) => {
        const r = await reverseGeocode(p.lat, p.lng).catch(() => null)
        if (!alive) return
        setPickup({
          address: r?.address || r?.name || 'Current location',
          lat: p.lat,
          lng: p.lng,
        })
      })
      .catch(() => {})
    return () => { alive = false }
  }, [adding, pickup])

  // Debounced destination search — the same searchPlaces() call the search bar
  // and the booking screen use.
  useEffect(() => {
    if (!adding) return
    const q = destText.trim()
    if (q.length < 3 || dest) { setResults([]); return }
    let alive = true
    setSearching(true)
    const t = setTimeout(() => {
      searchPlaces(q, pickup ? { lat: pickup.lat, lng: pickup.lng } : undefined)
        .then((r) => { if (alive) setResults(r.slice(0, 6)) })
        .catch(() => { if (alive) setResults([]) })
        .finally(() => { if (alive) setSearching(false) })
    }, 400)
    return () => { alive = false; clearTimeout(t) }
  }, [destText, dest, adding, pickup])

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  async function reload() {
    try {
      const rows = await getScheduledRides()
      setRides(rows)
    } catch (e: any) {
      setError(`Could not refresh your reservations: ${e?.message || 'unknown error'}`)
    }
  }

  async function cancel(id: string) {
    setBusy(id)
    setError('')
    try {
      const res = await cancelScheduledRide(id)
      setRides((prev) => prev.filter((r) => String(r.id) !== id))
      const fee = Number(res?.cancellation_fee || 0)
      flash(fee > 0 ? `Reservation cancelled — R${fee.toFixed(2)} fee applies` : 'Reservation cancelled — no fee')
    } catch (e: any) {
      setError(e?.message || 'Could not cancel that reservation')
    } finally { setBusy('') }
  }

  async function reserve() {
    if (!pickup) { setError('Waiting for your location — try again in a moment.'); return }
    if (!dest) { setError('Pick the drop-off from the search results.'); return }
    const at = new Date(whenValue)
    if (isNaN(at.getTime())) { setError('Pick a valid date and time.'); return }
    const lead = at.getTime() - Date.now()
    // Same window the server enforces, so the rider is told here instead of
    // getting a bare 400 back.
    if (lead < MIN_LEAD_MS) { setError('Reservations must be made at least 30 minutes ahead of pickup.'); return }
    if (lead > MAX_AHEAD_MS) { setError('Reservations can be made at most 90 days ahead of pickup.'); return }

    setBusy('create')
    setError('')
    try {
      const res = await scheduleRide({
        pickupAddress: pickup.address,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        destinationAddress: dest.address || dest.name,
        destinationLat: dest.lat,
        destinationLng: dest.lng,
        scheduledAt: at.toISOString(),
        tier: 'go',
      })
      const id = res?.ride?.id
      setAdding(false)
      setDest(null)
      setDestText('')
      setWhenValue(localInput(plusMinutes(45)))
      await reload()
      flash(id ? `Reserved for ${when(res?.ride?.scheduled_at || at.toISOString())}` : 'Ride reserved')
    } catch (e: any) {
      setError(e?.message || 'Could not schedule that ride')
    } finally { setBusy('') }
  }

  const hasRide = rides.length > 0

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <Header title="Scheduled rides" sub="Reserve a car up to 90 days ahead" onBack={onBack} />
      <div className="flex-1 overflow-y-auto pb-24 pt-5 px-4">

        {error && (
          <div className="rounded-xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3 text-[12px] font-semibold text-[#C5221F] mb-3">{error}</div>
        )}
        {toast && (
          <div className="rounded-xl bg-[#E6F4EA] border border-[#CEEAD6] px-4 py-3 text-[12px] font-semibold text-[#137333] mb-3">{toast}</div>
        )}

        {!adding ? (
          <button
            onClick={() => { setAdding(true); setError('') }}
            className="w-full rounded-2xl bg-[#1A1A1A] text-white font-semibold text-[13px] py-4 flex items-center justify-center gap-2 active:bg-black"
          >
            <Sv inner={CAL} c="#fff" size={16} /> Schedule a ride
          </button>
        ) : (
          <div className="bg-white rounded-2xl border border-[#F0F0F0] p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[14px] font-bold text-[#1A1A1A]">Schedule a ride</p>
              <button onClick={() => setAdding(false)} className="text-[12px] font-semibold text-[#6B6B6B] px-2 py-1">
                Close
              </button>
            </div>

            {/* Pickup — the device's own fix, named with its real address. */}
            <div className="rounded-xl bg-[#F7F7F7] border border-[#EBEBEB] px-3 py-2.5 flex items-center gap-2">
              <Sv inner={PIN} c="#4A4A4A" size={15} />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] uppercase tracking-widest text-[#ADADAD] font-semibold">Pickup</p>
                <p className="text-[13px] font-semibold text-[#1A1A1A] truncate">
                  {pickup?.address || 'Finding your location…'}
                </p>
              </div>
            </div>

            {/* Drop-off — the same searchPlaces() call as the search bar. */}
            <div className="mt-3">
              <Field
                label="Drop-off"
                value={destText}
                onChange={(v) => { setDestText(v); setDest(null) }}
                placeholder="Where to? e.g. Sandton City"
              />
              {dest && (
                <div className="mt-2 flex items-center gap-2 rounded-xl bg-[#E6F4EA] border border-[#CEEAD6] px-3 py-2.5">
                  <Sv inner={PIN} c="#137333" size={14} />
                  <span className="flex-1 text-[12px] font-semibold text-[#137333] truncate">{dest.address || dest.name}</span>
                  <button onClick={() => { setDest(null); setDestText('') }} className="text-[11px] font-bold text-[#137333]">
                    Change
                  </button>
                </div>
              )}
              {!dest && searching && <p className="text-[11px] text-[#ADADAD] mt-1.5">Searching…</p>}
              {!dest && results.length > 0 && (
                <div className="mt-2 rounded-xl border border-[#EBEBEB] overflow-hidden divide-y divide-[#F5F5F5]">
                  {results.map((p, i) => (
                    <button
                      key={`${p.lat},${p.lng},${i}`}
                      onClick={() => { setDest(p); setDestText(p.name); setResults([]) }}
                      className="w-full text-left px-3 py-2.5 active:bg-[#F7F7F7]"
                    >
                      <p className="text-[13px] font-semibold text-[#1A1A1A] truncate">{p.name}</p>
                      <p className="text-[11px] text-[#ADADAD] truncate">{p.address}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* When — quick presets plus a real date/time field. */}
            <div className="mt-4">
              <p className="text-[11px] font-medium text-[#4A4A4A] mb-1.5 ml-0.5">Pickup time</p>
              <div className="flex flex-wrap gap-2">
                {[
                  { l: 'In 45 min', d: () => plusMinutes(45) },
                  { l: 'In 1 hour', d: () => plusMinutes(60) },
                  { l: 'In 2 hours', d: () => plusMinutes(120) },
                  { l: 'Tomorrow 8am', d: () => tomorrowAt(8) },
                ].map((p) => {
                  const value = localInput(p.d())
                  return (
                    <button
                      key={p.l}
                      onClick={() => setWhenValue(value)}
                      className={`flex-1 min-w-[96px] rounded-xl border px-3 py-2.5 text-[12px] font-bold ${
                        whenValue === value ? 'border-[#EA4335] bg-[#FEF0EF] text-[#EA4335]' : 'border-[#EBEBEB] bg-[#F7F7F7] text-[#4A4A4A]'
                      }`}
                    >
                      {p.l}
                    </button>
                  )
                })}
              </div>
              <input
                type="datetime-local"
                value={whenValue}
                onChange={(e) => setWhenValue(e.target.value)}
                className="w-full h-11 rounded-xl bg-[#F7F7F7] border border-[#EBEBEB] px-3 mt-2.5 text-[13px] text-[#1A1A1A] outline-none focus:border-[#EA4335]"
              />
              <p className="text-[11px] text-[#ADADAD] mt-1.5">
                {whenValue ? when(new Date(whenValue).toISOString()) : 'Pick a date and time'} · at least 30 minutes ahead, up to 90 days
              </p>
            </div>

            <button
              onClick={reserve}
              disabled={busy === 'create'}
              className="w-full mt-4 bg-[#EA4335] text-white font-semibold text-[13px] py-3.5 rounded-2xl active:bg-[#C5221F] disabled:opacity-60"
            >
              {busy === 'create' ? 'Reserving…' : 'Confirm reservation'}
            </button>
          </div>
        )}

        <p className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold mt-6 mb-2">
          Your upcoming rides
        </p>

        {loading ? (
          <p className="text-[12px] text-[#ADADAD] text-center py-8">Loading your rides…</p>
        ) : !hasRide ? (
          <div className="bg-white rounded-2xl border border-[#F0F0F0] px-4 py-8 text-center shadow-sm">
            <div className="w-11 h-11 rounded-full bg-[#F7F7F7] flex items-center justify-center mx-auto mb-3">
              <Sv inner={CAL} c="#ADADAD" size={18} />
            </div>
            <p className="text-[14px] font-bold text-[#1A1A1A]">Nothing booked ahead</p>
            <p className="text-[12px] text-[#ADADAD] mt-1">Pre-book a ride and it will show up here.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {rides.map((r) => {
              const status = String(r.status || '')
              const fare = Number(r.estimated_fare ?? r.fare ?? r.actual_fare ?? 0)
              return (
                <div key={r.id} className="bg-white rounded-2xl border border-[#F0F0F0] px-4 py-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full bg-[#FEF0EF] text-[#EA4335]">
                      {STATUS_LABEL[status] || status || 'Booked'}
                    </span>
                    <span className="ml-auto text-[12px] font-bold text-[#1A1A1A]">{when(r.scheduled_at || r.created_at)}</span>
                  </div>

                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-1 pt-1.5 shrink-0">
                      <div className="w-2 h-2 rounded-full bg-[#1A1A1A]" />
                      <div className="w-px h-6 bg-[#E8E8E8]" />
                      <div className="w-2 h-2 rounded-full bg-[#EA4335]" />
                    </div>
                    <div className="flex flex-col gap-3 flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-[#1A1A1A] leading-none truncate">{r.pickup_address || r.pickup || 'Pickup'}</p>
                      <p className="text-[13px] font-semibold text-[#1A1A1A] leading-none truncate">{r.destination_address || r.destination || 'Drop-off'}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#F5F5F5]">
                    <Sv inner={CAR} c="#6B6B6B" size={14} />
                    <span className="text-[11px] text-[#6B6B6B] truncate">
                      {r.driver_name
                        ? `${r.driver_name}${r.license_plate ? ' · ' + r.license_plate : ''}`
                        : `${r.tier ? String(r.tier).toUpperCase() : 'Go'} · driver to be assigned`}
                    </span>
                    {fare > 0 && (
                      <span className="ml-auto text-[12px] font-bold text-[#1A1A1A] shrink-0">{formatRand(fare)}</span>
                    )}
                  </div>

                  <button
                    onClick={() => cancel(String(r.id))}
                    disabled={busy === String(r.id)}
                    className="w-full mt-3 border border-[#F5C6C2] text-[#C5221F] font-semibold text-[12px] py-3 rounded-xl active:bg-[#FEF0EF] disabled:opacity-50"
                  >
                    {busy === String(r.id) ? 'Cancelling…' : 'Cancel this ride'}
                  </button>
                </div>
              )
            })}
          </div>
        )}

        <p className="text-[11px] text-[#ADADAD] mt-4 flex items-start gap-1.5">
          <Sv inner={CHARGE} c="#ADADAD" size={13} />
          <span>Cancelling is free while a ride is still scheduled; once a driver is matched the usual R15 fee applies.</span>
        </p>
      </div>
    </div>
  )
}


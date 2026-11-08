import { useEffect, useState } from 'react'
import LeafletMap from './LeafletMap'
import type { LatLng } from './LeafletMap'
import { getMyLocation, reverseGeocode, searchPlaces } from '../lib/backend'
import type { Place } from '../lib/backend'

/**
 * Full-screen map picker for the booking rows.
 *
 * Tap the map to move the pin, or search an address / building entrance.
 * The label comes from reverse geocoding, so the booking row and the driver's
 * pickup instructions always carry a real place name, not just coordinates.
 */
export function MapPicker({
  title,
  initial,
  onCancel,
  onConfirm,
}: {
  title: string
  initial: LatLng | null
  onCancel: () => void
  onConfirm: (p: LatLng & { label: string }) => void
}) {
  const [picked, setPicked] = useState<LatLng | null>(initial)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [searching, setSearching] = useState(false)

  // If the booking row has no coordinates yet (the "Current Location" pickup),
  // start from the device's real fix rather than an arbitrary city centre.
  useEffect(() => {
    if (picked) return
    let alive = true
    getMyLocation()
      .then((p) => { if (alive) setPicked({ lat: p.lat, lng: p.lng }) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [picked])

  // Real address for the chosen pin.
  useEffect(() => {
    if (!picked) return
    let alive = true
    setBusy(true)
    reverseGeocode(picked.lat, picked.lng)
      .then((r: any) => {
        if (!alive) return
        setLabel(String(r?.address || r?.name || 'Pinned location'))
      })
      .catch(() => { if (alive) setLabel('Pinned location') })
      .finally(() => { if (alive) setBusy(false) })
    return () => { alive = false }
  }, [picked?.lat, picked?.lng])

  // Search is biased to the pin so "Sandton City" or an entrance ranks nearby.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 3) { setResults([]); return }
    let alive = true
    setSearching(true)
    const t = setTimeout(() => {
      searchPlaces(q, picked ?? undefined)
        .then((r) => { if (alive) setResults(r.slice(0, 6)) })
        .catch(() => { if (alive) setResults([]) })
        .finally(() => { if (alive) setSearching(false) })
    }, 320)
    return () => { alive = false; clearTimeout(t) }
  }, [query, picked?.lat, picked?.lng])

  function usePlace(p: Place) {
    setPicked({ lat: p.lat, lng: p.lng })
    setLabel(p.address || p.name || 'Pinned location')
    setQuery('')
    setResults([])
  }

  async function locateMe() {
    try {
      const p = await getMyLocation()
      setPicked({ lat: p.lat, lng: p.lng })
    } catch {
      /* permission denied — the map tap is still available */
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#F7F7F7]">
      <div className="relative flex-1">
        <LeafletMap
          marker={picked ?? undefined}
          zoom={16}
          follow={false}
          showSelf={false}
          controls
          onPick={(p) => setPicked(p)}
        />

        <div className="absolute inset-x-0 top-0 z-10 flex items-center gap-3 px-4 pt-12">
          <button
            onClick={onCancel}
            aria-label="Back"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-md active:bg-[#F7F7F7]"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </button>
          <div className="min-w-0 flex-1 rounded-2xl border border-white/70 bg-white/95 px-4 py-2 shadow-md backdrop-blur-md">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#9E9E9E]">{title}</p>
            <p className="truncate text-[13px] font-semibold text-[#1A1A1A]">
              Tap the map to move the pin
            </p>
          </div>
        </div>

        {!picked && (
          <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 rounded-2xl bg-white/95 px-5 py-4 text-center shadow-lg">
            <p className="text-[13px] font-semibold text-[#1A1A1A]">Finding your location…</p>
            <p className="mt-1 text-[11px] text-[#8A8A8A]">
              Tap anywhere on the map to drop the pin instead.
            </p>
          </div>
        )}
      </div>

      <div className="max-h-[55%] overflow-y-auto rounded-t-3xl bg-white px-5 pb-7 pt-4 shadow-[0_-6px_24px_rgba(0,0,0,0.10)]">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-[#E8E8E8]" />

        <div className="flex items-center gap-2 rounded-2xl border border-[#EBEBEB] bg-[#FAFAFA] px-3.5 py-3">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9E9E9E" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search an address or entrance"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[#1A1A1A] outline-none placeholder:text-[#ADADAD]"
          />
          {query ? (
            <button onClick={() => setQuery('')} className="text-[16px] leading-none text-[#ADADAD]">
              ×
            </button>
          ) : null}
        </div>

        {searching && <p className="mt-2 px-1 text-[11px] text-[#ADADAD]">Searching…</p>}

        {results.length > 0 && (
          <div className="mt-2 overflow-hidden rounded-2xl border border-[#F0F0F0]">
            {results.map((r, i) => (
              <button
                key={`${r.lat},${r.lng},${i}`}
                onClick={() => usePlace(r)}
                className={`flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-[#F7F7F7] ${
                  i < results.length - 1 ? 'border-b border-[#F5F5F5]' : ''
                }`}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EA4335" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-[#1A1A1A]">{r.name}</span>
                  <span className="block truncate text-[11px] text-[#ADADAD]">{r.address}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-4 rounded-2xl bg-[#F7F7F7] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#ADADAD]">Selected pin</p>
          <p className="mt-0.5 text-[13px] font-semibold leading-snug text-[#1A1A1A]">
            {busy ? 'Finding the address…' : label || 'Tap the map to choose a point'}
          </p>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => void locateMe()}
            className="flex-1 rounded-2xl border border-[#EBEBEB] py-3.5 text-[13px] font-semibold text-[#4A4A4A] active:bg-[#F7F7F7]"
          >
            Use my location
          </button>
          <button
            onClick={() => { if (picked) onConfirm({ ...picked, label: label || 'Pinned location' }) }}
            disabled={!picked || busy}
            className="flex-1 rounded-2xl bg-[#EA4335] py-3.5 text-[13px] font-bold text-white active:bg-[#C5221F] disabled:opacity-50"
          >
            Use this pin
          </button>
        </div>
      </div>
    </div>
  )
}

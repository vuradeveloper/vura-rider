import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import VehicleImage from './components/vehicle/VehicleImage'
import { colourNameOf } from './components/vehicle/palette'

import DriverVehicleCard from './components/DriverVehicleCard'
import CountrySelect from './components/CountrySelect'
import type { LatLng } from './components/LeafletMap'
import LeafletMap from './components/LeafletMap'
import { HelpCenter, ReportIssue, SettingsScreen } from './components/SettingsScreen'
import PaymentMethods from './components/PaymentMethods'
import PromosScreen from './components/PromosScreen'
import RiderProfile from './components/RiderProfile'
import RiderSettings, { Guidelines } from './components/RiderSettings'
import { SafetyScreen } from './components/SafetyScreen'
import VehicleLinkScreen from './components/VehicleLinkScreen'
// `getRoute` is what useRouteLine() calls to turn pickups/stops/drop-offs into a
// road-following polyline. It existed in the backend lib all along but was never
// imported here, so the map's route effect threw `getRoute is not defined` the
// moment a screen rendered with two or more points — one of the white screens.
import { getRoute } from './lib/backend'
import WalletScreen from './components/WalletScreen'
import { initPushNotifications, notifyRide } from './lib/notify'
import type { Earnings as EarningsSummary } from './lib/backend'
import {
  acceptRide,
  AuthUser,
  // ── rider ──
  cancelRide,
  completeTrip,
  declineRide,
  deletePaymentMethod,
  DOC_LABELS,
  DocRow,
  DriverStats,
  ensureSession,
  formatRand,
  getActiveRide,
  getDriverStats,
  getEarnings,
  getMyDocuments,
  getMyLocation,
  getMyProfile,
  getNotifications,
  getPaymentMethods,
  getRecentSearches,
  getRecentTrips,
  getRide,
  getRideHistory,
  getSavedPlaces,
  getStoredOnline,
  getStoredProfileInfo,
  getStoredUser,
  getWalletBalance,
  goOnline,
  normalizeRide,
  NotificationRow,
  on,
  openWaze,
  // ── payment methods (booking screen) ──
  PaymentMethod,
  // (getStoredProfileInfo is already imported above — listed once only)
  Place,
  publishLocation,
  RecentSearch,
  registerPaystackCard,
  requestRide,
  resyncOnlineState,
  reverseGeocode,
  RideRequest as RideRequestData,
  SavedPlace,
  saveSavedPlaces,
  saveSearch,
  searchPlaces,
  sendVerificationEmail,
  shareTrip,
  signIn,
  signOut,
  signUp,
  startTrip,
  sendTip,
  submitRating,
  triggerSos,
  verifyPayment
} from './lib/backend'

type RiderScreen = 'home' | 'booking' | 'matching' | 'ride' | 'activity' | 'account' | 'notifications'
  | 'settings' | 'profile' | 'payments' | 'promos' | 'safety' | 'guidelines' | 'help' | 'report'
type DriverScreen = 'driverHome' | 'request' | 'pickup' | 'dropoff' | 'complete' | 'earnings' | 'driverAccount' | 'vehicle' | 'tripHistory' | 'settings' | 'help' | 'report' | 'wallet'
type AppMode = 'rider' | 'driver'

/** A stop between pickup and drop-off. Same shape the socket booking expects. */
type Waypoint = { address: string; lat: number; lng: number }

/**
 * `paymentMethod` is sent to the server verbatim on the ride request, so the two
 * accepted values are the ones the server and the native app already use.
 */
const PAY_CASH = 'cash'

// ????????? Data ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
/** JS Sun=0..Sat=6 shifted to Mon=0..Sun=6, so the bars start on Monday. */
const rideOptions = [
  { id: 'go', name: 'Go', desc: 'Affordable rides', eta: '3 min', price: 'R0.20', seats: 4 },
  { id: 'comfort', name: 'Comfort', desc: 'Newer cars, extra legroom', eta: '4 min', price: 'R0.20', seats: 4 },
  { id: 'xl', name: 'XL', desc: 'Rides for groups up to 6', eta: '5 min', price: 'R0.20', seats: 6 },
  { id: 'black', name: 'Black', desc: 'Premium black car service', eta: '7 min', price: 'R0.20', seats: 4 },
]

// Every ride in this build costs a flat R0.20.
// This is the amount the server charges the saved card for real, so the price
// on the tiers above, the price in the ride request and the price the driver
// sees are all the same number.
const RIDE_FARE = 0.2

// ── Date helpers, copied from the React Native app (earnings.tsx / trips.tsx) ──

/** JS Sun=0..Sat=6 shifted to Mon=0..Sun=6, so the bars start on Monday. */
function dayIndex(d: Date) {
  return (d.getDay() + 6) % 7
}

/** "Today · 14:32", "Yesterday · 09:05", or "12 Aug · 18:40". */
function fmtTripTime(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const now = new Date()
  const yest = new Date(now)
  yest.setDate(now.getDate() - 1)
  const time = d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `Today · ${time}`
  if (d.toDateString() === yest.toDateString()) return `Yesterday · ${time}`
  return `${d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })} · ${time}`
}

/**
 * Destinations chosen from search or saved places are carried as
 * "Name||lat||lng" so the exact coordinates travel with the label. This returns
 * just the human-readable name for display.
 */
function destLabel(d: string | null | undefined) {
  const s = String(d || '')
  const i = s.indexOf('||')
  return i > 0 ? s.slice(0, i) : s || 'Destination'
}

/**
 * The coordinates half of a "Name||lat||lng" destination. Returns null when the
 * destination was typed rather than picked, so callers can skip it instead of
 * drawing a route to (0, 0).
 */
function destCoords(d: string | null | undefined): LatLng | null {
  const parts = String(d || '').split('||')
  if (parts.length !== 3) return null
  const lat = Number(parts[1])
  const lng = Number(parts[2])
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
}

/** A finite {lat,lng} from a ride row, or null when the column is absent. */
function coordsOf(lat: any, lng: any): LatLng | null {
  const a = Number(lat)
  const b = Number(lng)
  return Number.isFinite(a) && Number.isFinite(b) ? { lat: a, lng: b } : null
}

/**
 * Waypoints in the order the driver will visit them. The server ignores
 * `waypoints` on a ride request (see the probe notes in lib/backend.ts), so on a
 * live ride these come back only if the row carries them — hence the several
 * spellings, and the empty array when there are none.
 */
function stopsOf(row: any): LatLng[] {
  const raw = row?.stops ?? row?.waypoints ?? row?.route_data?.stops
  if (!Array.isArray(raw)) return []
  return raw
    .map((s: any) => coordsOf(s?.lat ?? s?.latitude, s?.lng ?? s?.longitude))
    .filter(Boolean) as LatLng[]
}

/**
 * Every leg of a trip, in order: pickup → stops → drop-off. Anything missing is
 * dropped rather than guessed, so the drawn line can never contradict the
 * addresses printed beside it.
 */
function tripPoints(pickup: LatLng | null, stops: LatLng[], dropoff: LatLng | null): LatLng[] {
  const pts = [pickup, ...stops, dropoff].filter(Boolean) as LatLng[]
  return pts.length > 1 ? pts : []
}

/**
 * Asks the server for the road route through these points and returns the
 * polyline to draw.
 *
 * getRoute() is the ONLY caller of GET /api/route, and it is fed pickup-plus-stops
 * so the line follows the roads and visits every stop (the previous version sent a
 * query string the server rejects with 400, so nothing was ever drawn). A failure
 * leaves the map without a line instead of throwing into the screen.
 */
function useRouteLine(points: LatLng[]): LatLng[] {
  const [line, setLine] = useState<LatLng[]>([])
  // A fresh array identity arrives on every render, so the effect keys off the
  // coordinates instead — otherwise it would re-request the route forever.
  const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|')
  useEffect(() => {
    if (points.length < 2) { setLine([]); return }
    let alive = true
    getRoute(points[0], points[points.length - 1], points.slice(1, -1))
      .then((r) => { if (alive) setLine(r.length > 1 ? r : []) })
      .catch(() => { if (alive) setLine([]) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return line
}

// ─────────────────────────────────────────────────────────────────────────────

// ????????? Icons ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
const IC = {
  home: (c = '#1A1A1A') => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1z" /><path d="M9 21V12h6v9" /></svg>,
  clock: (c = '#9E9E9E') => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></svg>,
  user: (c = '#1A1A1A') => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>,
  chevRight: (c = '#C4C4C4') => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>,
  chevLeft: (c = '#1A1A1A') => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>,
  search: (c = '#9E9E9E') => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>,
  phone: (c = '#4A4A4A') => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.18 19.79 19.79 0 01.22 4.6 2 2 0 012.18 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 9.91a16 16 0 006.06 6.06l1.48-1.48a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z" /></svg>,
  msg: (c = '#4A4A4A') => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></svg>,
  star: (c = '#EA4335') => <svg width="13" height="13" viewBox="0 0 24 24" fill={c} stroke={c} strokeWidth="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>,
  starO: (c = '#E0E0E0') => <svg width="13" height="13" viewBox="0 0 24 24" fill={c} stroke={c} strokeWidth="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>,
  car: (c = '#1A1A1A') => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 17H3a2 2 0 01-2-2V9a2 2 0 012-2h3.69l1.3-3H16l1.3 3H21a2 2 0 012 2v6a2 2 0 01-2 2h-2" /><circle cx="7.5" cy="17.5" r="1.5" /><circle cx="16.5" cy="17.5" r="1.5" /></svg>,
  map: (c = '#9E9E9E') => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" /><line x1="8" y1="2" x2="8" y2="18" /><line x1="16" y1="6" x2="16" y2="22" /></svg>,
  shield: (c = '#4A4A4A') => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
  wallet: (c = '#1A1A1A') => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>,
  check: (c = '#fff') => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>,
  menu: (c = '#1A1A1A') => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg>,
  trend: (c = '#34A853') => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></svg>,
  loc: (c = '#EA4335') => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>,
  airport: (c = '#9E9E9E') => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><path d="M17.8 19.2L16 11l3.5-3.5A3 3 0 009 6.5l-3.5 3.5-8.2-1.8a.8.8 0 00-.8 1.3l4.4 4.4-2.3 2.3a.5.5 0 000 .7l1.4 1.4a.5.5 0 00.7 0l2.3-2.3 4.4 4.4a.8.8 0 001.3-.8z" /></svg>,
  work: (c = '#9E9E9E') => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" /></svg>,
  place: (c = '#9E9E9E') => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.8" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>,
}

// ????????? Map ??????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
/**
 * Opens a URL for card checkout.
 *
 * Capacitor's Browser plugin renders the page in a Custom Tab ON TOP of the app,
 * so the rider never gets thrown out to a separate browser app — that in-app
 * feeling is what the old React Native app had (it used an in-app WebView).
 *
 * An iframe cannot be used instead: the Paystack checkout returns
 * `x-frame-options: SAMEORIGIN`, verified against the live endpoint, so a framed
 * copy would simply come up blank.
 */
async function openExternal(url: string) {
  if (!url) return
  try {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url })
    return
  } catch {
    /* plugin missing (e.g. running as a plain web build) — fall through */
  }
  const w = window.open(url, '_system')
  if (w) return
  const a = document.createElement('a')
  a.href = url
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/**
 * How far the white "sheet" panel below the map overlaps it, in px. It is applied
 * as -mt-5 on those panels and must be mirrored by anything pinned to the map's
 * bottom edge (the online card sits on top of it, the zoom controls above it), so
 * the value lives here rather than being repeated as a magic number.
 *
 * Declared before MapCanvas because every screen that puts controls over a map
 * needs it to keep those buttons clear of the sheet.
 */
const PANEL_RISE = 20

function MapCanvas({
  dark = false, marker, zoom = 16, follow = true, controls = false, controlsBottom = 12, route,
}: {
  dark?: boolean
  /**
   * Polyline to draw (pickup → stops → drop-off), normally from getRoute().
   *
   * This REPLACES the old `showRoute?: boolean` prop, which was declared and passed
   * by three screens but never destructured or forwarded — so `showRoute` did
   * nothing at all and no map in the app ever drew a route.
   */
  route?: LatLng[]
  /** Real coordinates to pin. Omit to follow the device's live GPS fix. */
  marker?: LatLng
  zoom?: number
  follow?: boolean
  controls?: boolean
  controlsBottom?: number
}) {
  // Real OpenStreetMap tiles via Leaflet ??? the same mapping stack the React
  // Native driver app uses (it renders Leaflet inside a WebView), so both apps
  // show identical tiles, zoom levels and pins. The decorative SVG map that
  // used to sit here has been removed.
  return (
    // `isolate` (CSS `isolation: isolate`) is REQUIRED here, not cosmetic: it makes
    // this wrapper a stacking context, which traps Leaflet's internal panes inside it.
    //
    // Leaflet ships `.leaflet-tile-pane{z-index:200}` … `.leaflet-popup-pane{z-index:700}`
    // … `.leaflet-control{z-index:800}`, and with no stacking context above them those
    // raw values leak into the app's ROOT stacking order. That painted the map over
    // every overlay (all z-10 — the search bar, the Online/Offline pill, the rider↔driver
    // switch, the back buttons) and over the bottom nav (z-50), which is exactly why
    // those controls stopped showing once real tiles started loading.
    //
    // With the map contained, the whole block sits at `z-index: auto` and simply follows
    // document order, so the overlays beside it stack normally again.
    <div className="absolute inset-0 overflow-hidden bg-[#EEF2F7] isolate">
      {/* The pin is drawn by Leaflet at the driver's REAL coordinates. The old
          hard-coded centre pin that sat here is gone — it always pointed at the
          middle of the screen no matter where the driver actually was. */}
      <LeafletMap dark={dark} marker={marker} zoom={zoom} follow={follow} controls={controls} controlsBottom={controlsBottom} route={route} />
    </div>
  )
}

// The rider↔driver mode pill used to live here. It has been REMOVED: these are two
// separate apps — this one is rider-only — and the switch only added a way to land
// in screens that cannot do the job of the other app.

// ????????? RIDER ????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
function RiderNav({ active, go }: { active: RiderScreen; go: (s: RiderScreen) => void }) {
  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-sm bg-white border-t border-[#EBEBEB] flex z-50">
      {([['home', 'Home', IC.home], ['activity', 'Activity', IC.clock], ['account', 'Account', IC.user]] as [RiderScreen, string, (c: string) => ReactNode][]).map(([id, label, Icon]) => (
        <button key={id} onClick={() => go(id)} className={`flex-1 flex flex-col items-center pt-3 pb-4 gap-[5px] transition-colors ${active === id ? 'text-[#EA4335]' : 'text-[#ADADAD]'}`}>
          {Icon(active === id ? '#EA4335' : '#ADADAD')}
          <span className="text-[10px] font-semibold tracking-wider uppercase">{label}</span>
        </button>
      ))}
    </nav>
  )
}

function PlaceIcon({ type }: { type: string }) {
  const map: Record<string, (c: string) => ReactNode> = { airport: IC.airport, work: IC.work, place: IC.place }
  const Ic = map[type] || IC.place
  return (
    <div className="w-10 h-10 rounded-full bg-[#F5F5F5] border border-[#EBEBEB] flex items-center justify-center shrink-0">
      {Ic('#6B6B6B')}
    </div>
  )
}

function RiderHome({ onBook, mode, onMode }: { onBook: (d: string) => void; mode: AppMode; onMode: (m: AppMode) => void }) {
  const [me, setMe] = useState<LatLng | null>(null)
  const [placeLabel, setPlaceLabel] = useState('Locating you…')
  const [places, setPlaces] = useState<SavedPlace[]>(() => getSavedPlaces())
  const [adding, setAdding] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [searching, setSearching] = useState(false)
  const [recents, setRecents] = useState<RecentSearch[]>([])

  // Real GPS fix — the rider's actual position, used for the pickup point and
  // the map centre (the same geolocation the native app uses via expo-location).
  useEffect(() => {
    getMyLocation()
      .then((p) => {
        setMe({ lat: p.lat, lng: p.lng })
        // Resolve the REAL place name for the coordinates. Showing a fixed string
        // told the rider nothing about where they actually are.
        return reverseGeocode(p.lat, p.lng).catch(() => null)
      })
      .then((r) => {
        const real = r?.address || r?.name
        setPlaceLabel(real ? String(real) : 'My Current Location')
      })
      .catch(() => setPlaceLabel('Location unavailable — check permissions'))
  }, [])

  // Real destination search, with the SAME ranking parameters the old app used —
  // biased to the rider's position, closest-first, South Africa only. This is what
  // made the old search accurate; sending only ?q= gave vaguer, farther results.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 3) { setResults([]); return }
    let alive = true
    setSearching(true)
    const t = setTimeout(() => {
      searchPlaces(q, me ?? undefined)
        .then((r) => { if (alive) setResults(r) })
        .catch(() => { if (alive) setResults([]) })
        .finally(() => { if (alive) setSearching(false) })
    }, 350)
    return () => { alive = false; clearTimeout(t) }
  }, [query, me])

  // Recent searches — GET /api/searches, with the device as a fallback
  // (exactly the old SearchService behaviour).
  useEffect(() => {
    getRecentSearches()
      .then((rows) => setRecents(Array.isArray(rows) ? rows.slice(0, 6) : []))
      .catch(() => setRecents([]))
  }, [])

  /** Pick a destination: remember it (server + device) then start booking. */
  function chooseDestination(name: string, address: string, lat: number, lng: number) {
    void saveSearch({ name, addr: address, lat, lng }).catch(() => { })
    onBook(`${name}||${lat}||${lng}`)
  }

  function addPlace(label: string) {
    if (!me) return
    const row: SavedPlace = {
      id: String(Date.now()),
      label: label || 'Place',
      name: label || 'Place',
      address: 'Pinned location',
      lat: me.lat,
      lng: me.lng,
    }
    const next = [...places, row]
    setPlaces(next)
    saveSavedPlaces(next)
    setAdding(false)
    setNewLabel('')
  }
  function removePlace(id: string) {
    const next = places.filter((p) => p.id !== id)
    setPlaces(next)
    saveSavedPlaces(next)
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="relative" style={{ height: '42%' }}>
        <MapCanvas marker={me ?? undefined} zoom={16} controls controlsBottom={PANEL_RISE + 12} />
        <div className="absolute inset-x-0 top-0 flex items-start justify-between px-5 pt-12 z-10">
          <div className="bg-white/90 backdrop-blur-md rounded-2xl px-3.5 py-2 shadow-sm border border-white/60">
            <p className="text-[10px] text-[#9E9E9E] font-semibold uppercase tracking-wider">My Current Location</p>
            <p className="text-[13px] text-[#1A1A1A] font-semibold leading-tight">{placeLabel}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 bg-white z-10 rounded-t-3xl -mt-5 flex flex-col overflow-hidden shadow-[0_-4px_24px_rgba(0,0,0,0.08)]">
        <div className="px-5 pt-5 pb-4 flex-1 overflow-y-auto">
          <h1 className="text-[22px] font-semibold text-[#1A1A1A] mb-4" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Where to?</h1>

          {/* Real search box */}
          <div className="w-full flex items-center gap-3 bg-[#F7F7F7] rounded-2xl px-4 py-3.5 mb-3 border border-transparent focus-within:border-[#EA4335]/30 transition-all">
            {IC.search()}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search a destination"
              className="flex-1 bg-transparent text-[14px] text-[#1A1A1A] outline-none placeholder:text-[#ADADAD]"
            />
            {query ? (
              <button onClick={() => setQuery('')} className="text-[#ADADAD] text-[16px] leading-none">×</button>
            ) : null}
          </div>

          {searching && <p className="text-[12px] text-[#ADADAD] mb-3 px-1">Searching…</p>}

          {results.length > 0 && (
            <div className="mb-5 rounded-2xl border border-[#F0F0F0] overflow-hidden">
              {results.slice(0, 6).map((r, i) => (
                <button
                  key={`${r.lat},${r.lng},${i}`}
                  onClick={() => chooseDestination(r.name, r.address, r.lat, r.lng)}
                  className={`w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-[#F7F7F7] ${i < Math.min(results.length, 6) - 1 ? 'border-b border-[#F5F5F5]' : ''}`}
                >
                  {IC.loc()}
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] text-[#1A1A1A] font-semibold truncate">{r.name}</p>
                    <p className="text-[12px] text-[#ADADAD] truncate mt-0.5">{r.address}</p>
                  </div>
                  {/* Distance badge — the provider returns metres from the rider,
                      which is what makes "closest first" visible. */}
                  {Number.isFinite(Number(r.distance)) && Number(r.distance) > 0 && (
                    <span className="text-[11px] text-[#ADADAD] shrink-0 font-medium">
                      {Number(r.distance) < 1000
                        ? `${Math.round(Number(r.distance))} m`
                        : `${(Number(r.distance) / 1000).toFixed(1)} km`}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Recent searches — GET /api/searches, the old app's behaviour. */}
          {query.trim().length === 0 && recents.length > 0 && (
            <div className="mb-5">
              <p className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold mb-2">Recent</p>
              <div className="rounded-2xl border border-[#F0F0F0] overflow-hidden">
                {recents.map((s, i) => (
                  <button
                    key={s.id || `${s.name}-${i}`}
                    onClick={() => chooseDestination(s.name, s.addr, Number(s.lat), Number(s.lng))}
                    className={`w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-[#F7F7F7] ${i < recents.length - 1 ? 'border-b border-[#F5F5F5]' : ''}`}
                  >
                    <PlaceIcon type="place" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] text-[#1A1A1A] font-semibold truncate">{s.name}</p>
                      <p className="text-[12px] text-[#ADADAD] truncate mt-0.5">{s.addr}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* __SAVED__ */}

          {/* Quick picks — Home / Work / Airport, backed by saved places */}
          <div className="flex gap-2.5 mb-6">
            {[{ label: 'Home', type: 'home' }, { label: 'Work', type: 'work' }, { label: 'Airport', type: 'airport' }].map(q => {
              const saved = places.find((p) => p.label.toLowerCase() === q.label.toLowerCase())
              return (
                <button
                  key={q.label}
                  onClick={() => { if (saved) onBook(`${saved.name}||${saved.lat}||${saved.lng}`); else addPlace(q.label) }}
                  className="flex-1 flex flex-col items-center gap-2 bg-[#F7F7F7] rounded-2xl py-3.5 border border-transparent hover:border-[#EA4335]/30 transition-all"
                >
                  <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm">
                    {q.type === 'home' ? IC.home('#6B6B6B') : q.type === 'work' ? IC.work('#6B6B6B') : IC.airport('#6B6B6B')}
                  </div>
                  <span className="text-[12px] text-[#4A4A4A] font-semibold">{q.label}</span>
                  <span className="text-[9px] text-[#C4C4C4]">{saved ? 'saved' : 'tap to save'}</span>
                </button>
              )
            })}
          </div>

          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold">Saved places</p>
            {adding ? (
              <div className="flex items-center gap-2">
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Name"
                  className="w-24 h-7 rounded-lg bg-[#F7F7F7] border border-[#EBEBEB] px-2 text-[12px] outline-none"
                />
                <button onClick={() => addPlace(newLabel)} className="text-[11px] font-bold text-[#EA4335]">Save</button>
                <button onClick={() => setAdding(false)} className="text-[11px] text-[#ADADAD]">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setAdding(true)} className="text-[11px] font-bold text-[#EA4335]">+ Add</button>
            )}
          </div>

          {places.length === 0 ? (
            <p className="text-[12px] text-[#ADADAD] py-2 px-1">
              No saved places yet. Tap Home or Work above, or add one.
            </p>
          ) : (
            <div className="flex flex-col">
              {places.map((p, i) => (
                <div key={p.id} className={`flex items-center ${i < places.length - 1 ? 'border-b border-[#F2F2F2]' : ''}`}>
                  <button onClick={() => onBook(`${p.name}||${p.lat}||${p.lng}`)} className="flex-1 flex items-center gap-3 py-3.5 text-left active:bg-[#F7F7F7] rounded-xl px-1 transition-colors">
                    <PlaceIcon type="place" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] text-[#1A1A1A] font-semibold truncate">{p.name}</p>
                      <p className="text-[12px] text-[#ADADAD] truncate mt-0.5">{p.label}</p>
                    </div>
                  </button>
                  <button onClick={() => removePlace(p.id)} className="text-[#C4C4C4] text-[16px] px-2 active:text-[#EA4335]">×</button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="h-20" />
      </div>
    </div>
  )
}

function BookingScreen({ destination, onBack, onConfirm }: {
  destination: string
  onBack: () => void
  onTier?: (t: string) => void
  /** tier, payment method ('cash' | 'card') and any stops added before booking. */
  onConfirm: (tier: string, paymentMethod: string, stops: Waypoint[]) => void
}) {
  const [sel, setSel] = useState('go')
  const destName = destLabel(destination)
  const ride = rideOptions.find(r => r.id === sel)!

  // ── Payment method ─────────────────────────────────────────────────────────
  // `pay` is PAY_CASH or a saved card's id. Only 'cash' vs 'card' is sent with
  // the ride (that is what the server stores and the driver screen shows); the
  // card id is kept so the chosen card can be shown back to the rider.
  const [cards, setCards] = useState<PaymentMethod[]>([])
  const [pay, setPay] = useState<string>(PAY_CASH)
  const [addingCard, setAddingCard] = useState(false)
  const [cardMsg, setCardMsg] = useState('')

  const loadCards = async () => {
    const rows = await getPaymentMethods().catch(() => [] as PaymentMethod[])
    setCards(Array.isArray(rows) ? rows : [])
  }
  useEffect(() => { loadCards() }, [])

  async function removeCard(id: string) {
    setCards((rows) => rows.filter((c) => c.id !== id))
    if (pay === id) setPay(PAY_CASH)
    await deletePaymentMethod(id).catch(() => { })
  }

  /**
   * Adds a card through Paystack's hosted checkout.
   *
   * The checkout is opened in the OS browser (3-D Secure / OTP cannot complete in
   * an in-app view), then the card is confirmed by polling the server — the same
   * two-step flow as the native app (app/add-payment-method.tsx).
   */
  async function addCard() {
    if (addingCard) return
    setAddingCard(true)
    setCardMsg('Opening the secure payment page…')
    try {
      const reg = await registerPaystackCard()
      if (!reg?.reference || !reg?.authorizationUrl) {
        setCardMsg(reg?.error || 'Could not start card setup. Please try again.')
        return
      }
      await openExternal(reg.authorizationUrl)
      setCardMsg('Waiting for your bank to confirm…')
      const saved = await pollCardSaved(reg.reference)
      if (saved) {
        // Close the checkout tab so the rider lands back on the booking screen.
        try {
          const { Browser } = await import('@capacitor/browser')
          await Browser.close()
        } catch { /* nothing open, or plugin unavailable */ }
        await loadCards()
        setCardMsg('Card added.')
      }
    } catch (e: any) {
      setCardMsg(e?.message || 'Could not add the card.')
    } finally {
      setAddingCard(false)
    }
  }

  /**
   * Polls until the server has stored the card, mirroring the native app: every
   * 3s for up to 5 minutes.
   *
   * `abandoned` is Paystack's RESTING status for a checkout that has not been paid
   * yet, so it only counts as final after a 2-minute grace — treating it as an
   * immediate failure ends the flow seconds after opening, before the rider could
   * possibly have typed anything. `failed` is a genuine decline and is immediate.
   */
  async function pollCardSaved(reference: string): Promise<boolean> {
    const startedAt = Date.now()
    const ABANDON_GRACE_MS = 2 * 60 * 1000
    // A generous ceiling rather than 5 minutes: while the rider is in the bank's
    // 3-D Secure page the app is in the background, where Android throttles
    // timers. A deadline that expires while hidden would report a failure the
    // rider never caused, and the card would still have been saved.
    const CEILING_MS = 15 * 60 * 1000
    for (; ;) {
      await new Promise((r) => setTimeout(r, 3000))
      const v = await verifyPayment(reference).catch(() => null)
      const status = v?.status
      if (status) {
        if (status === 'success' || status === 'completed' || status === 'refunded') return true
        // "abandoned" is Paystack's resting state for a checkout that has not been
        // paid YET, so it only counts as final after the grace period. "failed" is
        // a genuine decline and stops immediately.
        const abandonedFinal = status === 'abandoned' && Date.now() - startedAt >= ABANDON_GRACE_MS
        if (status === 'failed' || abandonedFinal) {
          setCardMsg(`The payment page didn't complete (${status}). No card was saved.`)
          return false
        }
      }
      if (Date.now() - startedAt > CEILING_MS) {
        setCardMsg('Still waiting for bank approval. The card saves as soon as it is approved.')
        return false
      }
    }
  }

  // ── Stops ──────────────────────────────────────────────────────────────────
  const [stops, setStops] = useState<Waypoint[]>([])
  const [pickStop, setPickStop] = useState(false)
  const [stopQ, setStopQ] = useState('')
  const [stopRes, setStopRes] = useState<Place[]>([])
  const [stopBusy, setStopBusy] = useState(false)

  // The rider's own fix, for the first leg of the drawn route. Read once: this
  // screen is about the destination, not about tracking movement.
  const [me, setMe] = useState<LatLng | null>(null)
  useEffect(() => {
    getMyLocation()
      .then((p) => setMe({ lat: p.lat, lng: p.lng }))
      .catch(() => { })
  }, [])

  // The real road route for the map: current location → stops → destination.
  // Missing pieces are simply skipped, so adding a stop redraws the line through
  // it and the map never shows a route to nowhere.
  const mapRoute = useRouteLine(tripPoints(
    me,
    stops.map((s) => ({ lat: s.lat, lng: s.lng })),
    destCoords(destination),
  ))

  // Search as the rider types, biased to where they are — the same helper and
  // ordering the home screen uses, so results match.
  useEffect(() => {
    if (!pickStop) return
    const q = stopQ.trim()
    if (q.length < 2) { setStopRes([]); setStopBusy(false); return }
    let alive = true
    setStopBusy(true)
    const t = setTimeout(async () => {
      const me = await getMyLocation().catch(() => null)
      const rows = await searchPlaces(q, me ?? undefined).catch(() => [] as Place[])
      if (!alive) return
      setStopRes(rows.slice(0, 8))
      setStopBusy(false)
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [stopQ, pickStop])

  function chooseStop(p: Place) {
    setStops((s) => [...s, { address: p.address || p.name, lat: p.lat, lng: p.lng }])
    setPickStop(false)
    setStopQ('')
    setStopRes([])
  }

  /**
   * Moves a stop one place earlier or later.
   *
   * Order matters: the driver visits the stops in the order given, so which one
   * comes first is a real decision, not a cosmetic one. The server is sent the
   * array in this order.
   */
  function moveStop(index: number, dir: -1 | 1) {
    setStops((rows) => {
      const to = index + dir
      if (to < 0 || to >= rows.length) return rows
      const next = rows.slice()
      const a = next[index]
      next[index] = next[to]
      next[to] = a
      return next
    })
  }

  const payLabel = pay === PAY_CASH
    ? 'Cash'
    : (() => {
      const c = cards.find((x) => x.id === pay)
      return c ? `${(c.card_type || 'Card').toUpperCase()} •••• ${c.last4 || '····'}` : 'Card'
    })()

  return (
    <div className="flex flex-col h-screen">
      <div className="relative" style={{ height: '38%' }}>
        <MapCanvas route={mapRoute} />
        <button onClick={onBack} className="absolute top-12 left-5 z-10 w-10 h-10 rounded-full bg-white shadow-md flex items-center justify-center">
          {IC.chevLeft()}
        </button>
      </div>

      <div className="flex-1 bg-white z-10 rounded-t-3xl -mt-5 overflow-y-auto shadow-[0_-4px_24px_rgba(0,0,0,0.08)]">
        {/* Route: from -> any stops -> destination. The connector line and the dot
            column grow with the number of stops so the diagram stays honest about
            how many legs the trip has. */}
        <div className="px-5 pt-5 pb-4 border-b border-[#F2F2F2]">
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className="w-2.5 h-2.5 rounded-full bg-[#1A1A1A] border-2 border-white shadow" />
              {stops.map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div className="w-px h-7 bg-[#E0E0E0]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#FBBC04] border-2 border-white shadow" />
                </div>
              ))}
              <div className="w-px h-7 bg-[#E0E0E0]" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#EA4335] border-2 border-white shadow" />
            </div>
            <div className="flex flex-col gap-3 flex-1">
              <div className="bg-[#F7F7F7] rounded-xl px-3 py-2">
                <p className="text-[10px] text-[#ADADAD] font-semibold uppercase tracking-wider">From</p>
                <p className="text-[13px] text-[#1A1A1A] font-semibold">Current Location</p>
              </div>
              {stops.map((s, i) => (
                <div key={i} className="bg-[#F7F7F7] rounded-xl px-3 py-2 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-[#ADADAD] font-semibold uppercase tracking-wider">Stop {i + 1}</p>
                    <p className="text-[13px] text-[#1A1A1A] font-semibold truncate">{destLabel(s.address)}</p>
                  </div>
                  {/* Reorder — the driver visits stops in this order. */}
                  <div className="shrink-0 flex flex-col">
                    <button onClick={() => moveStop(i, -1)} disabled={i === 0}
                      aria-label={`Move stop ${i + 1} earlier`}
                      className={`w-7 h-5 flex items-center justify-center text-[10px] leading-none rounded-t-md ${i === 0 ? 'text-[#DADADA]' : 'text-[#6B6B6B] active:bg-[#EDEDED]'}`}>
                      ▲
                    </button>
                    <button onClick={() => moveStop(i, 1)} disabled={i === stops.length - 1}
                      aria-label={`Move stop ${i + 1} later`}
                      className={`w-7 h-5 flex items-center justify-center text-[10px] leading-none rounded-b-md ${i === stops.length - 1 ? 'text-[#DADADA]' : 'text-[#6B6B6B] active:bg-[#EDEDED]'}`}>
                      ▼
                    </button>
                  </div>
                  <button onClick={() => setStops((rows) => rows.filter((_, x) => x !== i))}
                    aria-label={`Remove stop ${i + 1}`}
                    className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[#9E9E9E] text-[16px] leading-none active:bg-[#EDEDED]">
                    ×
                  </button>
                </div>
              ))}
              <div className="bg-[#F7F7F7] rounded-xl px-3 py-2">
                <p className="text-[10px] text-[#ADADAD] font-semibold uppercase tracking-wider">To</p>
                <p className="text-[13px] text-[#1A1A1A] font-semibold">{destName}</p>
              </div>
            </div>
          </div>

          {/* Add stop — sits with the route, since a stop is part of the trip. */}
          <button onClick={() => setPickStop(true)}
            className="mt-3 w-full flex items-center gap-2.5 py-2.5 px-1 rounded-xl active:bg-[#F7F7F7] transition-colors">
            <span className="w-6 h-6 rounded-full bg-[#1A1A1A] text-white text-[15px] font-bold flex items-center justify-center leading-none">+</span>
            <span className="text-[13px] text-[#1A1A1A] font-semibold">Add stop</span>
            {stops.length > 0 && (
              <span className="ml-auto text-[11px] text-[#ADADAD] font-semibold">
                {stops.length} stop{stops.length > 1 ? 's' : ''}
              </span>
            )}
          </button>
        </div>

        {/* Ride options */}
        <div className="px-5 py-4">
          <p className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold mb-3">Choose your ride</p>
          <div className="flex flex-col gap-2">
            {rideOptions.map(opt => (
              <button key={opt.id} onClick={() => setSel(opt.id)}
                className={`flex items-center gap-4 px-4 py-3.5 rounded-2xl border-2 transition-all ${sel === opt.id ? 'border-[#1A1A1A] bg-white' : 'border-[#F2F2F2] bg-[#F7F7F7] hover:border-[#E0E0E0]'}`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${sel === opt.id ? 'bg-[#1A1A1A]' : 'bg-white'}`}>
                  {IC.car(sel === opt.id ? '#fff' : '#9E9E9E')}
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[14px] text-[#1A1A1A] font-semibold">{opt.name}</p>
                  <p className="text-[12px] text-[#ADADAD]">{opt.desc} ?? {opt.seats} seats</p>
                </div>
                <div className="text-right">
                  <p className="text-[14px] text-[#1A1A1A] font-semibold">{opt.price}</p>
                  <p className="text-[12px] text-[#ADADAD]">{opt.eta}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Payment — on THIS page, so the rider picks how they pay before the
            request goes out, exactly as the old app did. Cash is always offered;
            saved cards come from the server, and Add card runs the Paystack
            checkout. */}
        <div className="px-5 py-4 border-t border-[#F2F2F2]">
          <p className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold mb-3">Payment</p>

          <div className="flex flex-col gap-2">
            <PayRow
              selected={pay === PAY_CASH}
              onSelect={() => setPay(PAY_CASH)}
              title="Cash"
              subtitle="Pay the driver directly"
              icon={<span className="text-[16px]">💵</span>}
            />

            {cards.map((c) => (
              <PayRow
                key={c.id}
                selected={pay === c.id}
                onSelect={() => setPay(c.id)}
                title={`${(c.card_type || 'Card').toUpperCase()} •••• ${c.last4 || '····'}`}
                subtitle={c.bank || 'Saved card'}
                icon={IC.wallet()}
                onRemove={() => removeCard(c.id)}
              />
            ))}

            <button onClick={addCard} disabled={addingCard}
              className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 border-dashed transition-all ${addingCard ? 'border-[#F2F2F2] bg-[#F7F7F7] opacity-70' : 'border-[#E8E8E8] bg-white active:bg-[#F7F7F7]'}`}>
              {addingCard
                ? <div className="w-4 h-4 rounded-full border-2 border-[#D0D0D0] border-t-[#EA4335] animate-spin" />
                : <span className="w-6 h-6 rounded-full bg-[#1A1A1A] text-white text-[15px] font-bold flex items-center justify-center leading-none">+</span>}
              <span className="text-[13px] text-[#1A1A1A] font-semibold">
                {addingCard ? 'Waiting for your bank…' : 'Add card'}
              </span>
            </button>
          </div>

          {cardMsg && (
            <p className="text-[11px] text-[#6B6B6B] font-medium mt-2.5 leading-snug">{cardMsg}</p>
          )}
        </div>

        <div className="px-5 pb-8">
          <button onClick={() => onConfirm(sel, pay === PAY_CASH ? 'cash' : 'card', stops)}
            className="w-full bg-[#EA4335] active:bg-[#C5221F] text-white font-semibold text-[15px] py-4 rounded-2xl transition-all shadow-sm shadow-[#EA4335]/30">
            Confirm {ride.name}
          </button>
          <p className="text-[11px] text-[#ADADAD] text-center mt-2.5">
            {payLabel}{stops.length > 0 ? ` · ${stops.length} stop${stops.length > 1 ? 's' : ''}` : ''}
          </p>
        </div>
      </div>

      {/* Stop picker. A sheet rather than a new screen, so the rider never loses
          the booking they were in the middle of. */}
      {pickStop && (
        <div className="absolute inset-0 z-50 flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setPickStop(false)} />
          <div className="relative bg-white rounded-t-3xl max-h-[80%] flex flex-col shadow-[0_-4px_24px_rgba(0,0,0,0.18)]">
            <div className="px-5 pt-4 pb-3 border-b border-[#F2F2F2]">
              <div className="w-8 h-1 bg-[#E8E8E8] rounded-full mx-auto mb-4" />
              <div className="flex items-center gap-3">
                <span className="text-[16px] font-bold text-[#1A1A1A] flex-1" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
                  Add a stop
                </span>
                <button onClick={() => setPickStop(false)}
                  className="text-[13px] text-[#6B6B6B] font-semibold px-2 py-1">Done</button>
              </div>
              <div className="mt-3 flex items-center gap-3 bg-[#F7F7F7] rounded-2xl px-4 py-3">
                {IC.search()}
                <input
                  autoFocus
                  value={stopQ}
                  onChange={(e) => setStopQ(e.target.value)}
                  placeholder="Search for a stop"
                  className="flex-1 bg-transparent outline-none text-[14px] text-[#1A1A1A] placeholder:text-[#ADADAD]"
                />
                {stopBusy && <div className="w-4 h-4 rounded-full border-2 border-[#E0E0E0] border-t-[#EA4335] animate-spin" />}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {stopQ.trim().length < 2 ? (
                <p className="text-[12px] text-[#ADADAD] py-4">Type at least two letters to search.</p>
              ) : stopRes.length === 0 && !stopBusy ? (
                <p className="text-[12px] text-[#ADADAD] py-4">No places found for “{stopQ.trim()}”.</p>
              ) : (
                stopRes.map((p) => (
                  <button key={String(p.id ?? p.name)} onClick={() => chooseStop(p)}
                    className="w-full flex items-center gap-3 py-3.5 border-b border-[#F5F5F5] last:border-0 text-left active:bg-[#F7F7F7]">
                    <div className="w-9 h-9 rounded-full bg-[#F2F2F2] flex items-center justify-center shrink-0">
                      {IC.place()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] text-[#1A1A1A] font-semibold truncate">{p.name}</p>
                      {!!p.address && <p className="text-[11px] text-[#ADADAD] truncate mt-0.5">{p.address}</p>}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * One selectable payment row: a radio-style choice plus an optional remove action
 * (cash has none).
 */
function PayRow({
  selected, onSelect, title, subtitle, icon, onRemove,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  subtitle: string
  icon: ReactNode
  onRemove?: () => void
}) {
  return (
    <div className={`flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 transition-all ${selected ? 'border-[#1A1A1A] bg-white' : 'border-[#F2F2F2] bg-[#F7F7F7]'}`}>
      <button onClick={onSelect} className="flex items-center gap-3 flex-1 min-w-0 text-left">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${selected ? 'bg-[#1A1A1A]' : 'bg-white'}`}>
          <span className={selected ? 'brightness-0 invert' : ''}>{icon}</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-[#1A1A1A] font-semibold truncate">{title}</p>
          <p className="text-[11px] text-[#ADADAD] truncate">{subtitle}</p>
        </div>
        <div className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center ${selected ? 'border-[#1A1A1A]' : 'border-[#D8D8D8]'}`}>
          {selected && <div className="w-2.5 h-2.5 rounded-full bg-[#1A1A1A]" />}
        </div>
      </button>
      {onRemove && (
        <button onClick={onRemove} aria-label={`Remove ${title}`}
          className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[#9E9E9E] text-[16px] leading-none active:bg-[#EDEDED]">
          ×
        </button>
      )}
    </div>
  )
}

function MatchingScreen({ destination, tier, paymentMethod, stops, onCancel, onMatched }: {
  destination: string
  tier?: string
  /** 'cash' | 'card' — chosen on the booking screen and sent with the request. */
  paymentMethod?: string
  /** Stops added on the booking screen, sent as the ride's waypoints. */
  stops?: Waypoint[]
  onCancel: () => void
  onMatched: (rideId: string) => void
}) {
  const [tick, setTick] = useState(0)
  const [phase, setPhase] = useState<'booking' | 'waiting'>('booking')
  const [error, setError] = useState('')
  const sent = useRef(false)
  const rideIdRef = useRef<string | null>(null)
  // Where the pickup will be. When the phone cannot give us a GPS fix we ask
  // the rider to choose it rather than inventing one (see the booking effect).
  const [manualPickup, setManualPickup] = useState<{ lat: number; lng: number; label: string } | null>(null)
  const [needPickup, setNeedPickup] = useState(false)
  const [pickQ, setPickQ] = useState('')
  const [pickRes, setPickRes] = useState<Place[]>([])
  const [pickBusy, setPickBusy] = useState(false)
  // "Are you sure?" before a cancel, and the yes-path that takes the rider home.
  const [confirmCancel, setConfirmCancel] = useState(false)

  // Search for the pickup by hand (the same geocoder the destination uses).
  useEffect(() => {
    if (!needPickup) return
    const q = pickQ.trim()
    if (q.length < 2) { setPickRes([]); return }
    let alive = true
    setPickBusy(true)
    searchPlaces(q)
      .then((rows) => { if (alive) setPickRes(rows || []) })
      .catch(() => { if (alive) setPickRes([]) })
      .finally(() => { if (alive) setPickBusy(false) })
    return () => { alive = false }
  }, [pickQ, needPickup])

  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 600)
    return () => clearInterval(i)
  }, [])

  // A destination picked from search/saved places arrives as
  //   "Name||lat||lng"
  // so the exact coordinates the rider chose are used instead of geocoding the
  // text again. A plain name (typed elsewhere) falls back to a geocode lookup.
  function splitDest(d: string) {
    const parts = String(d || '').split('||')
    if (parts.length === 3) {
      const lat = Number(parts[1])
      const lng = Number(parts[2])
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { name: parts[0] || 'Destination', lat, lng, known: true }
      }
    }
    return { name: d || 'Destination', lat: NaN, lng: NaN, known: false }
  }
  const destName = splitDest(destination).name

  useEffect(() => {
    // `sent` stops a double-book. Choosing the pickup by hand deliberately
    // re-runs the booking with the coordinates the rider picked.
    if (sent.current && !manualPickup) return
    sent.current = true
    let alive = true
      ; (async () => {
        try {
          const parsed = splitDest(destination)
          let dest: { name: string; lat: number; lng: number }
          if (parsed.known) {
            dest = { name: parsed.name, lat: parsed.lat, lng: parsed.lng }
          } else {
            const places = await searchPlaces(parsed.name).catch(() => [] as Place[])
            if (!places[0]) {
              if (alive) {
                setError(`We couldn't find "${parsed.name}". Try a different address.`)
                setPhase('waiting')
              }
              return
            }
            dest = { name: places[0].address || places[0].name, lat: places[0].lat, lng: places[0].lng }
          }
          // The pickup. A cold GPS fix can take a few seconds, so try three times
          // before giving up, and if there really is no fix NEVER invent a
          // position: the old fallback was Johannesburg (-26.2041, 28.0473), which
          // is why drivers were sent to the wrong pickup while the drop-off the
          // rider typed was correct. The rider is asked to set it instead.
          let mine: { lat: number; lng: number; heading: number } | null = manualPickup
            ? { lat: manualPickup.lat, lng: manualPickup.lng, heading: 0 }
            : null
          for (let attempt = 0; attempt < 3 && !mine; attempt++) {
            mine = await getMyLocation().catch(() => null)
          }
          if (!alive) return
          if (!mine) {
            setNeedPickup(true)
            setError('We could not get your location. Turn location on, or set your pickup point below.')
            return
          }
          const from = mine
          // The driver's trip card and Earnings show the ride's pickup_address, so
          // it has to be the rider's REAL address — the literal words "Current
          // location" told the driver nothing. Resolve the fix to a street address
          // (GET /api/search/reverse) and only fall back to a coordinate pin if the
          // lookup fails, so the ride is never blocked by a geocoder problem.
          const pickupAddress = await reverseGeocode(from.lat, from.lng)
            .then((p: any) => String(p?.address || p?.name || '').trim())
            .catch(() => '')
          const res = await requestRide({
            pickupAddress: pickupAddress || `Pin ${from.lat.toFixed(5)}, ${from.lng.toFixed(5)}`,
            pickupLat: from.lat,
            pickupLng: from.lng,
            destinationAddress: dest.name,
            destinationLat: dest.lat,
            destinationLng: dest.lng,
            // Stops picked on the booking screen travel with the request, so the
            // driver's route and fare cover the whole trip, not just the endpoints.
            waypoints: stops && stops.length ? stops : undefined,
            tier: tier || 'go',
            // Flat R0.20: the server charges the saved card this real amount
            // (previously no fare was sent, so nothing was ever taken).
            fare: RIDE_FARE,
            paymentMethod: paymentMethod || 'cash',
          })
          if (!alive) return
          if (!res.ok) {
            setError(res.message)
            setPhase('waiting')
          } else {
            rideIdRef.current = res.rideId
            setPhase('waiting')
          }
        } catch (e: any) {
          if (alive) {
            setError(e?.message || 'Could not book the ride')
            setPhase('waiting')
          }
        }
      })()
    return () => { alive = false }
  }, [destination, tier, manualPickup])

  // The driver accepting arrives over the socket.
  useEffect(() => {
    const off = on('ride:accepted', (d: any) => {
      if (d?.id) {
        void notifyRide('Driver accepted', 'Your driver is on the way — tap to see the trip.')
        onMatched(String(d.id))
      }
    })
    return () => off()
  }, [onMatched])

  // SAFETY NET (the DB is the source of truth; the socket is only a shortcut).
  //
  // Why this exists: 'ride:accepted' is emitted once, to the ride room AND the
  // rider's personal room. If the matching screen was not mounted at that instant
  // (e.g. the ride was parked as 'no_drivers', the rider left the screen, or the
  // socket was mid-reconnect) the event is gone forever and the rider sits on
  // "waiting for a driver". So we also ASK THE SERVER, immediately and then every
  // 3 seconds, plus on every foreground resume and socket reconnect.
  useEffect(() => {
    let alive = true

    const check = async () => {
      try {
        const active = await getActiveRide()
        const st = String((active as any)?.status || '')
        if (!alive) return
        if ((active as any)?.id && ['accepted', 'driver_arrived', 'in_progress'].includes(st)) {
          console.log('[rider] matching: recovered from server, status =', st)
          onMatched(String((active as any).id))
        }
      } catch {
        /* keep waiting */
      }
    }

    void check()
    const timer = setInterval(check, 3000)
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVisible)
    const offConnect = on('connect', () => { void check() })
    // The driver cancelled (or the server ended the ride): the ride is gone on
    // both sides, so the rider is notified and returned to the home screen.
    const offCancel = on('ride:cancelled', (d: any) => {
      void notifyRide('Ride cancelled', d?.reason || 'This trip was cancelled.')
      onCancel()
    })

    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      offConnect()
      offCancel()
    }
  }, [onMatched])

  // Cancelling asks first, then takes the rider home (the sheet is below).
  async function cancel() {
    setConfirmCancel(true)
  }

  /** Runs only after the rider presses Yes on the sheet. */
  async function doCancel() {
    setConfirmCancel(false)
    // Only cancel something that actually exists on the server.
    if (rideIdRef.current) {
      await cancelRide(rideIdRef.current, 'Rider cancelled').catch(() => { })
    }
    onCancel()
  }

  return (
    <div className="flex flex-col h-screen">
      <div className="relative flex-1"><MapCanvas /></div>
      <div className="bg-white rounded-t-3xl shadow-[0_-4px_24px_rgba(0,0,0,0.08)] px-5 pt-6 pb-10 z-10">
        <div className="w-8 h-1 bg-[#E8E8E8] rounded-full mx-auto mb-6" />
        <div className="flex flex-col items-center gap-5 py-2">
          <div className="relative w-16 h-16">
            <div className="w-16 h-16 rounded-full border-2 border-[#F2F2F2] flex items-center justify-center">
              {IC.car('#1A1A1A')}
            </div>
            <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#EA4335] flex items-center justify-center">
              <div className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
            </div>
          </div>
          <div className="text-center px-2">
            <h2 className="text-[19px] font-semibold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
              {error ? 'Could not book' : phase === 'booking' ? 'Finding your driver' : 'Waiting for a driver'}
            </h2>
            <p className="text-[13px] text-[#ADADAD] mt-1.5">{destName}</p>
            <p className="text-[12px] text-[#ADADAD] mt-1">
              Paying by {paymentMethod === 'cash' ? 'cash' : 'card'}
              {stops && stops.length > 0 ? ` · ${stops.length} stop${stops.length > 1 ? 's' : ''}` : ''}
            </p>
            {error && (
              <p className="text-[12px] text-[#C5221F] font-semibold mt-2.5">{error}</p>
            )}
          </div>
          {!error && (
            <div className="flex gap-1.5">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-1.5 h-1.5 rounded-full transition-all duration-300"
                  style={{ background: tick % 3 === i ? '#EA4335' : '#E8E8E8' }} />
              ))}
            </div>
          )}
        </div>
        {needPickup && (
          <div className="mt-5 border border-[#EBEBEB] rounded-2xl p-4 text-left">
            <p className="text-[13px] font-semibold text-[#1A1A1A] mb-2">Where should we pick you up?</p>
            <input
              value={pickQ}
              onChange={(e) => setPickQ(e.target.value)}
              placeholder="Search a street, place or landmark"
              className="w-full border border-[#EBEBEB] rounded-xl px-3.5 py-3 text-[13px] outline-none focus:border-[#EA4335]"
            />
            {pickBusy && <p className="text-[12px] text-[#ADADAD] mt-2">Searching...</p>}
            <div className="mt-2 max-h-56 overflow-y-auto">
              {pickRes.map((p, i) => (
                <button
                  key={`${p.lat}-${p.lng}-${i}`}
                  onClick={() => {
                    setNeedPickup(false)
                    setError('')
                    setManualPickup({ lat: p.lat, lng: p.lng, label: p.address || p.name })
                  }}
                  className="w-full text-left px-1 py-2.5 border-b border-[#F2F2F2] last:border-0 active:bg-[#F7F7F7]"
                >
                  <span className="block text-[13px] font-semibold text-[#1A1A1A]">{p.name}</span>
                  <span className="block text-[12px] text-[#ADADAD]">{p.address}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {confirmCancel && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setConfirmCancel(false)}>
            <div className="w-full bg-white rounded-t-3xl p-5 pb-7" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-[18px] font-bold text-[#1A1A1A]">Cancel this ride?</h2>
              <p className="text-[13px] text-[#6B6B6B] mt-1.5">
                Are you sure? You will be taken back to the home screen.
              </p>
              <button onClick={doCancel}
                className="w-full mt-5 bg-[#C5221F] text-white font-bold text-[15px] py-4 rounded-2xl active:bg-[#A81B19]">
                Yes, cancel the ride
              </button>
              <button onClick={() => setConfirmCancel(false)}
                className="w-full mt-3 border border-[#EBEBEB] text-[#4A4A4A] font-semibold text-[14px] py-3.5 rounded-2xl active:bg-[#F7F7F7]">
                No, keep my ride
              </button>
            </div>
          </div>
        )}
        <button onClick={cancel}
          className="w-full mt-6 border border-[#EBEBEB] text-[#4A4A4A] font-semibold text-[14px] py-4 rounded-2xl hover:bg-[#F7F7F7] transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

function RideScreen({ destination, rideId, onDone }: { destination: string; rideId: string | null; onDone: () => void }) {
  const [ride, setRide] = useState<any>(null)
  const [status, setStatus] = useState<string>('accepted')
  const [toast, setToast] = useState('')
  // End-of-trip sheet: rating + tip, then Next takes the rider home.
  const [sheet, setSheet] = useState(false)
  const [stars, setStars] = useState(5)
  const [tip, setTip] = useState(0)
  const [busy, setBusy] = useState(false)
  // True when THIS phone cancelled, so our own ride:cancelled broadcast does not
  // fire a second notification or navigate twice.
  const cancelledByMe = useRef(false)
  // "Are you sure?" before cancelling.
  const [confirmCancel, setConfirmCancel] = useState(false)

  /**
   * The live route to draw. It prefers the coordinates the SERVER holds for this
   * ride (pickup → stops → drop-off) and falls back to the rider's own fix →
   * the destination they picked, so the map always has a first and last point
   * even before the driver accepts.
   */
  const [myFix, setMyFix] = useState<LatLng | null>(null)
  useEffect(() => {
    getMyLocation()
      .then((p) => setMyFix({ lat: p.lat, lng: p.lng }))
      .catch(() => { })
  }, [])
  const rideRoute = useRouteLine(tripPoints(
    coordsOf(ride?.pickup_lat, ride?.pickup_lng) ?? myFix,
    stopsOf(ride),
    coordsOf(ride?.destination_lat, ride?.destination_lng) ?? destCoords(destination),
  ))

  // Pull the ride so the driver's REAL name / vehicle / plate are shown.
  useEffect(() => {
    if (!rideId) return
    let alive = true
    getActiveRide()
      .then((r) => { if (alive && r) { setRide(r); setStatus(String(r.status || 'accepted')) } })
      .catch(() => { })
    return () => { alive = false }
  }, [rideId])

  // Follow the ride's REAL status and the driver's live position over the socket
  // — the same events the native track screen listens to (lib/socket.ts).
  useEffect(() => {
    const offs = [
      on('ride:driver:arrived', () => {
        setStatus('driver_arrived')
        void notifyRide('Driver has arrived', 'Your driver is waiting at the pickup point.')
      }),
      on('ride:started', () => {
        setStatus('in_progress')
        void notifyRide('Trip started', 'You are on your way to the destination.')
      }),
      on('ride:completed', () => { setStatus('completed'); setToast('Trip complete') }),
      on('ride:cancelled', (d: any) => {
        setStatus('cancelled')
        if (cancelledByMe.current) return
        void notifyRide('Ride cancelled', d?.reason || 'This trip was cancelled.')
        onDone()
      }),
      on('ride:driver:cancelled', (d: any) => {
        setStatus('cancelled')
        void notifyRide('Driver cancelled', d?.reason || 'Your driver cancelled the trip.')
        onDone()
      }),
      on('ride:driver:location', (d: any) =>
        setRide((r: any) => (r ? { ...r, driver_lat: d.lat, driver_lng: d.lng } : r))
      ),
      on('safety:ridecheck:alert', () => setToast('RideCheck: are you okay?')),
    ]
    return () => offs.forEach((o) => o())
  }, [])

  // Same safety net as the matching screen (3s + foreground resume + reconnect):
  // if an event was missed — or the phone was locked when the driver arrived — the
  // server still knows the truth, so the rider's screen catches up regardless.
  useEffect(() => {
    if (!rideId) return
    let alive = true

    const check = () => {
      getActiveRide()
        .then((r: any) => {
          if (!alive || !r?.id || String(r.id) !== String(rideId)) return
          const st = String(r.status || '')
          if (['accepted', 'driver_arrived', 'in_progress'].includes(st)) setStatus(st)
        })
        .catch(() => undefined)
    }

    check()
    const timer = setInterval(check, 3000)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    const offConnect = on('connect', check)

    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      offConnect()
    }
  }, [rideId])

  const driverName = ride?.driver_name || 'Your driver'
  const vehicle = [ride?.vehicle_make, ride?.vehicle_model].filter(Boolean).join(' ') || 'Vehicle'
  const plate = ride?.driver_plate || ride?.license_plate || '—'
  const rating = Number(ride?.driver_rating || 0)
  const done = status === 'completed'
  const cancelled = status === 'cancelled'
  // Once the driver presses Start trip the ride is live and the rider can no longer
  // cancel it, so the Cancel button is not rendered at all in that state.
  const started = status === 'in_progress'

  // The driver pressed End trip: open the rating + tip window immediately.
  useEffect(() => { if (done) setSheet(true) }, [done])

  async function finishTrip() {
    if (!rideId) { setSheet(false); onDone(); return }
    setBusy(true)
    // Rating first (POST /api/ratings), then the tip (POST /api/tips) — the tip is
    // best-effort so a rider without a saved card still leaves this screen.
    await submitRating(rideId, stars).catch((e: any) =>
      setToast(`Rating not saved: ${e?.message || 'error'}`)
    )
    if (tip > 0) {
      await sendTip(rideId, tip).catch(() =>
        setToast('Tip not saved — add a card in Account → Wallet')
      )
    }
    setBusy(false)
    setSheet(false)
    onDone() // the shell sends the rider home
  }

  const STATUS_TEXT: Record<string, string> = {
    accepted: 'Driver on the way',
    driver_arrived: 'Your driver has arrived',
    in_progress: 'On the trip',
    completed: 'Arrived',
    cancelled: 'Trip cancelled',
  }
  const progress = done ? 100 : status === 'in_progress' ? 60 : status === 'driver_arrived' ? 35 : 15
  const eta = status === 'accepted' ? Math.max(1, Number(ride?.duration_mins || 12)) : 0

  async function sos() {
    if (!rideId) return
    await triggerSos(rideId).catch(() => { })
    setToast('Emergency alert sent')
  }
  async function share() {
    if (!rideId) return
    await shareTrip(rideId).catch(() => { })
    setToast('Trip link shared')
  }
  // The Cancel button opens the "are you sure?" sheet instead of cancelling
  // straight away.
  function cancel() {
    setConfirmCancel(true)
  }

  /** Runs only after the rider presses Yes. The server notifies the driver. */
  async function doCancel() {
    setConfirmCancel(false)
    if (!rideId) { onDone(); return }
    cancelledByMe.current = true
    await cancelRide(rideId, 'Rider cancelled').catch(() => { })
    setStatus('cancelled')
    setToast('Ride cancelled')
    onDone() // the shell sends the rider home
  }

  return (
    <div className="flex flex-col h-screen">
      {/* rideRoute is the server's road route for this ride (pickup → stops →
          drop-off). It replaces the old dead `showRoute` flag, which the map
          ignored — see MapCanvas above. */}
      <div className="relative flex-1"><MapCanvas route={rideRoute} /></div>
      <div className="bg-white rounded-t-3xl shadow-[0_-4px_24px_rgba(0,0,0,0.08)] px-5 pt-5 pb-8 z-10">
        <div className="w-8 h-1 bg-[#E8E8E8] rounded-full mx-auto mb-4" />

        {/* ETA banner */}
        <div className={`flex items-center justify-between mb-4 px-4 py-3 rounded-2xl ${done ? 'bg-[#E8F5E9]' : 'bg-[#F7F7F7]'}`}>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#ADADAD]">{done ? 'Arrived' : STATUS_TEXT[status] || 'Driver on the way'}</p>
            <p className="text-[28px] font-bold text-[#1A1A1A] leading-none mt-0.5" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
              {done ? '✓' : eta > 0 ? `${eta} min` : STATUS_TEXT[status] || ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[12px] text-[#ADADAD]">Drop-off</p>
            <p className="text-[13px] font-semibold text-[#1A1A1A]">{destLabel(destination)}</p>
          </div>
        </div>

        {/* Progress */}
        <div className="h-1 bg-[#F2F2F2] rounded-full overflow-hidden mb-4">
          <div className="h-full bg-[#EA4335] rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>

        {/* Driver — real name, rating, vehicle and plate from the ride row, plus
            working call / message / emergency actions. */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-full bg-[#EA4335] flex items-center justify-center overflow-hidden shrink-0">
            <span className="text-[15px] font-bold text-white">
              {String(driverName).split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase() || 'D'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-[#1A1A1A] truncate capitalize">{driverName}</p>
            <div className="flex items-center gap-1 mt-0.5">
              {IC.star()}
              <span className="text-[12px] text-[#6B6B6B] font-medium truncate">
                {rating > 0 ? `${rating.toFixed(2)} · ` : ''}{vehicle}
              </span>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <a
              href={ride?.driver_phone ? `tel:${ride.driver_phone}` : undefined}
              className={`w-9 h-9 rounded-full border border-[#EBEBEB] flex items-center justify-center active:bg-[#F7F7F7] ${ride?.driver_phone ? '' : 'opacity-40 pointer-events-none'}`}
            >
              {IC.phone()}
            </a>
            <button onClick={() => setToast('Chat opens from the driver card')} className="w-9 h-9 rounded-full border border-[#EBEBEB] flex items-center justify-center active:bg-[#F7F7F7]">{IC.msg()}</button>
            <button onClick={sos} className="w-9 h-9 rounded-full border border-[#EBEBEB] flex items-center justify-center active:bg-[#FEF0EF]">{IC.shield()}</button>
          </div>
        </div>

        {/* The car, the plate and who is driving — one shared card on every stage
            (Uber-style), rebuilt from the ride row so a relaunch mid-trip redraws it. */}
        <DriverVehicleCard
          driver={{ name: driverName, photo_url: ride?.driver_photo_url, rating }}
          vehicle={{
            make: ride?.vehicle_make,
            model: ride?.vehicle_model,
            year: ride?.vehicle_year,
            colour: ride?.vehicle_color,
            image_url: (ride as any)?.vehicle_image_url,
            plate: plate,
            body_type: ride?.vehicle_body_type || ride?.body_type,
          }}
          stage={
            done ? 'completed'
            : started ? 'in_progress'
            : status === 'driver_arrived' ? 'arrived'
            : 'accepted'
          }
          compact={started && !done}
          onCall={() => { if (ride?.driver_phone) window.location.href = `tel:${ride.driver_phone}` }}
          onMessage={() => setToast('Chat opens from the driver card')}
          onMore={() => setToast('Safety tools: Share trip, SOS, RideCheck')}
        />

        <div className="flex items-center gap-2 bg-[#F7F7F7] rounded-xl px-3.5 py-2.5 mb-4">
          {IC.car('#9E9E9E')}
          <span className="text-[12px] font-bold tracking-[0.15em] text-[#1A1A1A]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{plate}</span>
          <span className="ml-auto text-[12px] text-[#ADADAD] truncate">{ride?.payment_method || 'cash'}</span>
        </div>

        {toast && (
          <p className="text-center text-[12px] font-semibold text-[#137333] mb-3">{toast}</p>
        )}

        <div className="flex gap-2">
          <button onClick={share} disabled={!rideId}
            className="flex-1 border border-[#EBEBEB] text-[#4A4A4A] font-semibold text-[13px] py-3.5 rounded-2xl active:bg-[#F7F7F7] disabled:opacity-40">
            Share trip
          </button>
          {started || done ? (
            done ? (
              <button onClick={() => setSheet(true)} className="flex-1 bg-[#1A1A1A] text-white font-semibold text-[13px] py-3.5 rounded-2xl transition">
                Rate &amp; tip your driver
              </button>
            ) : (
              <span className="flex-1 text-center text-[12px] font-semibold text-[#6B6B6B] py-3.5">Trip in progress</span>
            )
          ) : (
            <button onClick={cancel} disabled={!rideId}
              className="flex-1 border border-[#F5C6C2] text-[#C5221F] font-semibold text-[13px] py-3.5 rounded-2xl active:bg-[#FEF0EF] disabled:opacity-40">
              Cancel ride
            </button>
          )}
        </div>
        {confirmCancel && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => setConfirmCancel(false)}>
            <div className="w-full bg-white rounded-t-3xl p-5 pb-7" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-[18px] font-bold text-[#1A1A1A]">Cancel this ride?</h2>
              <p className="text-[13px] text-[#6B6B6B] mt-1.5">
                Are you sure? Your driver is told straight away and you go back to the home screen.
              </p>
              <button onClick={doCancel}
                className="w-full mt-5 bg-[#C5221F] text-white font-bold text-[15px] py-4 rounded-2xl active:bg-[#A81B19]">
                Yes, cancel the ride
              </button>
              <button onClick={() => setConfirmCancel(false)}
                className="w-full mt-3 border border-[#EBEBEB] text-[#4A4A4A] font-semibold text-[14px] py-3.5 rounded-2xl active:bg-[#F7F7F7]">
                No, keep my ride
              </button>
            </div>
          </div>
        )}
        {cancelled && (
          <p className="text-center text-[12px] text-[#C5221F] font-semibold mt-3">This trip was cancelled.</p>
        )}

        {/* End of trip: rating + tip. Opens by itself when the driver ends the trip;
            Next saves both and the shell takes the rider home. */}
        {sheet && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-end" onClick={() => { if (!busy) setSheet(false) }}>
            <div className="w-full bg-white rounded-t-3xl p-5 pb-7" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-[18px] font-bold text-[#1A1A1A]">How was your trip?</h2>
              <p className="text-[12px] text-[#6B6B6B] mt-1">
                Rate {driverName} and add a tip if you would like to.
              </p>

              <div className="flex justify-center gap-3 my-5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} onClick={() => setStars(n)} aria-label={`${n} star`}>
                    {n <= stars ? IC.star() : IC.starO()}
                  </button>
                ))}
              </div>

              <p className="text-[12px] font-semibold text-[#1A1A1A] mb-2">Add a tip</p>
              <div className="flex gap-2">
                {[0, 10, 20, 50].map((amount) => (
                  <button key={amount} onClick={() => setTip(amount)}
                    className={`flex-1 py-3 rounded-2xl text-[13px] font-semibold border ${tip === amount ? 'bg-[#1A1A1A] text-white border-[#1A1A1A]' : 'border-[#EBEBEB] text-[#4A4A4A]'}`}>
                    {amount === 0 ? 'No tip' : `R${amount}`}
                  </button>
                ))}
              </div>

              {toast && <p className="text-center text-[12px] font-semibold text-[#137333] mt-3">{toast}</p>}

              <button disabled={busy} onClick={() => void finishTrip()}
                className="w-full mt-5 bg-[#1A1A1A] text-white font-bold text-[15px] py-4 rounded-2xl disabled:opacity-50">
                {busy ? 'Saving…' : 'Next'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function RiderActivity({ onRate }: { onRate?: (rideId: string, score: number) => void }) {
  const [rides, setRides] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rating, setRating] = useState<{ rideId: string; score: number } | null>(null)

  // Real history — GET /api/rides/history (the native app's RideService
  // getRideHistory). Shows exactly the trips this rider has taken.
  useEffect(() => {
    let alive = true
    getRideHistory(1, 50)
      .then(({ rides: rows }) => { if (alive) setRides(rows) })
      .catch((e: any) => { if (alive) setError(`Could not load your trips: ${e?.message || 'unknown error'}`) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  async function rate(rideId: string, score: number) {
    setRating({ rideId, score })
    // POST /api/ratings — the same call the native app makes after a trip.
    await submitRating(rideId, score).catch((e: any) =>
      setError(`Could not save your rating: ${e?.message || 'unknown error'}`)
    )
  }

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <div className="pt-14 px-5 pb-4 bg-white border-b border-[#F2F2F2]">
        <h1 className="text-[22px] font-semibold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Activity</h1>
      </div>
      <div className="flex-1 overflow-y-auto pb-24 px-4 pt-4 flex flex-col gap-3">
        {error && (
          <div className="rounded-xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3 text-[12px] font-semibold text-[#C5221F]">{error}</div>
        )}
        {loading ? (
          <p className="text-[12px] text-[#ADADAD] text-center py-8">Loading your trips…</p>
        ) : rides.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#F0F0F0] px-4 py-8 text-center shadow-sm">
            <p className="text-[14px] font-bold text-[#1A1A1A]">No trips yet</p>
            <p className="text-[12px] text-[#ADADAD] mt-1">Your completed rides will appear here.</p>
          </div>
        ) : (
          rides.map((t) => {
            const fare = Number(t.fare ?? t.actual_fare ?? 0)
            const driver = t.counterpart_name || t.driver_name || 'Driver'
            const mine = rating && rating.rideId === t.id ? rating.score : Number(t.rating ?? t.rating_score ?? 0)
            return (
              <div key={t.id} className="bg-white rounded-2xl border border-[#F0F0F0] px-4 py-4 shadow-sm">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <div className="w-2 h-2 rounded-full bg-[#1A1A1A]" />
                    <div className="w-px h-6 bg-[#E8E8E8]" />
                    <div className="w-2 h-2 rounded-full bg-[#EA4335]" />
                  </div>
                  <div className="flex flex-col gap-3 flex-1 min-w-0">
                    <p className="text-[13px] text-[#1A1A1A] font-semibold leading-none truncate">{t.pickup || t.pickup_address || 'Pickup'}</p>
                    <p className="text-[13px] text-[#1A1A1A] font-semibold leading-none truncate">{t.destination || t.destination_address || 'Drop-off'}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[15px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{formatRand(fare)}</p>
                  </div>
                </div>
                {/* The car that did THIS trip — painted from the snapshot stamped on
                    the ride at accept time, so it stays correct even after the driver
                    changes cars later. */}
                <div className="flex items-center gap-3 pt-3">
                  <VehicleImage
                    bodyType={t.vehicle_body_type || t.body_type}
                    colour={t.vehicle_color}
                    size={78}
                    missing={!t.vehicle_make && !t.vehicle_model}
                  />
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold text-[#1A1A1A] tracking-[0.18em]"
                      style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                      {t.license_plate || '—'}
                    </p>
                    <p className="text-[11px] text-[#6B6B6B] font-semibold truncate capitalize">
                      {[colourNameOf(t.vehicle_color), t.vehicle_make, t.vehicle_model].filter(Boolean).join(' ') || 'Vehicle details pending'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-[#F5F5F5]">
                  <p className="text-[12px] text-[#ADADAD]">{fmtTripTime(t.date || t.completed_at || t.created_at)}</p>
                  <div className="flex items-center gap-1">
                    <span className="text-[12px] text-[#ADADAD]">with</span>
                    <span className="text-[12px] text-[#6B6B6B] font-semibold truncate max-w-[120px]">{driver}</span>
                  </div>
                </div>

                {/* Rate the driver — real POST /api/ratings, only for completed trips
                    that the rider hasn't already rated. */}
                {String(t.status) === 'completed' && (
                  <div className="flex items-center gap-1.5 pt-3 mt-3 border-t border-[#F5F5F5]">
                    <span className="text-[11px] text-[#ADADAD] mr-1">{mine > 0 ? 'You rated' : 'Rate driver'}</span>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button key={n} onClick={() => rate(t.id, n)} className="active:scale-95 transition-transform">
                        {IC.star(n <= mine ? '#FBBC04' : '#EBEBEB')}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function RiderNotifications({ onBack }: { onBack: () => void }) {
  const [rows, setRows] = useState<NotificationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // GET /api/notifications/history — verified live (_flow.mjs).
  useEffect(() => {
    let alive = true
    getNotifications()
      .then((r) => { if (alive) setRows(r) })
      .catch((e: any) => { if (alive) setError(`Could not load notifications: ${e?.message || 'unknown error'}`) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <div className="pt-14 px-5 pb-4 bg-white border-b border-[#F2F2F2] flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 rounded-full border border-[#EBEBEB] flex items-center justify-center shrink-0 active:bg-[#F7F7F7]">
          {IC.chevLeft()}
        </button>
        <div className="flex-1">
          <h1 className="text-[22px] font-semibold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Notifications</h1>
          <p className="text-[11px] text-[#ADADAD] mt-0.5">Trips, payments and promos</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto pb-24 px-4 pt-4">
        {error && (
          <div className="rounded-xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3 text-[12px] font-semibold text-[#C5221F] mb-3">{error}</div>
        )}
        {loading ? (
          <p className="text-[12px] text-[#ADADAD] text-center py-8">Loading…</p>
        ) : rows.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#F0F0F0] px-4 py-8 text-center shadow-sm">
            <p className="text-[14px] font-bold text-[#1A1A1A]">No notifications</p>
            <p className="text-[12px] text-[#ADADAD] mt-1">You're all caught up.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {rows.map((n) => (
              <div key={n.id} className="bg-white rounded-2xl border border-[#F0F0F0] px-4 py-3.5 shadow-sm">
                <p className="text-[13px] font-semibold text-[#1A1A1A]">{n.title || 'Notification'}</p>
                {n.body ? <p className="text-[12px] text-[#6B6B6B] mt-1">{n.body}</p> : null}
                {n.created_at ? (
                  <p className="text-[11px] text-[#ADADAD] mt-1.5">{fmtTripTime(n.created_at)}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RiderAccount({ mode, onMode, onSignOut, onNotifications, open }: {
  mode: AppMode
  onMode: (m: AppMode) => void
  onSignOut: () => void
  onNotifications: () => void
  /** Navigates to a rider screen. Every Account/Settings row uses this, so no row
   *  is a dead button (the Payment/Promo/Safety rows used to do nothing at all). */
  open: (s: RiderScreen) => void
}) {
  const [user] = useState<any>(() => getStoredUser())
  const [trips, setTrips] = useState<number | null>(null)
  const [spent, setSpent] = useState<number | null>(null)
  const [error, setError] = useState('')

  // Real history drives the stats. The rider app has no stats endpoint of its
  // own (the live server's /api/drivers/stats is driver-only), so trips and
  // spend are computed from GET /api/rides/history — the same source the
  // Activity screen lists.
  useEffect(() => {
    getRideHistory(1, 50)
      .then(({ rides, pagination }) => {
        setTrips(Number(pagination?.total ?? rides.length) || 0)
        setSpent(rides.reduce((a, r: any) => a + Number(r?.fare ?? r?.actual_fare ?? 0), 0))
      })
      .catch((e: any) => setError(`Could not load your account: ${e?.message || 'unknown error'}`))
  }, [])

  const cached = getStoredProfileInfo()
  const name = cached.full_name || user?.email?.split('@')[0] || 'Rider'
  const email = user?.email || 'Not signed in'
  const initials = String(name).split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <div className="pt-14 px-5 pb-4 bg-white border-b border-[#F2F2F2] flex items-center justify-between">
        <h1 className="text-[22px] font-semibold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Account</h1>
      </div>
      <div className="flex-1 overflow-y-auto pb-24">
        {error && (
          <div className="mx-4 mt-4 rounded-xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3 text-[12px] font-semibold text-[#C5221F]">{error}</div>
        )}
        <div className="bg-white mx-4 mt-4 rounded-2xl border border-[#F0F0F0] px-4 py-4 flex items-center gap-3 shadow-sm">
          <div className="w-14 h-14 rounded-full bg-[#EA4335] flex items-center justify-center shrink-0">
            <span className="text-[18px] font-bold text-white">{initials || 'R'}</span>
          </div>
          <div className="min-w-0">
            <p className="text-[16px] font-semibold text-[#1A1A1A] capitalize truncate">{name}</p>
            <p className="text-[13px] text-[#ADADAD] truncate">{email}</p>
          </div>
          <button className="ml-auto shrink-0">{IC.chevRight()}</button>
        </div>
        <div className="mx-4 mt-3 grid grid-cols-3 gap-2.5">
          {[
            { l: 'Trips', v: trips == null ? '—' : String(trips) },
            { l: 'Spent', v: spent == null ? '—' : formatRand(spent) },
            { l: 'Rating', v: '—' },
          ].map(s => (
            <div key={s.l} className="bg-white rounded-2xl border border-[#F0F0F0] p-3.5 text-center shadow-sm">
              <p className="text-[21px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{s.v}</p>
              <p className="text-[11px] text-[#ADADAD] mt-0.5">{s.l}</p>
            </div>
          ))}
        </div>
        {[{ t: 'Account', items: [['Your Details', () => open('profile')], ['Payment Methods', () => open('payments')], ['Promos & Invites', () => open('promos')]] }, { t: 'Preferences', items: [['Notifications', onNotifications]] }, { t: 'Settings', items: [['Emergency Contacts', () => open('safety')], ['Share Trip Status', () => open('safety')], ['Community Guidelines', () => open('guidelines')], ['Help Center', () => open('help')], ['Report an Issue', () => open('report')]] }].map(sec => (
          <div key={sec.t} className="bg-white mx-4 mt-3 rounded-2xl border border-[#F0F0F0] overflow-hidden shadow-sm">
            <p className="text-[10px] uppercase tracking-widest text-[#ADADAD] font-semibold px-4 pt-3.5 pb-1">{sec.t}</p>
            {sec.items.map((item, i) => {
              // Items may be a plain label, or [label, onClick] when the row
              // opens a real screen (e.g. Notifications).
              const [label, action] = Array.isArray(item) ? item : [item, undefined]
              return (
                <button
                  key={label as string}
                  onClick={action as (() => void) | undefined}
                  className={`w-full flex items-center justify-between px-4 py-3.5 active:bg-[#F7F7F7] transition-colors ${i < sec.items.length - 1 ? 'border-b border-[#F5F5F5]' : ''}`}
                >
                  <span className="text-[14px] text-[#1A1A1A]">{label as string}</span>
                  {IC.chevRight()}
                </button>
              )
            })}
          </div>
        ))}
        <div className="mx-4 mt-3 mb-6">
          <button onClick={onSignOut} className="w-full border border-[#EBEBEB] text-[#EA4335] font-semibold text-[14px] py-4 rounded-2xl active:bg-[#FEF0EF] transition-colors">Sign Out</button>
        </div>
      </div>
    </div>
  )
}

// ????????? DRIVER ?????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????

function Avatar({ name, size = 40, bg = '#F2F2F2' }: { name: string; size?: number; bg?: string }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const light = bg === '#F2F2F2' || bg === '#F7F7F7'
  return (
    <div className="rounded-full flex items-center justify-center shrink-0 font-bold"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.34, color: light ? '#4A4A4A' : '#fff' }}>
      {initials}
    </div>
  )
}

function DriverNav({ active, go }: { active: DriverScreen; go: (s: DriverScreen) => void }) {
  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-sm bg-white border-t border-[#EBEBEB] flex z-50">
      {([['driverHome', 'Drive', IC.car], ['earnings', 'Earnings', IC.wallet], ['driverAccount', 'Account', IC.user]] as [DriverScreen, string, (c: string) => ReactNode][]).map(([id, label, Icon]) => (
        <button key={id} onClick={() => go(id)} className={`flex-1 flex flex-col items-center pt-3 pb-4 gap-[5px] transition-colors ${active === id ? 'text-[#EA4335]' : 'text-[#ADADAD]'}`}>
          {Icon(active === id ? '#EA4335' : '#ADADAD')}
          <span className="text-[10px] font-semibold tracking-wider uppercase">{label}</span>
        </button>
      ))}
    </nav>
  )
}

/**
 * Height of the online "Waiting for requests" card, in px: a ~52px header row
 * plus a ~62px three-up stats row, rounded up. The map's own zoom/locate
 * controls are lifted by PANEL_RISE + this so they clear the card instead of
 * being drawn over it.
 */
const ONLINE_CARD_HEIGHT = 145

function DriverHome({ onRequest, mode, onMode }: { onRequest: (r: RideRequestData) => void; mode: AppMode; onMode: (m: AppMode) => void }) {
  // Restored from local storage, exactly like the native app
  // (AsyncStorage "vura.driver.online") — so leaving and reopening the APK keeps
  // the driver online instead of silently resetting to Offline.
  const [online, setOnline] = useState(() => getStoredOnline())
  const [stats, setStats] = useState<DriverStats | null>(null)
  const [balance, setBalance] = useState(0)
  const [trips, setTrips] = useState<ReturnType<typeof normalizeRide>[]>([])

  // Real driver data ??? the same endpoints the React Native driver app calls.
  useEffect(() => {
    getDriverStats().then(setStats).catch(() => { })
    getWalletBalance()
      .then((d) => setBalance(Number(d?.total_earnings) || 0))
      .catch(() => { })
    getRecentTrips(3)
      .then((d) => setTrips(((d?.rides || []) as any[]).slice(0, 3).map(normalizeRide)))
      .catch(() => { })
    // If the driver was online when they last used the app, re-announce it to the
    // server on launch so rides keep being routed to them (the native app does
    // the same on socket connect).
    if (getStoredOnline()) resyncOnlineState().catch(() => { })
  }, [])

  // Live ride requests over the SAME socket the native app uses. The payload
  // carries the real pickup/drop-off/fare/rider, which is handed to RideRequest.
  useEffect(() => {
    const off = on('ride:request', (data: RideRequestData) => {
      if (data?.id) onRequest(data)
    })
    return () => {
      off()
    }
  }, [onRequest])

  // While online, publish GPS so the server can match nearby rides.
  useEffect(() => {
    if (!online) return
    const push = () => {
      navigator.geolocation?.getCurrentPosition(
        (p) => publishLocation(p.coords.latitude, p.coords.longitude, p.coords.heading ?? 0),
        () => { },
        { enableHighAccuracy: false, timeout: 8000 }
      )
    }
    push()
    const timer = window.setInterval(push, 15000)
    return () => window.clearInterval(timer)
  }, [online])

  // Toggle online locally AND on the server, in one call.
  const setOnlineEverywhere = async (next: boolean) => {
    setOnline(next)
    await goOnline(next).catch(() => { })
  }

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      {/* Map */}
      <div className="relative" style={{ height: online ? '55%' : '42%' }}>
        {/* Map — no explicit marker: it locks onto the device's REAL GPS fix and keeps
            following it as the driver moves (watchPosition), zoomed to street level.
            When online, the "Waiting for requests" card is pinned to the bottom of
            this area, so the map's own zoom/locate buttons are lifted to clear it. */}
        <MapCanvas zoom={16} controls controlsBottom={online ? PANEL_RISE + ONLINE_CARD_HEIGHT + 12 : PANEL_RISE + 12} follow />
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-5 pt-12">
          <div className="bg-white/90 backdrop-blur-md rounded-2xl px-3.5 py-2 shadow-sm border border-white/60 flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${online ? 'bg-[#34A853]' : 'bg-[#D0D0D0]'}`}
              style={online ? { boxShadow: '0 0 0 3px rgba(52,168,83,0.18)' } : {}} />
            <span className="text-[13px] text-[#1A1A1A] font-semibold">{online ? 'Online' : 'Offline'}</span>
          </div>
        </div>

        {/* Online floating card. Lifted by PANEL_RISE so the white panel's
            20px "sheet" rise cannot clip the Balance / Trips / Rating row. */}
        {online && (
          <div className="absolute inset-x-0 bg-white shadow-[0_-2px_12px_rgba(0,0,0,0.08)] overflow-hidden"
            style={{ bottom: PANEL_RISE }}>
            <div className="flex items-center gap-3 px-5 py-3.5 border-b border-[#F2F2F2]">
              <div className="w-2 h-2 rounded-full bg-[#34A853] animate-pulse" />
              <span className="text-[14px] text-[#1A1A1A] font-semibold">Waiting for requests</span>
              <button onClick={() => setOnlineEverywhere(false)}
                className="ml-auto text-[12px] text-[#6B6B6B] font-semibold border border-[#E8E8E8] px-3 py-1.5 rounded-xl active:bg-[#F7F7F7]">
                Go offline
              </button>
            </div>
            <div className="grid grid-cols-3 divide-x divide-[#F2F2F2]">
              {[
                { l: 'Balance', v: formatRand(balance) },
                { l: 'Trips', v: String(stats?.allTime?.rides ?? 0) },
                { l: 'Rating', v: stats && stats.rating?.average > 0 ? Number(stats.rating.average).toFixed(2) : 'New' },
              ].map(s => (
                <div key={s.l} className="flex flex-col items-center py-3.5">
                  <span className="text-[17px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{s.v}</span>
                  <span className="text-[10px] text-[#ADADAD] mt-0.5 font-semibold uppercase tracking-wider">{s.l}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom panel.

          It rises 20px over the map (-mt-5) as a deliberate "sheet" effect, and
          because it comes AFTER the map in the DOM it paints on top of anything
          pinned to the map's bottom edge. PANEL_RISE is the single source of truth
          for that overlap, so the online card and the zoom controls stay clear of it.
          `z-10` lifts the sheet over the map's 20px strip: it is a flex item, and
          z-index applies to flex items even when the position is static. Every other
          screen's panel in this file uses the same `bg-white z-10` pairing. */}
      <div className="flex-1 bg-white z-10 rounded-t-3xl shadow-[0_-4px_24px_rgba(0,0,0,0.06)] -mt-5 overflow-y-auto pb-24">
        <div className="px-5 pt-5">
          {/* Go online CTA */}
          {!online && (
            <button onClick={() => setOnlineEverywhere(true)}
              className="w-full bg-[#EA4335] text-white font-bold text-[16px] py-4 rounded-2xl mb-5 active:bg-[#C5221F] transition-colors"
              style={{ boxShadow: '0 4px 16px rgba(234,67,53,0.28)' }}>
              Go online
            </button>
          )}

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2.5 mb-5">
            {[
              { l: 'Earned today', v: formatRand(stats?.today?.earned ?? 0) },
              { l: 'Trips', v: String(stats?.allTime?.rides ?? 0) },
              { l: 'This month', v: formatRand(stats?.thisMonth?.earned ?? 0) },
            ].map(s => (
              <div key={s.l} className="bg-[#F7F7F7] rounded-2xl p-3 text-center border border-[#F0F0F0]">
                <p className="text-[16px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{s.v}</p>
                <p className="text-[10px] text-[#ADADAD] mt-0.5 leading-tight font-semibold">{s.l}</p>
              </div>
            ))}
          </div>

          {/* Demand zones */}
          <div className="bg-[#F7F7F7] rounded-2xl border border-[#F0F0F0] p-4 mb-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold">Demand nearby</p>
              <span className="text-[11px] text-[#34A853] font-semibold">Live</span>
            </div>
            <div className="flex gap-2">
              {[{ z: 'Downtown', l: 'High', c: '#EA4335', pct: 90 }, { z: 'SoMa', l: 'Medium', c: '#FBBC04', pct: 55 }, { z: 'Mission', l: 'Low', c: '#34A853', pct: 30 }].map(d => (
                <div key={d.z} className="flex-1 rounded-xl p-3 bg-white border border-[#EBEBEB]">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: d.c }} />
                    <span className="text-[10px] font-bold" style={{ color: d.c }}>{d.l}</span>
                  </div>
                  <p className="text-[12px] text-[#1A1A1A] font-semibold">{d.z}</p>
                  <div className="h-0.5 bg-[#F0F0F0] rounded-full mt-2 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${d.pct}%`, background: d.c }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent trips */}
          <p className="text-[11px] uppercase tracking-widest text-[#ADADAD] font-semibold mb-2">Recent trips</p>
          {trips.length === 0 ? (
            <p className="text-[12px] text-[#ADADAD] py-3">No completed trips yet.</p>
          ) : (
            trips.map((t, i) => (
              <div key={t.id} className={`flex items-center justify-between py-3.5 ${i < trips.length - 1 ? 'border-b border-[#F5F5F5]' : ''}`}>
                <div className="min-w-0 flex-1 pr-3">
                  <p className="text-[13px] text-[#1A1A1A] font-semibold truncate">{t.destination}</p>
                  <p className="text-[11px] text-[#ADADAD] mt-0.5">{fmtTripTime(t.date)}</p>
                </div>
                <span className="text-[14px] font-bold text-[#1A1A1A] shrink-0" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{formatRand(t.fare)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function RideRequest({ request, onAccept, onDecline }: { request: RideRequestData | null; onAccept: () => void; onDecline: () => void }) {
  const [secs, setSecs] = useState(15)
  useEffect(() => {
    if (secs <= 0) { onDecline(); return }
    const t = setTimeout(() => setSecs(s => s - 1), 1000)
    return () => clearTimeout(t)
  }, [secs])
  const pct = secs / 15
  const r = 22
  const circ = 2 * Math.PI * r

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <div className="relative flex-1"><MapCanvas /></div>

      <div className="bg-white z-10 shadow-[0_-4px_24px_rgba(0,0,0,0.08)]">
        {/* Timer strip */}
        <div className="h-0.5 bg-[#F0F0F0]">
          <div className="h-full bg-[#EA4335] transition-all" style={{ width: `${pct * 100}%`, transitionDuration: '1s', transitionTimingFunction: 'linear' }} />
        </div>

        <div className="px-5 pt-5 pb-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-[11px] text-[#ADADAD] uppercase tracking-widest font-semibold mb-1">{request?.isScheduled ? 'Scheduled pickup' : 'New request'}</p>
              <h2 className="text-[26px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{formatRand(request?.fare ?? 0)}</h2>
              <p className="text-[13px] text-[#ADADAD] mt-0.5">
                {request?.paymentMethod === 'cash' ? 'Cash' : 'Card'}
                {request?.riderName ? ` ?? ${request.riderName}` : ''}
                {request?.scheduledAt ? ` ?? ${new Date(request.scheduledAt).toLocaleString('en-ZA', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}` : ''}
              </p>
            </div>
            <div className="relative w-14 h-14 shrink-0">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 52 52">
                <circle cx="26" cy="26" r={r} fill="none" stroke="#F0F0F0" strokeWidth="3" />
                <circle cx="26" cy="26" r={r} fill="none" stroke="#EA4335" strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
                  style={{ transition: 'stroke-dashoffset 1s linear' }} />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[15px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{secs}</span>
            </div>
          </div>

          {/* Route card */}
          <div className="bg-[#F7F7F7] border border-[#EBEBEB] rounded-2xl p-4 mb-4">
            <div className="flex gap-3.5 mb-4">
              <div className="flex flex-col items-center gap-1 shrink-0 mt-1">
                <div className="w-2 h-2 rounded-full border-2 border-[#1A1A1A] bg-transparent" />
                <div className="w-px bg-[#E0E0E0]" style={{ height: 28 }} />
                <div className="w-2 h-2 rounded-full bg-[#EA4335]" />
              </div>
              <div className="flex flex-col gap-3 flex-1">
                <div>
                  <p className="text-[10px] text-[#ADADAD] font-semibold uppercase tracking-wider">Pickup</p>
                  <p className="text-[14px] text-[#1A1A1A] font-semibold mt-0.5">{request?.pickupAddress || 'Pickup'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-[#ADADAD] font-semibold uppercase tracking-wider">Drop-off</p>
                  <p className="text-[14px] text-[#1A1A1A] font-semibold mt-0.5">{request?.destinationAddress || 'Drop-off'}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-3.5 border-t border-[#EBEBEB]">
              <Avatar name={request?.riderName || 'Rider'} size={34} bg="#F0F0F0" />
              <div className="flex-1">
                <p className="text-[13px] text-[#1A1A1A] font-semibold">{request?.riderName || 'Rider'}</p>
                <div className="flex items-center gap-1 mt-0.5">
                  {IC.star('#FBBC04')}
                  <span className="text-[11px] text-[#6B6B6B]">
                    {request?.riderRating ? Number(request.riderRating).toFixed(2) : 'New'}
                    {' ?? '}
                    {request?.paymentMethod === 'cash' ? 'Cash' : 'Card'}
                  </span>
                </div>
              </div>
              <span className="text-[11px] text-[#6B6B6B] font-medium border border-[#E8E8E8] bg-white px-2.5 py-1 rounded-lg">Driver</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={onDecline}
              className="flex-1 border border-[#EBEBEB] bg-[#F7F7F7] text-[#6B6B6B] font-semibold text-[14px] py-4 rounded-2xl active:bg-[#EBEBEB] transition-colors">
              Decline
            </button>
            <button onClick={onAccept}
              className="flex-[2.5] bg-[#EA4335] text-white font-bold text-[15px] py-4 rounded-2xl active:bg-[#C5221F] transition-colors"
              style={{ boxShadow: '0 4px 16px rgba(234,67,53,0.28)' }}>
              Accept
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function DriverPickup({ request, onArrived }: { request: RideRequestData | null; onArrived: () => void }) {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const i = setInterval(() => setProgress(p => p >= 100 ? 100 : p + 2), 90)
    return () => clearInterval(i)
  }, [])
  const eta = Math.max(0, Math.round(2 * (1 - progress / 100)))
  const done = progress >= 100

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <div className="relative flex-1"><MapCanvas /></div>

      <div className="bg-white z-10 shadow-[0_-4px_24px_rgba(0,0,0,0.08)]">
        <div className="h-0.5 bg-[#F0F0F0]">
          <div className="h-full bg-[#EA4335] transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <div className="px-5 pt-4 pb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[11px] text-[#ADADAD] uppercase tracking-widest font-semibold">{done ? 'You\'ve arrived' : 'Heading to pickup'}</p>
              <h2 className="text-[26px] font-bold mt-0.5" style={{ fontFamily: 'Space Grotesk, sans-serif', color: done ? '#34A853' : '#1A1A1A' }}>
                {done ? 'Arrived' : `${eta} min away`}
              </h2>
              <p className="text-[13px] text-[#ADADAD] mt-0.5">{request?.pickupAddress || 'Pickup'}</p>
            </div>
            {done && (
              <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(52,168,83,0.1)', border: '1px solid rgba(52,168,83,0.2)' }}>
                {IC.check('#34A853')}
              </div>
            )}
          </div>

          <div className="bg-[#F7F7F7] border border-[#EBEBEB] rounded-2xl px-4 py-3.5 mb-4 flex items-center gap-3">
            <Avatar name={request?.riderName || 'Rider'} size={40} bg="#EBEBEB" />
            <div className="flex-1">
              <p className="text-[14px] text-[#1A1A1A] font-semibold">{request?.riderName || 'Rider'}</p>
              <div className="flex items-center gap-1 mt-0.5">
                {IC.star('#FBBC04')}
                <span className="text-[12px] text-[#6B6B6B]">
                  {request?.riderRating ? Number(request.riderRating).toFixed(2) : 'New'}
                  {' ?? '}
                  {request?.paymentMethod === 'cash' ? 'Cash' : 'Card'}
                </span>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="w-10 h-10 rounded-full bg-white border border-[#EBEBEB] flex items-center justify-center active:bg-[#F7F7F7]">
                {IC.phone()}
              </button>
              <button className="w-10 h-10 rounded-full bg-white border border-[#EBEBEB] flex items-center justify-center active:bg-[#F7F7F7]">
                {IC.msg()}
              </button>
              {/* Waze to the pickup ??? honours the Account screen's toggle. */}
              <button
                onClick={() => openWaze(request?.pickupLat, request?.pickupLng)}
                className="w-10 h-10 rounded-full bg-white border border-[#EBEBEB] flex items-center justify-center active:bg-[#F7F7F7]"
              >
                <span className="text-[11px] font-bold text-[#33CCFF]">W</span>
              </button>
            </div>
          </div>

          <button onClick={onArrived} disabled={!done}
            className={`w-full font-bold text-[15px] py-4 rounded-2xl transition-all ${done ? 'bg-[#EA4335] text-white active:bg-[#C5221F]' : 'bg-[#F7F7F7] text-[#C4C4C4] cursor-not-allowed border border-[#EBEBEB]'}`}
            style={done ? { boxShadow: '0 4px 16px rgba(234,67,53,0.28)' } : {}}>
            {done ? 'Start trip' : 'Navigating to pickup???'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DriverDropoff({ request, onComplete }: { request: RideRequestData | null; onComplete: () => void }) {
  const [progress, setProgress] = useState(0)
  useEffect(() => {
    const i = setInterval(() => setProgress(p => p >= 100 ? 100 : p + 0.55), 120)
    return () => clearInterval(i)
  }, [])
  // Real fare from the ride request, not the prototype's hardcoded 38.40.
  const fare = Number(request?.fare ?? 0)
  const earned = (fare * progress / 100).toFixed(2)
  const eta = Math.max(0, Math.round(28 * (1 - progress / 100)))
  const done = progress >= 100

  // The line the map draws. On this prototype screen the driver's own GPS fix is
  // not carried in the request, so the route comes from the request's own
  // pickup/drop-off coordinates — the same source the rider's screen uses.
  const dropRoute = useRouteLine(tripPoints(
    coordsOf(request?.pickupLat, request?.pickupLng),
    [],
    coordsOf(request?.destinationLat, request?.destinationLng),
  ))

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <div className="relative flex-1"><MapCanvas route={dropRoute} /></div>

      <div className="bg-white z-10 shadow-[0_-4px_24px_rgba(0,0,0,0.08)]">
        <div className="h-0.5 bg-[#F0F0F0]">
          <div className="h-full bg-[#EA4335] transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>
        <div className="px-5 pt-4 pb-8">
          <div className="flex items-end justify-between mb-4">
            <div>
              <p className="text-[11px] text-[#ADADAD] uppercase tracking-widest font-semibold">Trip earnings</p>
              <p className="text-[40px] font-bold text-[#1A1A1A] leading-none mt-1" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{formatRand(earned)}</p>
            </div>
            <div className="text-right pb-1">
              <p className="text-[12px] text-[#ADADAD]">Destination</p>
              <p className="text-[14px] text-[#1A1A1A] font-semibold truncate">{request?.destinationAddress || 'Destination'}</p>
              <p className="text-[13px] text-[#ADADAD] mt-0.5" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                {done ? '???' : `${eta} min left`}
              </p>
            </div>
          </div>

          <div className="h-1.5 bg-[#F0F0F0] rounded-full overflow-hidden mb-4">
            <div className="h-full bg-[#EA4335] rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>

          <div className="flex items-center gap-3 bg-[#F7F7F7] border border-[#EBEBEB] rounded-2xl px-4 py-3.5 mb-4">
            <Avatar name={request?.riderName || 'Rider'} size={38} bg="#EBEBEB" />
            <div className="flex-1">
              <p className="text-[14px] text-[#1A1A1A] font-semibold capitalize truncate">{request?.riderName || 'Rider'}</p>
              <p className="text-[12px] text-[#ADADAD] mt-0.5">{request?.paymentMethod ? `${request.paymentMethod} · ` : ''}{formatRand(fare)}</p>
            </div>
            <div className="flex gap-2">
              <button className="w-9 h-9 rounded-full bg-white border border-[#EBEBEB] flex items-center justify-center">{IC.phone()}</button>
              <button className="w-9 h-9 rounded-full bg-white border border-[#EBEBEB] flex items-center justify-center">{IC.msg()}</button>
            </div>
          </div>

          {done
            ? <button onClick={onComplete} className="w-full bg-[#EA4335] text-white font-bold text-[15px] py-4 rounded-2xl active:bg-[#C5221F]"
              style={{ boxShadow: '0 4px 16px rgba(234,67,53,0.28)' }}>
              Complete trip · {formatRand(fare)}
            </button>
            : <div className="flex items-center justify-center gap-2 py-3">
              <div className="w-1.5 h-1.5 rounded-full bg-[#EA4335] animate-pulse" />
              <p className="text-[13px] text-[#ADADAD] font-medium">In progress ?? Focus on the road</p>
            </div>}
        </div>
      </div>
    </div>
  )
}

function TripComplete({ request, onDone }: { request: RideRequestData | null; onDone: () => void }) {
  // Pull the completed ride straight from the DB so the money shown here is the
  // real actual_fare / platform_fee / driver_earned — not the old prototype's
  // hard-coded 38.40.
  const [ride, setRide] = useState<any>(null)
  useEffect(() => {
    if (!request?.id) return
    getRide(request.id).then(setRide).catch(() => { })
  }, [request?.id])

  const fare = Number(ride?.actual_fare ?? ride?.estimated_fare ?? request?.fare ?? 0)
  const fee = Number(ride?.platform_fee ?? 0)
  const earned = Number(ride?.driver_earned ?? (fare - fee))
  const rider = ride?.passenger_name || request?.riderName || 'Rider'
  const destination = ride?.destination_address || request?.destinationAddress || 'Destination'
  return (
    <div className="flex flex-col h-screen bg-white">
      <div className="flex-1 flex flex-col items-center justify-center px-5">
        <div className="w-16 h-16 rounded-full bg-[#F0FAF4] border border-[#34A853]/20 flex items-center justify-center mb-6">
          {IC.check('#34A853')}
        </div>
        <h2 className="text-[28px] font-bold text-[#1A1A1A] text-center" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Trip complete</h2>
        <p className="text-[14px] text-[#ADADAD] mt-2 capitalize">{rider} · {destination}</p>
        <div className="mt-6 flex items-baseline gap-1.5">
          <span className="text-[15px] text-[#ADADAD] font-medium">You earned</span>
          <span className="text-[44px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{formatRand(earned)}</span>
        </div>
        <div className="flex gap-2 mt-5">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="w-9 h-9 rounded-full bg-[#F7F7F7] border border-[#F0F0F0] flex items-center justify-center">
              {IC.star('#FBBC04')}
            </div>
          ))}
        </div>
        <p className="text-[12px] text-[#ADADAD] mt-2">Rate your rider</p>
      </div>

      <div className="px-5 pb-8">
        <div className="bg-[#F7F7F7] border border-[#F0F0F0] rounded-2xl p-4 mb-4">
          <p className="text-[10px] text-[#ADADAD] uppercase tracking-widest font-semibold mb-3">Fare breakdown</p>
          {([
            ['Trip fare', formatRand(fare)],
            ['Service fee', `-${formatRand(fee)}`],
            ['Payment', String(ride?.payment_method || request?.paymentMethod || 'Card')],
          ] as [string, string][]).map(([k, v]) => (
            <div key={k} className="flex justify-between py-2.5 border-b border-[#EBEBEB] last:border-0">
              <span className="text-[13px] text-[#6B6B6B]">{k}</span>
              <span className="text-[13px] text-[#1A1A1A] font-semibold" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{v}</span>
            </div>
          ))}
          <div className="flex justify-between pt-3">
            <span className="text-[14px] text-[#1A1A1A] font-bold">Total paid out</span>
            <span className="text-[14px] font-bold text-[#34A853]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{formatRand(earned)}</span>
          </div>
        </div>
        <button onClick={onDone} className="w-full bg-[#EA4335] text-white font-bold text-[15px] py-4 rounded-2xl active:bg-[#C5221F]"
          style={{ boxShadow: '0 4px 16px rgba(234,67,53,0.28)' }}>
          Done
        </button>
      </div>
    </div>
  )
}

function Earnings() {
  const [stats, setStats] = useState<DriverStats | null>(null)
  const [week, setWeek] = useState<EarningsSummary | null>(null)
  const [trips, setTrips] = useState<ReturnType<typeof normalizeRide>[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  // Exactly the calls the React Native earnings screen makes:
  //   GET /api/earnings?period=week  -> totals.net + a per-day breakdown
  //   GET /api/rides/history         -> the trip list shown underneath
  // (plus /api/drivers/stats for today / this month / rating).
  useEffect(() => {
    let alive = true
    // Capture the real failure reason for each call so the UI can show it
    // instead of a vague "session may have expired" (a transport failure is not
    // a session problem).
    let earnErr = ''
    let histErr = ''
    Promise.all([
      getDriverStats().catch(() => null),
      getEarnings('week').catch((e: any) => { earnErr = e?.message || 'unknown error'; return null }),
      getRecentTrips(10).catch((e: any) => { histErr = e?.message || 'unknown error'; return null }),
    ])
      .then(([s, e, h]) => {
        if (!alive) return
        setStats(s)
        setWeek(e)
        setTrips(((h?.rides || []) as any[]).map(normalizeRide))
        if (!e) setLoadError(`Could not load earnings: ${earnErr}`)
        else if (!h) setLoadError(`Could not load your trips: ${histErr}`)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  // Build the Mon..Sun bars from the date-grouped breakdown, the same way the
  // native app does (it buckets each row into its weekday).
  const byDay = Array(7).fill(0)
  for (const b of week?.breakdown || []) {
    const d = new Date(b.date)
    if (!isNaN(d.getTime())) byDay[dayIndex(d)] += Number(b.net) || 0
  }
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  const bars = labels.map((day, i) => ({ day, amount: Math.round(byDay[i]) }))
  const max = Math.max(1, ...bars.map((b) => b.amount))
  const todayIdx = dayIndex(new Date())

  const weekNet = Number(week?.totals?.net ?? 0)
  const weekGross = Number(week?.totals?.gross ?? 0)
  const weekFee = Number(week?.totals?.fee ?? 0)
  const weekRides = Number(week?.totals?.rides ?? 0)
  const todayTotal = Number(stats?.today?.earned ?? 0)
  const perTrip = weekRides > 0 ? weekNet / weekRides : 0
  // "% vs last week" — the same calculation the native earnings screen runs.
  const prevNet = Number(week?.totals?.lastWeekNet ?? 0)
  const pct = weekNet > 0 && prevNet > 0 ? Math.round(((weekNet - prevNet) / prevNet) * 100) : null
  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <div className="pt-14 px-5 pb-4 bg-white border-b border-[#F2F2F2]">
        <p className="text-[11px] text-[#ADADAD] uppercase tracking-widest font-semibold mb-0.5">This week</p>
        <h1 className="text-[22px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Earnings</h1>
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        {loadError && (
          <div className="mx-4 mt-4 rounded-xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3 text-[12px] font-semibold text-[#C5221F]">
            {loadError}
          </div>
        )}
        {/* Hero card */}
        <div className="mx-4 mt-4 mb-3 bg-white rounded-3xl border border-[#F0F0F0] p-5 shadow-sm">
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-[11px] text-[#ADADAD] uppercase tracking-widest font-semibold">Net this week</p>
              <p className="text-[40px] font-bold text-[#1A1A1A] leading-none mt-1.5" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{formatRand(weekNet)}</p>
              <div className="flex items-center gap-1.5 mt-1.5">
                {IC.trend()}
                <span className="text-[12px] text-[#34A853] font-semibold">
                  {pct != null ? `${pct >= 0 ? '+' : ''}${pct}% vs last week` : `${weekRides} trips completed`}
                </span>
              </div>
            </div>
            <div className="bg-[#FCE8E6] border border-[#EA4335]/15 rounded-2xl px-3.5 py-2.5 text-center">
              <p className="text-[10px] text-[#EA4335] font-bold uppercase tracking-wider">Today</p>
              <p className="text-[20px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{formatRand(todayTotal)}</p>
            </div>
          </div>
          <div className="flex items-end gap-1.5 h-[72px]">
            {bars.map((d, idx) => (
              <div key={idx} className="flex-1 flex flex-col items-center gap-1.5">
                <div className="w-full rounded-[4px]"
                  style={{ height: `${Math.max(3, (d.amount / max) * 56)}px`, background: idx === todayIdx ? '#EA4335' : '#F0F0F0' }} />
                <span className="text-[10px] font-semibold" style={{ color: idx === todayIdx ? '#EA4335' : '#C4C4C4' }}>{d.day}</span>
              </div>
            ))}
          </div>
        </div>

        {/* KPI row */}
        <div className="mx-4 grid grid-cols-3 gap-2.5 mb-4">
          {[
            { l: 'Trips', v: String(weekRides) },
            { l: 'Gross', v: formatRand(weekGross) },
            { l: 'Per trip', v: formatRand(perTrip) },
          ].map(s => (
            <div key={s.l} className="bg-white rounded-2xl border border-[#F0F0F0] py-3.5 px-3 text-center shadow-sm">
              <p className="text-[19px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{s.v}</p>
              <p className="text-[10px] text-[#ADADAD] mt-0.5 font-semibold leading-tight">{s.l}</p>
            </div>
          ))}
        </div>

        {/* Platform fee for the week - straight from /api/earnings */}
        <div className="mx-4 mb-4 bg-white rounded-2xl border border-[#F0F0F0] px-4 py-3 shadow-sm flex items-center justify-between">
          <span className="text-[12px] text-[#ADADAD] font-semibold">Service fee this week</span>
          <span className="text-[13px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>-{formatRand(weekFee)}</span>
        </div>

        {/* Trip history */}
        <div className="mx-4">
          <p className="text-[11px] text-[#ADADAD] uppercase tracking-widest font-semibold mb-3">Trip history</p>
          <div className="bg-white rounded-2xl border border-[#F0F0F0] overflow-hidden shadow-sm">
            {loading ? (
              <p className="px-4 py-6 text-[12px] text-[#ADADAD] text-center">Loading your trips…</p>
            ) : trips.length === 0 ? (
              <p className="px-4 py-6 text-[12px] text-[#ADADAD] text-center">No completed trips yet.</p>
            ) : (
              trips.map((trip, i) => (
                <div key={trip.id} className={`px-4 py-4 ${i < trips.length - 1 ? 'border-b border-[#F5F5F5]' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-1 shrink-0 mt-1">
                      <div className="w-1.5 h-1.5 rounded-full border border-[#C4C4C4] bg-transparent" />
                      <div className="w-px bg-[#EBEBEB]" style={{ height: 18 }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-[#EA4335]" />
                    </div>
                    <div className="flex-1 flex flex-col gap-2.5 min-w-0">
                      <p className="text-[13px] text-[#1A1A1A] font-semibold leading-none truncate">{trip.pickup}</p>
                      <p className="text-[13px] text-[#ADADAD] font-semibold leading-none truncate">{trip.destination}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[15px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{formatRand(trip.fare)}</p>
                      <div className="flex justify-end gap-0.5 mt-1">
                        {Array.from({ length: 5 }).map((_, j) =>
                          j < Math.round(Number(trip.rating) || 0) ? IC.star('#FBBC04') : IC.starO('#EBEBEB'))}
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-[#C4C4C4] mt-2.5" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                    {fmtTripTime(trip.date)}
                    {trip.distanceKm > 0 ? ` · ${trip.distanceKm.toFixed(1)} km` : ''}
                    {trip.durationMins > 0 ? ` · ${Math.round(trip.durationMins)} min` : ''}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Trip history — the port of the native app/driver/trips.tsx screen. Same two
 * calls (GET /api/rides/history?limit=50 and GET /api/drivers/stats), so the
 * completed count and average rating come straight from the database.
 */
function TripHistory({ onBack }: { onBack: () => void }) {
  const [trips, setTrips] = useState<ReturnType<typeof normalizeRide>[]>([])
  const [stats, setStats] = useState<DriverStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let alive = true
    let histErr = ''
    Promise.all([
      getRecentTrips(50).catch((e: any) => { histErr = e?.message || 'unknown error'; return null }),
      getDriverStats().catch(() => null),
    ])
      .then(([h, s]) => {
        if (!alive) return
        setTrips(((h?.rides || []) as any[]).map(normalizeRide))
        setStats(s)
        if (!h) setLoadError(`Could not load your trips: ${histErr}`)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const completed = Number(stats?.allTime?.rides ?? 0)
  const avg = Number(stats?.rating?.average ?? 0)

  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <div className="pt-14 px-5 pb-4 bg-white border-b border-[#F2F2F2] flex items-center gap-3">
        <button onClick={onBack} className="w-9 h-9 rounded-full border border-[#EBEBEB] flex items-center justify-center shrink-0 active:bg-[#F7F7F7]">
          {IC.chevLeft()}
        </button>
        <div className="flex-1">
          <h1 className="text-[22px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Trips</h1>
          <p className="text-[11px] text-[#ADADAD] mt-0.5">
            {completed} completed · {avg > 0 ? `${avg.toFixed(2)} avg rating` : 'no ratings yet'}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-24 px-4 pt-4">
        {loadError && (
          <div className="rounded-xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3 text-[12px] font-semibold text-[#C5221F] mb-4">
            {loadError}
          </div>
        )}
        {loading ? (
          <p className="text-[12px] text-[#ADADAD] text-center py-8">Loading your trips…</p>
        ) : trips.length === 0 ? (
          <div className="bg-white rounded-2xl border border-[#F0F0F0] px-4 py-8 text-center shadow-sm">
            <p className="text-[14px] font-bold text-[#1A1A1A]">No trips yet</p>
            <p className="text-[12px] text-[#ADADAD] mt-1">Completed trips will appear here.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {trips.map((t) => (
              <div key={t.id} className="bg-white rounded-2xl border border-[#F0F0F0] px-4 py-3.5 shadow-sm">
                <div className="flex items-start gap-3">
                  <Avatar name={t.partner} size={38} bg="#F2F2F2" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-[#1A1A1A] capitalize truncate">{t.partner}</p>
                    <p className="text-[12px] text-[#ADADAD] mt-0.5 truncate">{t.pickup} → {t.destination}</p>
                    <div className="flex items-center gap-1 mt-1">
                      {IC.star('#FBBC04')}
                      <span className="text-[11px] text-[#ADADAD]">
                        {Number(t.rating) > 0 ? `${Number(t.rating).toFixed(1)} · ` : ''}{fmtTripTime(t.date)}
                      </span>
                    </div>
                  </div>
                  <span className="text-[14px] font-bold text-[#1A1A1A] shrink-0" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                    {formatRand(t.fare)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** The driver's Account tab: profile, Rating/Trips/Money, documents, Waze, sign out. */
function DriverAccount({ mode, onMode, onLinkCar, onTrips, onSettings, onWallet }: { mode: AppMode; onMode: (m: AppMode) => void; onLinkCar: () => void; onTrips: () => void; onSettings: () => void; onWallet: () => void }) {
  const [user] = useState<AuthUser | null>(getStoredUser())
  const [stats, setStats] = useState<DriverStats | null>(null)
  const [profile, setProfile] = useState<any>(null)
  const [vehicle, setVehicle] = useState<any>(null)
  const [balance, setBalance] = useState(0)
  const [docs, setDocs] = useState<DocRow[]>([])
  const [docsError, setDocsError] = useState('')
  const [showDocs, setShowDocs] = useState(false)

  // Same endpoints the React Native driver app calls on its Account screen.
  useEffect(() => {
    getDriverStats().then(setStats).catch(() => { })
    // /api/drivers/profile is the call the native app makes; it returns
    // { profile: {...} | null }. The user's name comes from the sync response
    // cached at login (<- the live server has no /api/users/me), exactly like
    // the native app caches dbUser.full_name.
    const cached = getStoredProfileInfo()
    setProfile(cached)
    getMyProfile()
      .then((p) => setVehicle(p))
      .catch(() => { })
    // Money available — the week's net, from /api/earnings.
    getWalletBalance().then((d) => setBalance(Number(d?.total_earnings) || 0)).catch(() => { })
    // Pull every document already on file for this driver (same endpoint the
    // native app uses, so anything uploaded there shows up here).
    getMyDocuments()
      .then((d) => setDocs(d?.documents || []))
      .catch((e: any) => setDocsError(`Could not load your documents: ${e?.message || 'unknown error'}`))
  }, [])

  // Confirmed against the LIVE server: the driver profile carries
  // `verification_status` (there is no `is_verified` column on driver_profiles).
  const verifiedStatus = String(vehicle?.verification_status || '').toLowerCase()
  const isVerified = ['verified', 'approved', 'active', 'complete'].includes(verifiedStatus)

  // Name from the sync row cached at login (the live server has no /api/users/me),
  // falling back to the email prefix — the same fallback the native app uses.
  const displayName = profile?.full_name
    ? String(profile.full_name)
    : (user?.email || 'Driver').split('@')[0].replace(/[._]/g, ' ')
  return (
    <div className="flex flex-col h-screen bg-[#F7F7F7]">
      <div className="pt-14 px-5 pb-4 bg-white border-b border-[#F2F2F2] flex items-center justify-between">
        <h1 className="text-[22px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Account</h1>
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        {/* Profile */}
        <div className="mx-4 mt-4 bg-white rounded-2xl border border-[#F0F0F0] px-4 py-4 flex items-center gap-3 shadow-sm mb-3">
          <Avatar name={displayName} size={52} bg="#EA4335" />
          <div className="flex-1">
            <p className="text-[16px] font-bold text-[#1A1A1A] capitalize">{displayName}</p>
            <p className="text-[13px] text-[#ADADAD] mt-0.5">{user?.email || 'Not signed in'}</p>
          </div>
          <button onClick={() => setShowDocs(true)} className="w-8 h-8 rounded-full border border-[#EBEBEB] flex items-center justify-center">
            {IC.chevRight()}
          </button>
        </div>

        {/* Stats */}
        {/* Stats — Rating, Trips and Money, all from the DB:
            Rating -> /api/drivers/stats rating.average
            Trips  -> /api/drivers/stats allTime.rides (opens trip history)
            Money  -> /api/earnings week net (opening balance) */}
        <div className="mx-4 grid grid-cols-3 gap-2.5 mb-3">
          {[
            { l: 'Rating', v: stats && Number(stats.rating?.average) > 0 ? Number(stats.rating.average).toFixed(2) : (vehicle && Number(vehicle.rating_avg) > 0 ? Number(vehicle.rating_avg).toFixed(2) : 'New'), go: undefined },
            { l: 'Trips', v: String(stats?.allTime?.rides ?? vehicle?.total_rides ?? 0), go: onTrips },
            { l: 'Money', v: formatRand(balance), go: undefined },
          ].map(s => (
            <button
              key={s.l}
              onClick={s.go}
              disabled={!s.go}
              className="bg-white rounded-2xl border border-[#F0F0F0] py-3.5 px-3 text-center shadow-sm active:bg-[#F7F7F7] disabled:opacity-100"
            >
              <p className="text-[18px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>{s.v}</p>
              <p className="text-[10px] text-[#ADADAD] mt-0.5 font-semibold leading-tight">{s.l}</p>
            </button>
          ))}
        </div>

        {/* Vehicle */}
        <div className="mx-4 mb-3 bg-white rounded-2xl border border-[#F0F0F0] px-4 py-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-[#ADADAD] uppercase tracking-widest font-semibold mb-1">Your vehicle</p>
              <p className="text-[15px] text-[#1A1A1A] font-bold">{vehicle ? ([vehicle.vehicle_make, vehicle.vehicle_model].filter(Boolean).join(' ') || 'Vehicle on file') : 'No vehicle linked'}</p>
              <p className="text-[13px] text-[#ADADAD] mt-0.5">{[vehicle?.vehicle_year, vehicle?.vehicle_color].filter(Boolean).join('\u00B7') || 'Add your car details'}</p>
            </div>
            <div className="text-right">
              <p className="text-[14px] font-bold text-[#6B6B6B]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{vehicle?.license_plate || 'No plate'}</p>
              <div className="flex items-center gap-1 justify-end mt-1">
                <div className={`w-1.5 h-1.5 rounded-full ${isVerified ? 'bg-[#34A853]' : 'bg-[#FBBC04]'}`} />
                <span className={`text-[11px] font-semibold ${isVerified ? 'text-[#34A853]' : 'text-[#B06000]'}`}>
                  {isVerified ? 'Verified' : (verifiedStatus ? verifiedStatus.replace(/_/g, ' ') : 'Pending review')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Documents ??? ONE button that opens Link your car + Profile, as the old app did */}
        <div className="bg-white mx-4 mt-3 rounded-2xl border border-[#F0F0F0] overflow-hidden shadow-sm">
          <p className="text-[10px] uppercase tracking-widest text-[#ADADAD] font-semibold px-4 pt-3.5 pb-1.5">Documents</p>
          <button onClick={() => setShowDocs((v) => !v)} className="w-full flex items-center justify-between px-4 py-3.5 border-t border-[#F5F5F5] active:bg-[#F7F7F7]">
            <div className="text-left">
              <span className="text-[14px] text-[#1A1A1A]">Documents &amp; vehicle</span>
              <p className="text-[11px] text-[#ADADAD] mt-0.5">
                {vehicle ? ([vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle linked') : 'Link your car, licence, insurance'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-[#34A853] font-semibold">???</span>
              {IC.chevRight()}
            </div>
          </button>
          {showDocs && (
            <div className="border-t border-[#F5F5F5]">
              {/* Link your car — opens the vehicle + document upload screen. */}
              <button
                onClick={onLinkCar}
                className="w-full flex items-center justify-between px-4 py-3 border-b border-[#F5F5F5] active:bg-[#F7F7F7]"
              >
                <div className="text-left">
                  <span className="text-[13px] text-[#1A1A1A]">Link your car</span>
                  <p className="text-[11px] text-[#ADADAD] mt-0.5">
                    {vehicle ? ([vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle on file') : 'Add your car and upload documents'}
                  </p>
                </div>
                {IC.chevRight()}
              </button>

              {/* Real documents pulled from GET /api/documents/mine — anything
                  uploaded in the native app appears here with its real file name
                  and review status. */}
              {docs.length === 0 ? (
                <p className="px-4 py-3 text-[11px] text-[#ADADAD]">
                  {docsError || 'No documents on file yet.'}
                </p>
              ) : (
                docs.map((d) => (
                  <div key={d.id} className="w-full flex items-center justify-between px-4 py-3 border-b border-[#F5F5F5]">
                    <div className="text-left flex-1 pr-3">
                      <span className="text-[13px] text-[#1A1A1A]">{DOC_LABELS[d.doc_type] || d.doc_type}</span>
                      <p className="text-[11px] text-[#ADADAD] mt-0.5" style={{ wordBreak: 'break-all' }}>{d.file_name}</p>
                    </div>
                    <span className={`text-[11px] font-semibold ${d.status === 'approved' ? 'text-[#34A853]' : d.status === 'rejected' ? 'text-[#EA4335]' : 'text-[#FBBC04]'}`}>
                      {d.status === 'approved' ? '✓ Verified' : d.status}
                    </span>
                  </div>
                ))
              )}

              {/* Profile */}
              <div className="flex items-center gap-3 px-4 py-3 border-t border-[#F5F5F5]">
                <Avatar name={displayName} size={34} bg="#EA4335" />
                <div className="flex-1">
                  <p className="text-[13px] text-[#1A1A1A] capitalize">{displayName}</p>
                  <p className="text-[11px] text-[#ADADAD] mt-0.5">{user?.email || 'Not signed in'}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Payments and Withdrawals — card earnings, payout account, history. */}
        <div className="bg-white mx-4 mt-3 rounded-2xl border border-[#F0F0F0] overflow-hidden shadow-sm">
          <button onClick={onWallet} className="w-full flex items-center justify-between px-4 py-3.5 active:bg-[#F7F7F7]">
            <div className="text-left">
              <span className="text-[14px] text-[#1A1A1A] font-semibold">Payments and Withdrawals</span>
              <p className="text-[11px] text-[#ADADAD] mt-0.5">Card earnings, bank account and payouts</p>
            </div>
            {IC.chevRight()}
          </button>
        </div>

        {/* Settings — Waze Navigation, Bank Account, Help Center, Report an Issue
          all live behind this one button, as requested. */}
        <div className="bg-white mx-4 mt-3 rounded-2xl border border-[#F0F0F0] overflow-hidden shadow-sm">
          <button onClick={onSettings} className="w-full flex items-center justify-between px-4 py-3.5 active:bg-[#F7F7F7]">
            <div className="text-left">
              <span className="text-[14px] text-[#1A1A1A] font-semibold">Settings</span>
              <p className="text-[11px] text-[#ADADAD] mt-0.5">Navigation, bank account and support</p>
            </div>
            {IC.chevRight()}
          </button>
        </div>

        {/* Payments + Support moved into Settings. The old card that held
          "Weekly Payout" and "Tax Documents" has been removed entirely. */}

        <div className="mx-4 mt-3 mb-6">
          <button onClick={() => { signOut(); window.location.reload() }} className="w-full border border-[#EBEBEB] text-[#EA4335] font-semibold text-[14px] py-4 rounded-2xl active:bg-[#FEF0EF] transition-colors">
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

// ????????? Auth screens ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
type AuthScreen = 'splash' | 'login' | 'signup' | 'verify'

function Splash({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Map hero */}
      <div className="relative flex-[1.1]">
        <MapCanvas />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white" />
      </div>

      <div className="px-6 pb-12 flex flex-col gap-4 -mt-8 relative z-10">
        {/* Logo */}
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-9 h-9 rounded-xl bg-[#EA4335] flex items-center justify-center shadow-md shadow-[#EA4335]/30">
            {IC.car('#fff')}
          </div>
          <span className="text-[22px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Ridely</span>
        </div>

        <h1 className="text-[30px] font-bold text-[#1A1A1A] leading-tight" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
          Your ride,<br />your way.
        </h1>
        <p className="text-[15px] text-[#ADADAD] leading-relaxed -mt-1">
          Fast, reliable rides across the city. Get started in seconds.
        </p>

        <button onClick={onSignup}
          className="w-full bg-[#EA4335] text-white font-bold text-[16px] py-4 rounded-2xl mt-2 active:bg-[#C5221F] transition-colors"
          style={{ boxShadow: '0 4px 16px rgba(234,67,53,0.28)' }}>
          Create account
        </button>
        <button onClick={onLogin}
          className="w-full bg-[#F7F7F7] text-[#1A1A1A] font-bold text-[16px] py-4 rounded-2xl border border-[#EBEBEB] active:bg-[#F0F0F0] transition-colors">
          Log in
        </button>

        <p className="text-center text-[12px] text-[#C4C4C4] mt-1">
          By continuing you agree to our{' '}
          <span className="text-[#6B6B6B] underline underline-offset-2">Terms</span>{' '}and{' '}
          <span className="text-[#6B6B6B] underline underline-offset-2">Privacy Policy</span>
        </p>
      </div>
    </div>
  )
}

function SocialBtn({ icon, label, onClick }: { icon: string; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick}
      className="flex-1 flex items-center justify-center gap-2.5 bg-[#F7F7F7] border border-[#EBEBEB] rounded-2xl py-3.5 active:bg-[#F0F0F0] transition-colors">
      <span className="text-[18px]">{icon}</span>
      <span className="text-[13px] font-semibold text-[#1A1A1A]">{label}</span>
    </button>
  )
}

function InputField({
  label, type = 'text', placeholder, value, onChange, hint, right
}: {
  label: string; type?: string; placeholder: string; value: string;
  onChange: (v: string) => void; hint?: string; right?: React.ReactNode
}) {
  const [show, setShow] = useState(false)
  const isPassword = type === 'password'
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-semibold text-[#6B6B6B] uppercase tracking-wider">{label}</label>
      <div className="flex items-center bg-[#F7F7F7] border border-[#EBEBEB] rounded-2xl px-4 focus-within:border-[#EA4335] focus-within:bg-white transition-all">
        <input
          type={isPassword && !show ? 'password' : 'text'}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="flex-1 bg-transparent py-3.5 text-[14px] text-[#1A1A1A] outline-none placeholder:text-[#C4C4C4]"
          style={{ fontFamily: 'Inter, sans-serif' }}
        />
        {isPassword && (
          <button type="button" onClick={() => setShow(s => !s)} className="ml-2 text-[12px] text-[#ADADAD] font-semibold select-none">
            {show ? 'Hide' : 'Show'}
          </button>
        )}
        {right && <div className="ml-2">{right}</div>}
      </div>
      {hint && <p className="text-[11px] text-[#ADADAD] px-1">{hint}</p>}
    </div>
  )
}

function LoginScreen({ onBack, onSuccess, onSignup }: { onBack: () => void; onSuccess: () => void; onSignup: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Real Firebase sign-in (same project the React Native driver app uses).
  // On success the idToken is stored and every apiFetch call is authenticated
  // with it ??? exactly what the server expects.
  async function handleSubmit() {
    if (!email || !password) return
    setLoading(true)
    setError('')
    try {
      await signIn(email, password)
      onSuccess()
    } catch (e: any) {
      setError(e?.message || 'Could not log in')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-white overflow-y-auto">
      {/* Header */}
      <div className="px-5 pt-14 pb-6 flex items-center gap-4">
        <button onClick={onBack} className="w-10 h-10 rounded-full border border-[#EBEBEB] flex items-center justify-center active:bg-[#F7F7F7]">
          {IC.chevLeft()}
        </button>
        <div>
          <h1 className="text-[22px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>Welcome back</h1>
          <p className="text-[13px] text-[#ADADAD] mt-0.5">Log in to your account</p>
        </div>
      </div>

      <div className="flex-1 px-5 flex flex-col gap-5">
        {/* Social logins */}
        <div className="flex gap-3">
          <SocialBtn icon="G" label="Google" onClick={onSuccess} />
          <SocialBtn icon="f" label="Facebook" onClick={onSuccess} />
          <SocialBtn icon="????" label="Apple" onClick={onSuccess} />
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-[#F0F0F0]" />
          <span className="text-[12px] text-[#C4C4C4] font-medium">or continue with email</span>
          <div className="flex-1 h-px bg-[#F0F0F0]" />
        </div>

        {/* Fields */}
        <InputField label="Email address" type="email" placeholder="you@example.com" value={email} onChange={setEmail} />
        <div>
          <InputField label="Password" type="password" placeholder="Your password" value={password} onChange={setPassword} />
          <button className="mt-2 text-[12px] text-[#EA4335] font-semibold ml-1">Forgot password?</button>
        </div>

        {error && (
          <div className="rounded-2xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3">
            <p className="text-[12px] text-[#C5221F] font-semibold">{error}</p>
          </div>
        )}

        {/* Submit */}
        <button onClick={handleSubmit} disabled={loading || !email || !password}
          className={`w-full font-bold text-[16px] py-4 rounded-2xl transition-all mt-1 ${email && password ? 'bg-[#EA4335] text-white active:bg-[#C5221F]' : 'bg-[#F7F7F7] text-[#C4C4C4] border border-[#EBEBEB]'}`}
          style={email && password ? { boxShadow: '0 4px 16px rgba(234,67,53,0.24)' } : {}}>
          {loading ? 'Logging in???' : 'Log in'}
        </button>
      </div>

      <p className="text-center text-[13px] text-[#ADADAD] py-8">
        Don't have an account?{' '}
        <button onClick={onSignup} className="text-[#EA4335] font-semibold">Sign up</button>
      </p>
    </div>
  )
}

function SignupScreen({ onBack, onSuccess, onLogin }: { onBack: () => void; onSuccess: () => void; onLogin: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [code, setCode] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailFailed, setEmailFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Country code selector — the native signup defaults to +27 (South Africa)
  // and lets the driver choose any country from the full ~240-country list.
  const [countryCode, setCountryCode] = useState('+27')

  // Four steps, mirroring the React Native driver signup: email, then
  // phone+password, then the 6-digit verification code (emailed via Resend),
  // then first/last name. The code is generated on the device and compared
  // locally ??? exactly what the native signup does.
  async function handleNext() {
    if (step === 1) {
      if (!firstName || !email) return
      setError('')
      setStep(2)
      return
    }
    if (step === 2) {
      if (!phone || !password) return
      const newCode = String(Math.floor(100000 + Math.random() * 900000))
      setCode(newCode)
      setOtp('')
      setError('')
      // Email the code via the same Resend endpoint the native signup uses. If
      // delivery fails we fall back to showing the code on screen — exactly the
      // native app's behaviour.
      setSendingEmail(true)
      const sent = await sendVerificationEmail(email.trim(), newCode)
      setEmailFailed(!sent.success)
      setSendingEmail(false)
      setStep(3)
      return
    }
    // Step 3 ??? verify, then create the Firebase account.
    if (otp !== code) {
      setError(otp ? 'Invalid verification code. Please try again.' : 'Enter the 6-digit code.')
      return
    }
    setLoading(true)
    setError('')
    try {
      // Identical to the native app's register() call:
      //   full_name as ONE string, phone as countryCode + digits (spaces removed),
      //   role "driver" — all sent to POST /api/users/sync by signUp().
      await signUp(email.trim(), password, {
        fullName: `${firstName.trim()} ${lastName.trim()}`,
        phone: `${countryCode}${phone.replace(/\s/g, '')}`,
      })
      onSuccess()
    } catch (e: any) {
      setError(e?.message || 'Could not create the account')
    } finally {
      setLoading(false)
    }
  }

  const canNext =
    step === 1
      ? (firstName.length > 0 && email.includes('@'))
      : step === 2
        ? (phone.length >= 8 && password.length >= 6)
        : otp.length === 6

  return (
    <div className="flex flex-col h-screen bg-white overflow-y-auto">
      {/* Header */}
      <div className="px-5 pt-14 pb-6 flex items-center gap-4">
        <button onClick={step === 2 ? () => setStep(1) : onBack} className="w-10 h-10 rounded-full border border-[#EBEBEB] flex items-center justify-center active:bg-[#F7F7F7]">
          {IC.chevLeft()}
        </button>
        <div className="flex-1">
          <h1 className="text-[22px] font-bold text-[#1A1A1A]" style={{ fontFamily: 'Space Grotesk, sans-serif' }}>
            {step === 1 ? 'Create account' : 'Almost there'}
          </h1>
          <p className="text-[13px] text-[#ADADAD] mt-0.5">
            {step === 1 ? 'Tell us who you are' : 'Set up your contact & password'}
          </p>
        </div>
        {/* Step indicator */}
        <div className="flex gap-1.5">
          <div className="w-6 h-1.5 rounded-full bg-[#EA4335]" />
          <div className={`w-6 h-1.5 rounded-full ${step === 2 ? 'bg-[#EA4335]' : 'bg-[#F0F0F0]'}`} />
        </div>
      </div>

      <div className="flex-1 px-5 flex flex-col gap-5">
        {step === 1 ? (<>
          {/* Social quick signup */}
          <div className="flex gap-3">
            <SocialBtn icon="G" label="Google" onClick={onSuccess} />
            <SocialBtn icon="f" label="Facebook" onClick={onSuccess} />
            <SocialBtn icon="????" label="Apple" onClick={onSuccess} />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[#F0F0F0]" />
            <span className="text-[12px] text-[#C4C4C4] font-medium">or with email</span>
            <div className="flex-1 h-px bg-[#F0F0F0]" />
          </div>
          <InputField label="First name" placeholder="Alex" value={firstName} onChange={setFirstName} />
          <InputField label="Last name" placeholder="Johnson" value={lastName} onChange={setLastName} />
          <InputField label="Email address" type="email" placeholder="you@example.com" value={email} onChange={setEmail} />
        </>) : step === 2 ? (<>
          {/* Country code selector + phone number, exactly like the native
              signup (CountrySelect sits to the left of the number). */}
          <div>
            <label className="block text-[12px] font-medium text-[#4A4A4A] mb-1.5 ml-1">Phone number</label>
            <div className="flex items-start gap-2">
              <CountrySelect value={countryCode} onChange={setCountryCode} />
              <input
                type="tel"
                inputMode="tel"
                placeholder="82 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="flex-1 h-11 rounded-xl bg-[#F7F7F7] border border-[#EBEBEB] px-4 text-[14px] text-[#1A1A1A] outline-none focus:border-[#EA4335] placeholder:text-[#C4C4C4]"
              />
            </div>
            <p className="text-[11px] text-[#ADADAD] mt-1.5 ml-1">
              We'll send a verification code to confirm your number
            </p>
          </div>
          <InputField
            label="Password"
            type="password"
            placeholder="At least 8 characters"
            value={password}
            onChange={setPassword}
            hint="Use a mix of letters, numbers and symbols"
          />

          {/* Password strength */}
          {password.length > 0 && (
            <div className="flex gap-1.5 -mt-2">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="flex-1 h-1 rounded-full transition-all"
                  style={{ background: password.length >= i * 3 ? (password.length >= 10 ? '#34A853' : '#FBBC04') : '#F0F0F0' }} />
              ))}
              <span className="text-[11px] text-[#ADADAD] ml-1 self-center">
                {password.length < 4 ? 'Weak' : password.length < 8 ? 'Fair' : password.length < 10 ? 'Good' : 'Strong'}
              </span>
            </div>
          )}

          {/* T&C */}
          <div className="flex items-start gap-3 bg-[#F7F7F7] rounded-2xl px-4 py-3.5 border border-[#EBEBEB]">
            <div className="w-4 h-4 rounded-[5px] bg-[#EA4335] flex items-center justify-center shrink-0 mt-0.5">
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <p className="text-[12px] text-[#6B6B6B] leading-relaxed">
              I agree to the{' '}
              <span className="text-[#EA4335] font-semibold">Terms of Service</span>{' '}and{' '}
              <span className="text-[#EA4335] font-semibold">Privacy Policy</span>
            </p>
          </div>
        </>) : (
          <>
            {/* The code is only shown on screen when email delivery failed — the
                native app does the same. Otherwise the rider reads it from their
                inbox. */}
            {emailFailed ? (
              <div className="rounded-2xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-4">
                <p className="text-[11px] uppercase tracking-widest text-[#C5221F] font-semibold mb-2">Email unavailable — your code</p>
                <p className="text-[24px] font-bold text-[#1A1A1A] tracking-[0.3em]" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{code}</p>
                <button onClick={() => setOtp(code)} className="mt-2 w-full rounded-xl bg-[#FCE8E6] py-2 text-[12px] font-semibold text-[#C5221F]">
                  Tap to auto-fill code
                </button>
              </div>
            ) : (
              <div className="rounded-2xl bg-[#F7F7F7] border border-[#EBEBEB] px-4 py-4">
                <p className="text-[16px] font-semibold text-[#1A1A1A]">Check your email</p>
                <p className="text-[12px] text-[#ADADAD] mt-1">
                  We sent a 6-digit code to {email.trim()}. Enter it below.
                  {sendingEmail ? ' Sending…' : ''}
                </p>
              </div>
            )}
            <InputField label="Verification code" placeholder="000000" value={otp} onChange={(t: string) => setOtp(t.replace(/\D/g, '').slice(0, 6))} />
          </>
        )}

        {error && (
          <div className="rounded-2xl bg-[#FCE8E6] border border-[#F5C6C2] px-4 py-3">
            <p className="text-[12px] text-[#C5221F] font-semibold">{error}</p>
          </div>
        )}

        <button onClick={handleNext} disabled={!canNext || loading}
          className={`w-full font-bold text-[16px] py-4 rounded-2xl transition-all ${canNext ? 'bg-[#EA4335] text-white active:bg-[#C5221F]' : 'bg-[#F7F7F7] text-[#C4C4C4] border border-[#EBEBEB]'}`}
          style={canNext ? { boxShadow: '0 4px 16px rgba(234,67,53,0.24)' } : {}}>
          {loading ? 'Creating account...' : step === 1 ? 'Continue' : step === 2 ? 'Send code' : 'Create account'}
        </button>
      </div>

      <p className="text-center text-[13px] text-[#ADADAD] py-8">
        Already have an account?{' '}
        <button onClick={onLogin} className="text-[#EA4335] font-semibold">Log in</button>
      </p>
    </div>
  )
}

// ????????? Root ???????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????
export default function App() {
  const [auth, setAuth] = useState<AuthScreen>('splash')
  // Restore an existing Firebase session so the driver isn't asked to log in on
  // every launch ??? lib/backend persists the idToken in localStorage.
  const [authed, setAuthed] = useState(() => !!getStoredUser())
  // A stored session is NOT the same as a working one. Verify it on launch and,
  // if it can't be renewed, drop it and send the driver to the login screen —
  // otherwise every list (documents, earnings, trips) silently comes back empty.
  const [checkingSession, setCheckingSession] = useState(() => !!getStoredUser())

  useEffect(() => {
    let alive = true
    ensureSession()
      .then((ok) => {
        if (!alive) return
        if (!ok) {
          signOut()
          setAuthed(false)
          setAuth('login')
        }
      })
      .finally(() => alive && setCheckingSession(false))
    return () => { alive = false }
  }, [])

  // This is the RIDER app, so it opens in rider mode.
  const [mode, setMode] = useState<AppMode>('rider')
  // The tier chosen on the booking screen, sent with the ride request.
  const [tier, setTier] = useState('go')
  // Chosen on the booking screen and carried into the request: how the rider pays
  // ('cash' | 'card') and any stops added before confirming.
  const [payMethod, setPayMethod] = useState('cash')
  const [rideStops, setRideStops] = useState<Waypoint[]>([])
  // The id of the ride the server created, used to track / cancel / rate it.
  const [rideId, setRideId] = useState<string | null>(null)
  const [rScreen, setRScreen] = useState<RiderScreen>('home')

    // ── Trip continuity: launch, resume and reconnect all rebuild from the DB ──
    // The server is the source of truth, not the screen we happened to be on.
    // Swiping the app away — or Android killing it — mid-trip must never dump the
    // rider back on Home while a ride is still running, so on every cold start,
    // every return to the foreground and every reconnect we ask what this rider is
    // actually doing and jump straight to that ride.
    useEffect(() => {
      if (!authed) return
      let alive = true
      const ACTIVE = ['searching', 'accepted', 'driver_arrived', 'in_progress']
      const restore = async () => {
        try {
          const active: any = await getActiveRide()
          if (!alive || !active?.id) return
          if (!ACTIVE.includes(String(active.status || ''))) return
          setRideId(String(active.id))
          if (active.destination_address) setDest(String(active.destination_address))
          setRScreen('ride') // RideScreen re-reads the whole ride from this id
        } catch { /* offline — stay wherever we are */ }
      }
      void restore()
      const onVisible = () => { if (document.visibilityState === 'visible') void restore() }
      document.addEventListener('visibilitychange', onVisible)
      window.addEventListener('vura:reconnect', onVisible)
      return () => {
        alive = false
        document.removeEventListener('visibilitychange', onVisible)
        window.removeEventListener('vura:reconnect', onVisible)
      }
    }, [authed])

    // Push: register this phone so ride events reach it even while the app is
    // backgrounded or closed (a live socket cannot be relied on there).
    useEffect(() => {
      if (!authed) return
      void initPushNotifications()
    }, [authed])

  const [rNav, setRNav] = useState<RiderScreen>('home')
  const [dScreen, setDScreen] = useState<DriverScreen>('driverHome')
  const [dNav, setDNav] = useState<DriverScreen>('driverHome')
  const [dest, setDest] = useState('')
  // Live ride request pushed over the socket, handed to the RideRequest screen.
  const [req, setReq] = useState<RideRequestData | null>(null)

  function switchMode(m: AppMode) { setMode(m) }
  function riderGo(s: RiderScreen) { setRNav(s); setRScreen(s) }
  function driverGo(s: DriverScreen) { setDNav(s); setDScreen(s) }
  function book(d: string) { setDest(d || 'Google HQ'); setRScreen('booking') }

  const riderNav = rScreen === 'home' || rScreen === 'activity' || rScreen === 'account'
  const driverNav = dScreen === 'driverHome' || dScreen === 'earnings' || dScreen === 'driverAccount'

  return (
    <div className="max-w-sm mx-auto relative min-h-screen overflow-hidden" style={{ boxShadow: '0 0 0 1px #E0E0E0' }}>
      {/* ?????? Auth flow ?????? */}
      {!authed && (<>
        {checkingSession ? (
          <div className="h-screen flex flex-col items-center justify-center bg-white gap-3">
            <div className="w-9 h-9 rounded-full border-[3px] border-[#F0F0F0] border-t-[#EA4335] animate-spin" />
            <p className="text-[13px] text-[#ADADAD]">Restoring your session…</p>
          </div>
        ) : auth === 'splash' && (
          <Splash
            onLogin={() => setAuth('login')}
            onSignup={() => setAuth('signup')}
          />
        )}
        {auth === 'login' && (
          <LoginScreen
            onBack={() => setAuth('splash')}
            onSuccess={() => setAuthed(true)}
            onSignup={() => setAuth('signup')}
          />
        )}
        {auth === 'signup' && (
          <SignupScreen
            onBack={() => setAuth('splash')}
            onSuccess={() => setAuthed(true)}
            onLogin={() => setAuth('login')}
          />
        )}
      </>)}

      {/* ?????? App flow ?????? */}
      {authed && (<>
        {mode === 'rider' && (<>
          {rScreen === 'home' && <RiderHome onBook={book} mode={mode} onMode={switchMode} />}
          {rScreen === 'booking' && (
            <BookingScreen
              destination={dest}
              onBack={() => setRScreen('home')}
              onTier={setTier}
              onConfirm={(t, pm, st) => {
                setTier(t)
                setPayMethod(pm)
                setRideStops(st)
                setRScreen('matching')
              }}
            />
          )}
          {rScreen === 'matching' && (
            <MatchingScreen
              destination={dest}
              tier={tier}
              paymentMethod={payMethod}
              stops={rideStops}
              onCancel={() => { setRideId(null); setRScreen('home') }}
              onMatched={(id) => { setRideId(id); setRScreen('ride') }}
            />
          )}
          {rScreen === 'ride' && (
            <RideScreen
              destination={dest}
              rideId={rideId}
              onDone={() => { setRideId(null); setRScreen('home'); setRNav('home') }}
            />
          )}
          {rScreen === 'activity' && <RiderActivity />}
          {rScreen === 'account' && <RiderAccount mode={mode} onMode={switchMode} onSignOut={() => { signOut(); setAuthed(false); setAuth('login') }} onNotifications={() => setRScreen('notifications')} open={setRScreen} />}
          {rScreen === 'notifications' && <RiderNotifications onBack={() => setRScreen('account')} />}
          {rScreen === 'settings' && (
            <RiderSettings
              onBack={() => setRScreen('account')}
              onProfile={() => setRScreen('profile')}
              onPayments={() => setRScreen('payments')}
              onPromos={() => setRScreen('promos')}
              onSafety={() => setRScreen('safety')}
              onNotifications={() => setRScreen('notifications')}
              onHelp={() => setRScreen('help')}
              onReport={() => setRScreen('report')}
              onGuidelines={() => setRScreen('guidelines')}
            />
          )}
          {rScreen === 'profile' && <RiderProfile onBack={() => setRScreen('account')} />}
          {rScreen === 'payments' && <PaymentMethods onBack={() => setRScreen('account')} />}
          {rScreen === 'promos' && <PromosScreen onBack={() => setRScreen('account')} />}
          {rScreen === 'safety' && <SafetyScreen onBack={() => setRScreen('account')} onReportIssue={() => setRScreen('report')} />}
          {rScreen === 'guidelines' && <Guidelines onBack={() => setRScreen('account')} />}
          {rScreen === 'help' && <HelpCenter onBack={() => setRScreen('account')} onTrips={() => setRScreen('activity')} recentTrip={null} />}
          {rScreen === 'report' && <ReportIssue onBack={() => setRScreen('account')} />}
          {/* Keep the bottom nav visible on the rider tabs only. */}
          {riderNav && <RiderNav active={rNav} go={riderGo} />}
        </>)}

        {mode === 'driver' && (<>
          {dScreen === 'driverHome' && <DriverHome onRequest={(r: RideRequestData) => { setReq(r); setDScreen('request') }} mode={mode} onMode={switchMode} />}
          {dScreen === 'request' && (
            <RideRequest
              request={req}
              onAccept={async () => {
                // Same socket event the React Native app emits.
                if (req?.id) await acceptRide(req.id).catch(() => { })
                setDScreen('pickup')
              }}
              onDecline={async () => {
                if (req?.id) await declineRide(req.id).catch(() => { })
                setReq(null)
                setDScreen('driverHome')
              }}
            />
          )}
          {dScreen === 'pickup' && (
            <DriverPickup
              request={req}
              onArrived={async () => {
                // Same event the native app emits ??? tells the rider you arrived.
                if (req?.id) await startTrip(req.id).catch(() => { })
                setDScreen('dropoff')
              }}
            />
          )}
          {dScreen === 'dropoff' && (
            <DriverDropoff
              request={req}
              onComplete={async () => {
                if (req?.id) await completeTrip(req.id).catch(() => { })
                setDScreen('complete')
              }}
            />
          )}
          {dScreen === 'complete' && <TripComplete request={req} onDone={() => { setDScreen('driverHome'); setDNav('driverHome') }} />}
          {dScreen === 'earnings' && <Earnings />}
          {dScreen === 'driverAccount' && <DriverAccount mode={mode} onMode={switchMode} onLinkCar={() => setDScreen('vehicle')} onTrips={() => setDScreen('tripHistory')} onSettings={() => setDScreen('settings')} onWallet={() => setDScreen('wallet')} />}
          {dScreen === 'vehicle' && <VehicleLinkScreen onBack={() => setDScreen('driverAccount')} />}
          {dScreen === 'tripHistory' && <TripHistory onBack={() => setDScreen('driverAccount')} />}
          {dScreen === 'settings' && (
            <SettingsScreen
              onBack={() => setDScreen('driverAccount')}
              onHelp={() => setDScreen('help')}
              onReport={() => setDScreen('report')}
              onWallet={() => setDScreen('wallet')}
            />
          )}
          {dScreen === 'help' && (
            <HelpCenter onBack={() => setDScreen('settings')} onTrips={() => setDScreen('tripHistory')} />
          )}
          {dScreen === 'report' && <ReportIssue onBack={() => setDScreen('settings')} rideId={req?.id} />}
          {dScreen === 'wallet' && <WalletScreen onBack={() => setDScreen('driverAccount')} />}
          {driverNav && <DriverNav active={dNav} go={driverGo} />}
        </>)}
      </>)}
    </div>
  )
}

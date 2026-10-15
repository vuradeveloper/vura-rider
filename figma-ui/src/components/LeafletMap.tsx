import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { reportLeafletLoadFailure } from '../lib/webviewGuard'

// ─────────────────────────────────────────────────────────────────────────────
// Real map for the Figma UI — OpenStreetMap tiles via Leaflet, the SAME mapping
// stack the React Native driver app uses (it renders Leaflet in a WebView).
// Leaflet itself is loaded from /leaflet/leaflet.js, which is copied from the
// native app's public folder, so both apps show identical tiles and pins.
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  interface Window {
    L?: any
  }
}

let leafletPromise: Promise<any> | null = null

function loadLeaflet(): Promise<any> {
  if (window.L) return Promise.resolve(window.L)
  if (leafletPromise) return leafletPromise
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = '/leaflet/leaflet.css'
      link.setAttribute('data-leaflet', '1')
      document.head.appendChild(link)
    }
    const script = document.createElement('script')
    script.src = '/leaflet/leaflet.js'
    script.async = true
    script.onload = () => resolve(window.L)
    script.onerror = () => {
      // Old-WebView legibility: a failed map script must be a readable
      // full-screen message (update WebView), never a silent empty box.
      reject(new Error('Could not load Leaflet'))
      reportLeafletLoadFailure()
    }
    document.head.appendChild(script)
  })
  return leafletPromise
}

export type LatLng = { lat: number; lng: number }

const JOBURG: LatLng = { lat: -26.2041, lng: 28.0473 }

/**
 * Map styling — the WARM "illustrative" look from the reference design: cream
 * base, beige-tinted streets and the white/red car pin. Applied to every map in
 * the APK (driver + rider) so they stay identical, the way the old apps shared
 * one rule. Tiles keep their localStorage cache — the tint is pure CSS, so no
 * tile is ever re-downloaded for a style change.
 *
 *   .leaflet-container{background:#F3ECE2}
 *   .tile-grayscale{filter:sepia(0.5) saturate(1.35) hue-rotate(-14deg) …}
 *   tile URL: https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png  (subdomains abc)
 */
const MAP_STYLE_ID = 'vura-map-style'
function ensureMapStyle() {
  if (document.getElementById(MAP_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = MAP_STYLE_ID
  style.textContent = [
    '.leaflet-container{background:#F3ECE2}',
    '.tile-grayscale{filter:sepia(0.5) saturate(1.35) hue-rotate(-14deg) brightness(1.05) contrast(0.94)}',
    '.vura-car-pin-wrap{background:transparent!important;border:0!important}',
    '.vura-car-pin{width:46px;height:46px;border-radius:50%;background:#fff;border:2px solid rgba(234,67,53,0.55);box-shadow:0 3px 10px rgba(0,0,0,0.22);display:flex;align-items:center;justify-content:center}',
  ].join('\n')
  document.head.appendChild(style)
}

/**
 * The driver's pin, exactly as the reference map draws it: a top-view car in a
 * white circle with a soft red ring. Replaces the old red dot on EVERY map in
 * the app (follow-position, explicit markers and the locate button all route
 * through it), so rider and driver stay consistent.
 */
function carPinIcon(L: any) {
  return L.divIcon({
    className: 'vura-car-pin-wrap',
    iconSize: [46, 46],
    iconAnchor: [23, 23],
    html: `<div class="vura-car-pin"><svg viewBox="0 0 40 40" width="26" height="26" aria-hidden="true">
      <rect x="10" y="4" width="20" height="32" rx="8.5" fill="#262626"/>
      <path d="M13 11.5 C17 8.8 23 8.8 27 11.5 L25.6 16.6 C23 15.2 17 15.2 14.4 16.6 Z" fill="#D8E2EC"/>
      <path d="M14.4 23.4 C17 24.8 23 24.8 25.6 23.4 L27 28.5 C23 31.2 17 31.2 13 28.5 Z" fill="#D8E2EC"/>
      <rect x="13.4" y="19.4" width="13.2" height="1.8" rx="0.9" fill="#0F0F0F"/>
      <circle cx="13.2" cy="6.6" r="1.4" fill="#EAF3FF"/>
      <circle cx="26.8" cy="6.6" r="1.4" fill="#EAF3FF"/>
      <circle cx="13.2" cy="33.4" r="1.4" fill="#E4574C"/>
      <circle cx="26.8" cy="33.4" r="1.4" fill="#E4574C"/>
    </svg></div>`,
  })
}

/**
 * A tile layer that caches tiles in localStorage — ported from the old apps'
 * createCachedTileLayer() in lib/mapHtml.ts.
 *
 * This is what made the old map fast: each tile is fetched once, stored as a
 * data URL under `vura:tile:<url>` and reused afterwards, so repeat maps paint
 * instantly and use far less mobile data. Capped at 250 tiles so it can never
 * fill storage and break other data (recent searches, saved places, auth).
 */
function attachCachedTiles(L: any, map: any) {
  const MAX_TILES = 250

  function storeTile(url: string, dataUrl: string) {
    try {
      let n = 0
      const del: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.indexOf('vura:tile:') === 0) {
          n++
          if (n > MAX_TILES) del.push(k)
        }
      }
      for (const k of del) { try { localStorage.removeItem(k) } catch { /* ignore */ } }
      localStorage.setItem('vura:tile:' + url, dataUrl)
    } catch { /* storage full or unavailable — caching is best-effort */ }
  }

  const CacheLayer = L.TileLayer.extend({
    createTile(coords: any, done: (err: any, tile?: any) => void) {
      const url = this.getTileUrl(coords)
      let cached: string | null = null
      try { cached = localStorage.getItem('vura:tile:' + url) } catch { /* ignore */ }

      const img = document.createElement('img')
      img.style.width = img.style.height = '256px'
      const finish = () => done(null, img)
      const fail = () => done('error', img)

      if (cached) {
        img.onload = finish
        img.onerror = fail
        img.src = cached
        return img
      }

      const xhr = new XMLHttpRequest()
      xhr.open('GET', url, true)
      xhr.responseType = 'blob'
      xhr.onload = () => {
        if (xhr.status !== 200) { fail(); return }
        const fr = new FileReader()
        fr.onload = () => {
          const dataUrl = String(fr.result)
          storeTile(url, dataUrl)
          img.onload = finish
          img.onerror = fail
          img.src = dataUrl
        }
        fr.readAsDataURL(xhr.response)
      }
      xhr.onerror = fail
      xhr.send()
      return img
    },
  })

  return new CacheLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    maxNativeZoom: 19,
    subdomains: 'abc',
    detectRetina: false,
    className: 'tile-grayscale',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map)
}

export default function LeafletMap({
  marker,
  route,
  dark = false,
  zoom = 16,
  className = 'absolute inset-0',
  follow = true,
  controls = false,
  controlsBottom = 12,
}: {
  /** Pin for the driver / focal point. Falls back to live GPS, then Joburg. */
  marker?: LatLng
  /** Optional polyline to draw: pickup → any stops → drop-off. */
  route?: LatLng[]
  dark?: boolean
  zoom?: number
  className?: string
  /** Keep re-centring on the device's live position as the driver moves. */
  follow?: boolean
  /** Show +/− and "my location" buttons over the map. */
  controls?: boolean
  /**
   * How far the map controls sit above the bottom edge, in px. The driver's home
   * screen shows a "Waiting for requests" card pinned to the bottom of the map,
   * so the controls need to clear it instead of colliding with it.
   */
  controlsBottom?: number
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const markerRef = useRef<any>(null)
  const lineRef = useRef<any>(null)
  const accuracyRef = useRef<any>(null)
  // Once the driver pans the map themselves we stop yanking it back to their
  // position on every GPS tick.
  const userMoved = useRef(false)

  useEffect(() => {
    let cancelled = false
    let watchId: number | null = null

    ;(async () => {
      const L = await loadLeaflet().catch(() => null)
      if (!L || cancelled || !hostRef.current) return

      // First run: create the map.
      if (!mapRef.current) {
        ensureMapStyle()

        mapRef.current = L.map(hostRef.current, {
          zoomControl: false,
          attributionControl: false,
          preferCanvas: true,
          // A tighter zoom than before: at 16 the surrounding streets are
          // readable, which is what a driver needs when positioning for a pickup.
          zoomSnap: 0.5,
        }).setView([marker?.lat ?? JOBURG.lat, marker?.lng ?? JOBURG.lng], zoom)

        // Cached OSM tiles with the old apps' grayscale filter — same source,
        // same subdomains and same look as both old APKs.
        attachCachedTiles(L, mapRef.current)

        // NOTE: the grayscale look now comes from the `.tile-grayscale` class on
        // the tiles themselves (exactly as the old apps did), so there is no
        // container-level filter here — adding one would double up the effect and
        // make the map darker than the old APK.

        // Remember if the driver took manual control of the viewport.
        mapRef.current.on('dragstart', () => { userMoved.current = true })
      }

      const map = mapRef.current

      // An explicit marker wins; otherwise follow the device's live position.
      if (marker?.lat != null && marker?.lng != null) {
        drawPin(L, map, marker.lat, marker.lng)
        map.setView([marker.lat, marker.lng], zoom, { animate: true })
        return
      }

      if (!navigator.geolocation) return

      const apply = (lat: number, lng: number, accuracy?: number) => {
        if (cancelled || !mapRef.current) return
        drawPin(L, mapRef.current, lat, lng)
        if (accuracy != null && accuracy > 0) drawAccuracy(L, mapRef.current, lat, lng, accuracy)
        if (follow && !userMoved.current) {
          // Fly to the fix, keeping the current zoom if the driver already
          // pinched; otherwise zoom straight in to `zoom`.
          const z = Math.max(mapRef.current.getZoom(), zoom)
          mapRef.current.setView([lat, lng], z, { animate: true })
        }
      }

      // One immediate fix so the map is never left on the fallback centre...
      navigator.geolocation.getCurrentPosition(
        (p) => apply(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
        () => {},
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      )

      // ...then keep watching, so the pin tracks the driver as they move.
      if (follow) {
        watchId = navigator.geolocation.watchPosition(
          (p) => apply(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
          () => {},
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
        )
      }
    })()

    function drawPin(L: any, map: any, lat: number, lng: number) {
      if (markerRef.current) {
        markerRef.current.setLatLng([lat, lng])
        return
      }
      // The reference design's car pin: white circle, red ring, top-view car.
      markerRef.current = L.marker([lat, lng], { icon: carPinIcon(L), keyboard: false, zIndexOffset: 400 }).addTo(map)
    }

    function drawAccuracy(L: any, map: any, lat: number, lng: number, accuracy: number) {
      if (accuracyRef.current) {
        accuracyRef.current.setLatLng([lat, lng])
        accuracyRef.current.setRadius(accuracy)
        return
      }
      accuracyRef.current = L.circle([lat, lng], {
        radius: accuracy,
        color: '#EA4335',
        weight: 1,
        opacity: 0.35,
        fillColor: '#EA4335',
        fillOpacity: 0.08,
      }).addTo(map)
    }

    return () => {
      cancelled = true
      if (watchId != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marker?.lat, marker?.lng, dark, zoom, follow])

  // Draw / update the route line. The polyline is what the SERVER's routing
  // engine returned via getRoute() (GET /api/route?points=lng,lat;lng,lat), so it
  // bends around the real road network and passes through every stop — it used to
  // be a straight pickup→drop-off segment, and before that nothing at all.
  const routeKey = route && route.length > 1
    ? route.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|')
    : ''
  useEffect(() => {
    ;(async () => {
      const L = await loadLeaflet().catch(() => null)
      const map = mapRef.current
      if (!L || !map) return
      if (lineRef.current) {
        map.removeLayer(lineRef.current)
        lineRef.current = null
      }
      if (!route || route.length < 2) return
      lineRef.current = L.polyline(
        route.map((p) => [p.lat, p.lng]),
        { color: '#EA4335', weight: 4, opacity: 0.9 }
      ).addTo(map)
      // A live GPS fix keeps re-centring; only frame the whole route when the
      // rider is not being followed, otherwise the viewport fights itself.
      if (!follow) map.fitBounds(lineRef.current.getBounds(), { padding: [40, 40] })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, follow])

  return (
    <>
      <div ref={hostRef} className={className} />
      {controls && (
        <div className="absolute right-3 z-[500] flex flex-col gap-1.5" style={{ bottom: controlsBottom }}>
          <MapBtn label="Zoom in" onClick={() => mapRef.current?.zoomIn()}>+</MapBtn>
          <MapBtn label="Zoom out" onClick={() => mapRef.current?.zoomOut()}>−</MapBtn>
          <MapBtn
            label="My location"
            onClick={() => {
              // Hand the viewport back to the driver and snap to their fix.
              userMoved.current = false
              navigator.geolocation?.getCurrentPosition(
                (p) => {
                  const map = mapRef.current
                  if (!map) return
                  drawPinNow(p.coords.latitude, p.coords.longitude)
                  map.setView([p.coords.latitude, p.coords.longitude], Math.max(map.getZoom(), zoom), { animate: true })
                },
                () => {},
                { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
              )
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#EA4335" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3.2" />
              <line x1="12" y1="2" x2="12" y2="6" /><line x1="12" y1="18" x2="12" y2="22" />
              <line x1="2" y1="12" x2="6" y2="12" /><line x1="18" y1="12" x2="22" y2="12" />
            </svg>
          </MapBtn>
        </div>
      )}
    </>
  )

  // Draws/updates the driver pin imperatively (used by the locate button).
  function drawPinNow(lat: number, lng: number) {
    const L = window.L
    const map = mapRef.current
    if (!L || !map) return
    if (markerRef.current) {
      markerRef.current.setLatLng([lat, lng])
      return
    }
    markerRef.current = L.marker([lat, lng], { icon: carPinIcon(L), keyboard: false, zIndexOffset: 400 }).addTo(map)
  }
}

/** Small round map control. */
function MapBtn({
  children, onClick, label,
}: { children: ReactNode; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="w-10 h-10 rounded-2xl bg-white border border-[#EBEBEB] shadow-[0_2px_8px_rgba(0,0,0,0.10)] flex items-center justify-center text-[19px] font-bold text-[#1A1A1A] active:bg-[#F5F5F5]"
    >
      {children}
    </button>
  )
}

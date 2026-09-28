import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

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
    script.onerror = () => reject(new Error('Could not load Leaflet'))
    document.head.appendChild(script)
  })
  return leafletPromise
}

export type LatLng = { lat: number; lng: number }

const JOBURG: LatLng = { lat: -26.2041, lng: 28.0473 }

/**
 * The OLD apps' map styling — copied verbatim from their lib/mapHtml.ts, which
 * is byte-identical between the driver and rider apps. Using the same rules on
 * both means the driver and rider maps look the same.
 *
 *   .leaflet-container{background:#f8f9fa}
 *   .tile-grayscale{filter:grayscale(1) contrast(1.08) brightness(1.02)}
 *   tile URL: https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png  (subdomains abc)
 */
const MAP_STYLE_ID = 'vura-map-style'
function ensureMapStyle() {
  if (document.getElementById(MAP_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = MAP_STYLE_ID
  style.textContent = [
    '.leaflet-container{background:#f8f9fa}',
    '.tile-grayscale{filter:grayscale(1) contrast(1.08) brightness(1.02)}',
  ].join('\n')
  document.head.appendChild(style)
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
      // A red dot matching the design's accent.
      markerRef.current = L.circleMarker([lat, lng], {
        radius: 8,
        color: '#FFFFFF',
        weight: 3,
        fillColor: '#EA4335',
        fillOpacity: 1,
      }).addTo(map)
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
    markerRef.current = L.circleMarker([lat, lng], {
      radius: 8,
      color: '#FFFFFF',
      weight: 3,
      fillColor: '#EA4335',
      fillOpacity: 1,
    }).addTo(map)
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
      className="w-9 h-9 rounded-xl bg-white border border-[#EBEBEB] shadow-sm flex items-center justify-center text-[18px] font-bold text-[#1A1A1A] active:bg-[#F5F5F5]"
    >
      {children}
    </button>
  )
}

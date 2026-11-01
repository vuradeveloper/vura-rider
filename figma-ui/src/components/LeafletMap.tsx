import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { reportLeafletLoadFailure } from '../lib/webviewGuard'
import carMarkerUrl from '../assets/roam-car-icon.png'

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

/** The rider map draws the live route in Vura blue (the reference design). */
const ROUTE_BLUE = '#2563EB'
const ROUTE_CASING = '#FFFFFF'
const CAR_GLIDE_MS = 3200

/** The driver's car, relayed live over `ride:driver:location`. */
export type MapCar = LatLng & { heading?: number | null }

function bearingBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const p1 = toRad(lat1)
  const p2 = toRad(lat2)
  const dl = toRad(lng2 - lng1)
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}


/**
 * The OLD apps' map styling — copied verbatim from their lib/mapHtml.ts, which
 * is byte-identical between the driver and rider apps. Using the same rules on
 * both means the driver and rider maps look the same.
 *
 *   .leaflet-container{background:#f8f9fa}
 *   .tile-grayscale{filter:grayscale(1) contrast(1.08) brightness(1.02)}
 *   tile URL: https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png  (subdomains abc)
 */
const MAP_STYLE_ID = 'vura-map-style-v2'
function ensureMapStyle() {
  if (document.getElementById(MAP_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = MAP_STYLE_ID
  style.textContent = [
    '.leaflet-container{background:#f8f9fa}',
    '.tile-grayscale{filter:grayscale(1) contrast(1.08) brightness(1.02)}',
    // The roamer car. The wrapper is positioned by Leaflet; the image is rotated
    // to the driver's real heading, and the transition keeps each 4 s GPS ping
    // from looking like a teleport.
    '.vura-roam-car-icon{background:transparent!important;border:0!important}',
    '.vura-roam-car{width:56px;height:56px;display:flex;align-items:center;justify-content:center;pointer-events:none}',
    '.vura-roam-car img{width:52px;height:52px;object-fit:contain;transform-origin:50% 50%;transition:transform .45s linear;filter:drop-shadow(0 2px 5px rgba(0,0,0,.30))}',
    '.vura-route-pin{background:transparent!important;border:0!important}',
    // Reference-map labels: a dark "Pickup" chip and a dark ETA pill at the
    // drop-off. Leaflet's default tooltip chrome (white box + arrow) is removed.
    '.vura-map-label{background:#111!important;color:#fff!important;border:0!important;border-radius:8px!important;padding:3px 8px!important;font:600 11px/1.2 system-ui,sans-serif!important;box-shadow:0 2px 6px rgba(0,0,0,.25)!important;white-space:nowrap!important}',
    '.vura-map-label:before{display:none!important}',
    '.vura-eta-bubble{background:#111!important;color:#fff!important;border:0!important;border-radius:9999px!important;padding:5px 10px!important;font:700 12px/1.2 system-ui,sans-serif!important;box-shadow:0 3px 10px rgba(0,0,0,.28)!important;white-space:nowrap!important}',
    '.vura-eta-bubble:before{display:none!important}',
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
  car,
  pickup,
  stops,
  destination,
  dark = false,
  zoom = 16,
  className = 'absolute inset-0',
  follow = true,
  controls = false,
  controlsBottom = 12,
  fitRoute = false,
  showSelf = true,
  pickupLabel,
  destinationLabel,
}: {
  /** Pin for the driver / focal point. Falls back to live GPS, then Joburg. */
  marker?: LatLng
  /** Optional polyline to draw: pickup → any stops → drop-off. */
  route?: LatLng[]
  /** The hired driver's car, positioned live from `ride:driver:location`. */
  car?: MapCar | null
  /** Pickup marker from the reference layout. */
  pickup?: LatLng | null
  /** Intermediate stops, in visiting order. Drawn as numbered yellow pins. */
  stops?: LatLng[]
  /** Drop-off pin from the reference layout. */
  destination?: LatLng | null
  /** Text on the pickup bubble, e.g. "Pickup". */
  pickupLabel?: string
  /** Text on the drop-off bubble, e.g. "12 min". */
  destinationLabel?: string
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
  /** Frame the whole route once it arrives (and include the car + pins). */
  fitRoute?: boolean
  /**
   * Draw the rider's own live dot. Rider tracking turns this off: the only
   * moving marker there should be the hired driver's car.
   */
  showSelf?: boolean
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const LRef = useRef<any>(null)
  const markerRef = useRef<any>(null)
  const lineRef = useRef<any>(null)
  const casingRef = useRef<any>(null)
  const accuracyRef = useRef<any>(null)
  const pickupRef = useRef<any>(null)
  const stopsRef = useRef<any[]>([])
  const destRef = useRef<any>(null)
  const carRef = useRef<any>(null)
  const carAnim = useRef({ lat: 0, lng: 0, heading: null as number | null, raf: 0 })
  // Once the driver pans the map themselves we stop yanking it back to their
  // position on every GPS tick.
  const userMoved = useRef(false)
  // Leaflet is loaded asynchronously, so the drawing effects wait for this.
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    let watchId: number | null = null

    ;(async () => {
      const L = await loadLeaflet().catch(() => null)
      if (!L || cancelled || !hostRef.current) return
      LRef.current = L

      // First run: create the map.
      if (!mapRef.current) {
        ensureMapStyle()

        const start = marker ?? car ?? JOBURG
        mapRef.current = L.map(hostRef.current, {
          zoomControl: false,
          attributionControl: false,
          preferCanvas: true,
          // A tighter zoom than before: at 16 the surrounding streets are
          // readable, which is what a driver needs when positioning for a pickup.
          zoomSnap: 0.5,
        }).setView([start.lat, start.lng], zoom)

        // Cached OSM tiles with the old apps' grayscale filter — same source,
        // same subdomains and same look as both old APKs.
        attachCachedTiles(L, mapRef.current)

        // NOTE: the grayscale look now comes from the `.tile-grayscale` class on
        // the tiles themselves (exactly as the old apps did), so there is no
        // container-level filter here — adding one would double up the effect and
        // make the map darker than the old APK.

        // Remember if the driver took manual control of the viewport.
        mapRef.current.on('dragstart', () => { userMoved.current = true })
        setReady(true)
      }

      const map = mapRef.current

      // An explicit marker wins; otherwise follow the device's live position.
      if (marker?.lat != null && marker?.lng != null) {
        drawPin(L, map, marker.lat, marker.lng)
        map.setView([marker.lat, marker.lng], zoom, { animate: true })
        return
      }

      // Rider tracking shows the DRIVER's car, not a dot for the rider's phone.
      // The route effect frames the trip; do not fight it with a GPS fix.
      if (!showSelf) {
        if (car && !map.__vuraRiderCentred) {
          map.__vuraRiderCentred = true
          map.setView([car.lat, car.lng], Math.max(map.getZoom(), zoom))
        }
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
  }, [marker?.lat, marker?.lng, dark, zoom, follow, showSelf])

  // Draw / update the route line. The polyline is what the SERVER's routing
  // engine returned via getRoute() (GET /api/route?points=lng,lat;lng,lat), so it
  // bends around the real road network and passes through every stop — it used to
  // be a straight pickup→drop-off segment, and before that nothing at all.
  //
  // Rider view: a white casing under a VURA BLUE line, exactly like the
  // reference map. The old red line was nearly invisible against the red pins.
  const routeKey = route && route.length > 1
    ? route.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|')
    : ''
  const pinKey = `${pickup?.lat ?? ''},${pickup?.lng ?? ''}|${destination?.lat ?? ''},${destination?.lng ?? ''}`
  useEffect(() => {
    if (!ready) return
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map) return
    if (!route || route.length < 2) {
      if (casingRef.current) { map.removeLayer(casingRef.current); casingRef.current = null }
      if (lineRef.current) { map.removeLayer(lineRef.current); lineRef.current = null }
      return
    }
    const latlngs = route.map((p) => [p.lat, p.lng] as [number, number])
    if (!casingRef.current) {
      casingRef.current = L.polyline(latlngs, {
        color: ROUTE_CASING, weight: 9, opacity: 0.95, lineCap: 'round', lineJoin: 'round',
      }).addTo(map)
    } else {
      casingRef.current.setLatLngs(latlngs)
    }
    if (!lineRef.current) {
      lineRef.current = L.polyline(latlngs, {
        color: ROUTE_BLUE, weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round',
      }).addTo(map)
    } else {
      lineRef.current.setLatLngs(latlngs)
    }
    // A live GPS fix keeps re-centring; only frame the whole route when the
    // rider is not being followed, otherwise the viewport fights itself.
    if (fitRoute || !follow) {
      const bounds = L.latLngBounds(latlngs)
      if (pickup) bounds.extend([pickup.lat, pickup.lng])
      if (destination) bounds.extend([destination.lat, destination.lng])
      for (const s of stops ?? []) bounds.extend([s.lat, s.lng])
      if (car) bounds.extend([car.lat, car.lng])
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16, animate: true })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, pinKey, follow, fitRoute, ready])

  // Pickup dot + drop-off pin from the reference layout.
  useEffect(() => {
    if (!ready) return
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map) return

    function put(
      ref: { current: any },
      pt: LatLng | null | undefined,
      html: string,
      size: [number, number],
      anchor: [number, number],
      z: number,
      label: string | undefined,
      tipClass: string,
      direction: 'right' | 'top',
      offset: [number, number],
    ) {
      if (!pt) {
        if (ref.current) { map.removeLayer(ref.current); ref.current = null }
        return
      }
      const icon = L.divIcon({ className: 'vura-route-pin', html, iconSize: size, iconAnchor: anchor })
      if (ref.current) {
        ref.current.setLatLng([pt.lat, pt.lng])
        ref.current.setIcon(icon)
      } else {
        ref.current = L.marker([pt.lat, pt.lng], { icon, interactive: false, keyboard: false, zIndexOffset: z }).addTo(map)
      }
      if (label) {
        if (ref.current.getTooltip?.()) ref.current.setTooltipContent(label)
        else ref.current.bindTooltip(label, { permanent: true, direction, offset, className: tipClass, opacity: 1 })
      } else if (ref.current.getTooltip?.()) {
        ref.current.unbindTooltip()
      }
    }

    put(
      pickupRef,
      pickup,
      '<div style="width:22px;height:22px;border-radius:9999px;background:#111;border:4px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>',
      [22, 22],
      [11, 11],
      650,
      pickupLabel,
      'vura-map-label',
      'right',
      [12, 0],
    )
    put(
      destRef,
      destination,
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path d="M16 0C7.2 0 0 7.2 0 16c0 11.5 16 24 16 24s16-12.5 16-24C32 7.2 24.8 0 16 0z" fill="#EA4335"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg>',
      [32, 40],
      [16, 40],
      640,
      destinationLabel,
      'vura-eta-bubble',
      'top',
      [0, -42],
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pinKey, pickupLabel, destinationLabel])

  // Numbered yellow pins for intermediate stops, in visiting order. The rider
  // must be able to see every stop on the map, not just the two endpoints.
  const stopsKey = (stops ?? []).map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`).join('|')
  useEffect(() => {
    if (!ready) return
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map) return
    const list = stops ?? []
    // Drop pins for stops that were removed or reordered away.
    while (stopsRef.current.length > list.length) {
      const gone = stopsRef.current.pop()
      if (gone) map.removeLayer(gone)
    }
    list.forEach((s, i) => {
      const html = `<div style="width:26px;height:26px;border-radius:9999px;background:#FBBC04;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font:700 12px/1 system-ui,sans-serif;color:#1A1A1A">${i + 1}</div>`
      const icon = L.divIcon({ className: 'vura-route-pin', html, iconSize: [26, 26], iconAnchor: [13, 13] })
      const existing = stopsRef.current[i]
      if (existing) {
        existing.setLatLng([s.lat, s.lng])
        existing.setIcon(icon)
      } else {
        stopsRef.current[i] = L.marker([s.lat, s.lng], {
          icon, interactive: false, keyboard: false, zIndexOffset: 645,
        }).addTo(map)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, stopsKey])

  // The driver's roaming car. Each socket ping animates the marker from where it
  // already is to the new fix, so the rider sees the SAME movement the driver's
  // own map shows — only in the rider's (north-up) orientation, never the
  // driver's rotating heading-up camera.
  const carKey = car ? `${car.lat.toFixed(6)},${car.lng.toFixed(6)}` : ''
  const carHeading = typeof car?.heading === 'number' && Number.isFinite(car.heading) ? car.heading : null
  useEffect(() => {
    if (!ready) return
    const L = LRef.current
    const map = mapRef.current
    if (!L || !map) return
    const a = carAnim.current

    function applyHeading(deg: number | null) {
      const el = carRef.current?.getElement?.() as HTMLElement | null
      const img = el?.querySelector('img') as HTMLElement | null
      if (img && deg != null) img.style.transform = `rotate(${deg.toFixed(1)}deg)`
    }

    if (!car) {
      if (a.raf) cancelAnimationFrame(a.raf)
      a.raf = 0
      a.heading = null
      if (carRef.current) { map.removeLayer(carRef.current); carRef.current = null }
      return
    }

    if (carHeading != null) a.heading = carHeading

    if (!carRef.current) {
      const icon = L.divIcon({
        className: 'vura-roam-car-icon',
        html: `<div class="vura-roam-car"><img src="${carMarkerUrl}" alt="" draggable="false"/></div>`,
        iconSize: [56, 56],
        iconAnchor: [28, 28],
      })
      carRef.current = L.marker([car.lat, car.lng], {
        icon,
        interactive: false,
        keyboard: false,
        zIndexOffset: 1000,
      }).addTo(map)
      a.lat = car.lat
      a.lng = car.lng
      applyHeading(a.heading)
      if (!userMoved.current) {
        // First live fix: frame the car together with the route so the rider
        // can see both ends of the trip. Later fixes only nudge the viewport.
        if (fitRoute && lineRef.current) {
          const bounds = L.latLngBounds(lineRef.current.getBounds())
          bounds.extend([car.lat, car.lng])
          map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16, animate: true })
        } else {
          map.panInside([car.lat, car.lng], { padding: [60, 60], animate: true })
        }
      }
      return
    }

    if (a.raf) cancelAnimationFrame(a.raf)
    a.raf = 0
    const fromLat = a.lat
    const fromLng = a.lng
    const jumped = Math.abs(car.lat - fromLat) + Math.abs(car.lng - fromLng) > 0.05
    if (jumped) {
      a.lat = car.lat
      a.lng = car.lng
      carRef.current.setLatLng([car.lat, car.lng])
    } else if (fromLat !== car.lat || fromLng !== car.lng) {
      if (a.heading == null) a.heading = bearingBetween(fromLat, fromLng, car.lat, car.lng)
      const t0 = performance.now()
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / CAR_GLIDE_MS)
        // Smoothstep: no jerk at either end of the interpolation.
        const e = p * p * (3 - 2 * p)
        const lat = fromLat + (car.lat - fromLat) * e
        const lng = fromLng + (car.lng - fromLng) * e
        a.lat = lat
        a.lng = lng
        carRef.current?.setLatLng([lat, lng])
        if (p < 1) {
          a.raf = requestAnimationFrame(step)
        } else {
          a.raf = 0
          if (!userMoved.current) map.panInside([car.lat, car.lng], { padding: [60, 60], animate: true })
        }
      }
      a.raf = requestAnimationFrame(step)
    } else {
      carRef.current.setLatLng([car.lat, car.lng])
    }
    applyHeading(a.heading)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, carKey, carHeading, fitRoute])

  useEffect(() => () => {
    if (carAnim.current.raf) cancelAnimationFrame(carAnim.current.raf)
  }, [])

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

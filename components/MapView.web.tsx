import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Image, View } from "react-native";

export function Marker(_props: any) { return null; }
export function Polyline(_props: any) { return null; }
export const PROVIDER_GOOGLE = "google"; // kept for API parity only

const LEAFLET_CSS_ID = "leaflet-css-local";
const LEAFLET_JS_ID = "leaflet-js-local";

function ensureLeafletLoaded(onReady: () => void) {
  const w = window as any;
  if (w.L) {
    onReady();
    return;
  }
  if (!document.getElementById(LEAFLET_CSS_ID)) {
    const link = document.createElement("link");
    link.id = LEAFLET_CSS_ID;
    link.rel = "stylesheet";
    link.href = "/leaflet/leaflet.css";
    document.head.appendChild(link);
  }
  const existingScript = document.getElementById(LEAFLET_JS_ID) as HTMLScriptElement | null;
  if (existingScript) {
    existingScript.addEventListener("load", onReady);
    return;
  }
  const script = document.createElement("script");
  script.id = LEAFLET_JS_ID;
  script.src = "/leaflet/leaflet.js";
  script.async = true;
  script.onload = onReady;
  document.head.appendChild(script);
}

// Kick off the Leaflet CDN download as soon as this module loads (it is
// imported early by the home/tab screens), so the first map screen never has
// to wait on the CDN and every screen after reuses the cached copy.
if (typeof window !== "undefined") {
  ensureLeafletLoaded(() => {});
}

// Tiles are cached in localStorage (as data URLs) so repeat maps load
// instantly and use far less mobile data. The cache is capped so it can never
// fill storage and break other data (e.g. recent searches).
function storeTile(url: string, dataUrl: string) {
  try {
    let n = 0;
    const del: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf("vura:tile:") === 0) {
        n++;
        if (n > 250) del.push(k);
      }
    }
    del.forEach((k) => {
      try {
        localStorage.removeItem(k);
      } catch (e) {}
    });
    localStorage.setItem("vura:tile:" + url, dataUrl);
  } catch (e) {}
}

function createCachedTileLayer(L: any, tpl: string) {
  const CacheLayer = L.TileLayer.extend({
    createTile: function (coords: any, done: any) {
      const url = this.getTileUrl(coords);
      let cached: string | null = null;
      try {
        cached = localStorage.getItem("vura:tile:" + url);
      } catch (e) {}
      const img = document.createElement("img");
      img.style.width = img.style.height = "256px";
      const finish = () => done(null, img);
      const fail = () => done("error");
      if (cached) {
        img.onload = finish;
        img.onerror = fail;
        img.src = cached;
        return img;
      }
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.responseType = "blob";
      xhr.onload = () => {
        if (xhr.status !== 200) {
          fail();
          return;
        }
        const fr = new FileReader();
        fr.onload = () => {
          const dataUrl = fr.result as string;
          storeTile(url, dataUrl);
          img.onload = finish;
          img.onerror = fail;
          img.src = dataUrl;
        };
        fr.readAsDataURL(xhr.response);
      };
      xhr.onerror = fail;
      xhr.send();
      return img;
    },
  });
  return new CacheLayer(tpl, {
    maxZoom: 19,
    subdomains: "abc",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  });
}

function bearingDeg(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const la1 = (lat1 * Math.PI) / 180;
  const la2 = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

// Smoothly animate a marker from its current position to a new one instead
// of teleporting, so moving cars glide like Uber/Bolt.
function animToWeb(key: string, layer: any, toLat: number, toLng: number, deg: number | null, duration = 1500) {
  const anims = (window as any).__vuraAnims as Record<string, number> | undefined;
  const prev = layer.getLatLng();
  const fromLat = prev.lat, fromLng = prev.lng;
  const start = performance.now();
  if (anims && anims[key]) cancelAnimationFrame(anims[key]);
  const rotate = (l: any, d: number | null) => {
    if (d === null || d === undefined) return;
    const el = l.getElement();
    if (el && el.firstElementChild) (el.firstElementChild as HTMLElement).style.transform = `rotate(${d}deg)`;
  };
  const step = (ts: number) => {
    const t = Math.min(1, (ts - start) / duration);
    layer.setLatLng([fromLat + (toLat - fromLat) * t, fromLng + (toLng - fromLng) * t]);
    rotate(layer, deg);
    if (t < 1) {
      const store = (window as any).__vuraAnims as Record<string, number>;
      store[key] = requestAnimationFrame(step);
    } else if ((window as any).__vuraAnims) {
      delete (window as any).__vuraAnims[key];
    }
  };
  const store = ((window as any).__vuraAnims = (window as any).__vuraAnims || {});
  store[key] = requestAnimationFrame(step);
}

function injectStylesOnce() {
  const STYLE_ID = "mapview-web-styles";
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.innerHTML = `
.car-img-m{background:transparent;border:0;transition:transform .18s linear}
.car-img-m img{width:48px;height:48px;object-fit:contain;transition:transform .18s linear;transform-origin:center center}
.car-svg-m{background:transparent;border:0;transition:transform .18s linear}
.car-svg-m>div{width:36px;height:36px;background:#1a1a1a;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:transform .18s linear;transform-origin:center center}
.car-svg-m svg{width:20px;height:20px;fill:#fff}
.pin-m{background:transparent;border:0}
.pin-m>div{width:28px;height:28px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.2);font-size:12px;font-weight:bold;color:#fff}
.usr-m{background:transparent;border:0}
.usr-m>div{width:14px;height:14px;background:#3b82f6;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 4px rgba(59,130,246,.25)}
.you-m{background:transparent;border:0}
.you-m>div{width:16px;height:16px;background:#22c55e;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 4px rgba(34,197,94,.3),0 0 0 8px rgba(34,197,94,.12)}
.ent-m{background:transparent;border:0}
.ent-m>div{width:14px;height:14px;background:#1a1a1a;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)}
.ent-sel-m{background:transparent;border:0}
.ent-sel-m>div{width:16px;height:16px;background:#22c55e;border-radius:50%;border:3px solid #fff;box-shadow:0 2px 5px rgba(0,0,0,.4)}
.leaflet-container{background:#f8f9fa}

`;
  document.head.appendChild(style);
}

function buildIcon(L: any, p: any) {
  if (p.icon === "car") {
    if (p.imgUrl) {
      return L.divIcon({
        html: `<img src="${p.imgUrl}" />`,
        className: "car-img-m",
        iconSize: [48, 48],
        iconAnchor: [24, 24],
      });
    }
    return L.divIcon({
      html: '<div><svg viewBox="0 0 24 24"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg></div>',
      className: "car-svg-m",
      iconSize: [36, 36],
      iconAnchor: [18, 18],
    });
  } else if (p.icon === "pickup") {
    return L.divIcon({
      html: '<div style="background:#22c55e">P</div>',
      className: "pin-m",
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  } else if (p.icon === "dropoff") {
    return L.divIcon({
      html: '<div style="background:#ef4444">D</div>',
      className: "pin-m",
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  } else if (p.icon === "entrance") {
    return L.divIcon({
      html: "<div></div>",
      className: "ent-m",
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  } else if (p.icon === "entrance-sel") {
    return L.divIcon({
      html: "<div></div>",
      className: "ent-sel-m",
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  } else if (p.icon === "you") {
    return L.divIcon({
      html: "<div></div>",
      className: "you-m",
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    });
  }
  return L.divIcon({ html: "<div></div>", className: "usr-m", iconSize: [14, 14], iconAnchor: [7, 7] });
}

const MapView = forwardRef<any, any>((props, ref) => {
  const { initialRegion, children, style } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerLayersRef = useRef<Record<string, any>>({});
  const polylineLayersRef = useRef<Record<string, any>>({});
  const lastInitialRegionRef = useRef<string>("");
  const smoothBearingRef = useRef(0);
  const [ready, setReady] = useState(false);

  const markers = useMemo(() => {
    const r: any[] = [];
    React.Children.forEach(children, (child: any) => {
      if (React.isValidElement(child) && (child.props as any).coordinate) {
        const cp = child.props as any;
        const t = cp.title || "";
        let imgUrl = "";
        const imgSource = cp.image;
        if (typeof imgSource === "string") {
          imgUrl = imgSource;
        } else if (imgSource && typeof imgSource === "object" && imgSource.uri) {
          imgUrl = imgSource.uri;
        } else if (imgSource) {
          try {
            const resolved = Image.resolveAssetSource(imgSource);
            if (resolved?.uri) imgUrl = resolved.uri;
          } catch (e) { }
        }
        r.push({
          lat: cp.coordinate.latitude,
          lng: cp.coordinate.longitude,
          title: t,
          icon: cp.image
            ? "car"
            : cp.pinColor === "#22c55e"
              ? "pickup"
              : cp.pinColor === "#ef4444"
                ? "dropoff"
                : cp.pinColor === "#1a1a1a"
                  ? "entrance"
                  : cp.pinColor === "#059669"
                    ? "entrance-sel"
                    : t.toLowerCase() === "your location"
                      ? "you"
                      : t.toLowerCase() === "nearby driver"
                        ? "car"
                        : "",
          angle: cp.rotation || 0,
          imgUrl,
        });
      }
    });
    return r;
  }, [children]);

  const polylines = useMemo(() => {
    const r: any[] = [];
    React.Children.forEach(children, (child: any) => {
      if (React.isValidElement(child) && (child.props as any).coordinates) {
        const cp = child.props as any;
        r.push({
          coords: cp.coordinates.map((c: any) => [c.latitude, c.longitude]),
          color: cp.strokeColor || "#3b82f6",
          weight: cp.strokeWidth || 4,
        });
      }
    });
    return r;
  }, [children]);

  const center = initialRegion
    ? {
      lat: initialRegion.latitude,
      lng: initialRegion.longitude,
      latD: initialRegion.latitudeDelta || 0.05,
      lngD: initialRegion.longitudeDelta || 0.05,
    }
    : { lat: 0, lng: 0, latD: 0.05, lngD: 0.05 };

  // Stable key for the initial view — used to (a) defer map creation until a
  // real region exists and (b) recenter only when it actually changes.
  const initialKey = initialRegion
    ? `${initialRegion.latitude},${initialRegion.longitude}`
    : "";

  // Init map once
  const propsRef = useRef<any>(props);
  useEffect(() => {
    propsRef.current = props;
  });

  // Create the map only once a real initial region is available. Deferring
  // avoids initializing at (0,0) — which loaded a wasteful sea of tiles and
  // caused a visible flash/jump on screens where coords arrive asynchronously
  // (options, track). The ResizeObserver below keeps it sized after layout.
  //
  // IMPORTANT: this effect must NEVER tear the map down. It re-runs when
  // `initialKey` changes (screens like Home recompute a "fit all points"
  // region as roaming cars move every 2s). Recreating Leaflet here destroyed
  // the map every tick while markerLayersRef still pointed at the old map's
  // layers, so car markers were "animated" on detached layers and vanished.
  // Region changes are handled separately by the recenter effect below.
  useEffect(() => {
    if (!initialRegion || mapRef.current) return;
    let cancelled = false;
    injectStylesOnce();
    ensureLeafletLoaded(() => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const L = (window as any).L;
      const latD = initialRegion.latitudeDelta || 0.05;
      const lngD = initialRegion.longitudeDelta || 0.05;
      const zoom = Math.max(
        10,
        Math.min(18, Math.round(Math.log2(360 / Math.max(latD, lngD))))
      );
      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([initialRegion.latitude, initialRegion.longitude], zoom);
      createCachedTileLayer(
        L,
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      ).addTo(map);

      map.on("move", () => {
        if (propsRef.current.onRegionChange) {
          const centerLatLng = map.getCenter();
          const bounds = map.getBounds();
          propsRef.current.onRegionChange({
            latitude: centerLatLng.lat,
            longitude: centerLatLng.lng,
            latitudeDelta: Math.abs(bounds.getNorth() - bounds.getSouth()),
            longitudeDelta: Math.abs(bounds.getEast() - bounds.getWest()),
          });
        }
      });

      map.on("moveend", () => {
        if (propsRef.current.onRegionChangeComplete) {
          const centerLatLng = map.getCenter();
          const bounds = map.getBounds();
          propsRef.current.onRegionChangeComplete({
            latitude: centerLatLng.lat,
            longitude: centerLatLng.lng,
            latitudeDelta: Math.abs(bounds.getNorth() - bounds.getSouth()),
            longitudeDelta: Math.abs(bounds.getEast() - bounds.getWest()),
          });
        }
      });

      mapRef.current = map;
      lastInitialRegionRef.current = initialKey;
      setReady(true);
      // Container may still be laying out — size it once layout settles.
      setTimeout(() => map.invalidateSize(), 50);
    });
    // No map removal here — the map is torn down only on true unmount.
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey]);

  // Tear down Leaflet only when the component actually unmounts.
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markerLayersRef.current = {};
      polylineLayersRef.current = {};
    };
  }, []);

  // Resize observer to keep map sized correctly in flex/responsive layouts.
  // Important: NEVER recenter to initialRegion on resize — that was causing the
  // picker map to "snap back to the start" while the address resolved. We only
  // recenter when the initialRegion center actually changes.
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (!mapRef.current) return;
      mapRef.current.invalidateSize();
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [ready]);

  // Update view when initialRegion changes dynamically (e.g. when coords finish loading asynchronously)
  useEffect(() => {
    if (!ready || !mapRef.current || !initialRegion) return;
    if (lastInitialRegionRef.current === initialKey) return;
    lastInitialRegionRef.current = initialKey;
    mapRef.current.setView(
      [initialRegion.latitude, initialRegion.longitude],
      mapRef.current.getZoom() || 15
    );
  }, [ready, initialKey]);

  // Update markers + polylines whenever they change
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const L = (window as any).L;
    const map = mapRef.current;

    const seen: Record<string, boolean> = {};
    markers.forEach((p, idx) => {
      const key = "m" + idx;
      seen[key] = true;
      const existing = markerLayersRef.current[key];
      if (existing && existing.iconType === p.icon && existing.hasImg === !!p.imgUrl) {
        const prev = existing.layer.getLatLng();
        if (Math.abs(prev.lat - p.lat) > 1e-7 || Math.abs(prev.lng - p.lng) > 1e-7) {
          const deg = p.icon === "car" ? (bearingDeg(prev.lat, prev.lng, p.lat, p.lng) + 90) % 360 : null;
          animToWeb(key, existing.layer, p.lat, p.lng, deg);
        }
      } else {
        if (existing) map.removeLayer(existing.layer);
        const layer = L.marker([p.lat, p.lng], { icon: buildIcon(L, p) }).addTo(map);
        const el2 = layer.getElement();
        if (el2) {
          el2.style.transition = "transform 0.18s linear";
          if (el2.firstElementChild) {
            (el2.firstElementChild as HTMLElement).style.transform = `rotate(${p.angle || 0}deg)`;
          }
        }
        markerLayersRef.current[key] = { layer, iconType: p.icon, hasImg: !!p.imgUrl };
      }
    });
    Object.keys(markerLayersRef.current).forEach((key) => {
      if (!seen[key]) {
        map.removeLayer(markerLayersRef.current[key].layer);
        delete markerLayersRef.current[key];
      }
    });

    // Polylines are diffed by a lightweight signature instead of being torn
    // down and re-created on every update. Without this, the options/track
    // screens rebuild their (hundreds of point) route lines every animation
    // tick — a major source of map jank.
    const seenP: Record<string, boolean> = {};
    polylines.forEach((p, idx) => {
      const key = "p" + idx;
      seenP[key] = true;
      const first = p.coords[0];
      const last = p.coords[p.coords.length - 1];
      const sig =
        `${p.color}|${p.weight}|${p.coords.length}|` +
        `${first ? first[0] + "," + first[1] : ""}|` +
        `${last ? last[0] + "," + last[1] : ""}`;
      const existing = polylineLayersRef.current[key];
      if (existing && existing.sig === sig) return;
      if (existing) map.removeLayer(existing.layer);
      const layer = L.polyline(p.coords, {
        color: p.color || "#3b82f6",
        weight: p.weight || 4,
        opacity: 0.8,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);
      polylineLayersRef.current[key] = { layer, sig };
    });
    Object.keys(polylineLayersRef.current).forEach((key) => {
      if (!seenP[key]) {
        map.removeLayer(polylineLayersRef.current[key].layer);
        delete polylineLayersRef.current[key];
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, markers, polylines]);

  useImperativeHandle(ref, () => ({
    animateToRegion: (region: any, _duration?: number) => {
      mapRef.current?.setView([region.latitude, region.longitude], 15, {
        animate: true,
        duration: 0.3,
      });
    },
    followCar: (lat: number, lng: number, bearing: number = 0, zoom: number = 17) => {
      const map = mapRef.current;
      if (!map) return;
      const size = map.getSize();
      if (!size || size.y === 0) return;
      let diff = bearing - smoothBearingRef.current;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      smoothBearingRef.current = smoothBearingRef.current + diff;
      
      // Use user's current zoom level if they zoomed manually
      const currentZoom = map.getZoom() || zoom;

      // Position the car at 30% from the top of screen to keep it visible above bottom sheet (which occupies bottom 46%)
      const offsetY = size.y * (0.30 - 0.5);
      const carPoint = map.project([lat, lng], currentZoom);
      const targetPoint = carPoint.subtract([0, offsetY]);
      const mapCenter = map.unproject(targetPoint, currentZoom);
      map.setView(mapCenter, currentZoom, { animate: true, duration: 0.3, easeLinearity: 1.0 });
      
      const container = map.getContainer();
      if (container) {
        container.style.transformOrigin = "";
        container.style.transition = "";
        container.style.transform = "";
      }
    },
    unfollow: () => {
      smoothBearingRef.current = 0;
      const container = mapRef.current?.getContainer();
      if (container) {
        container.style.transform = "";
        container.style.transformOrigin = "";
        container.style.transition = "";
      }
    },
    getCamera: () =>
      Promise.resolve({ center: { latitude: center.lat, longitude: center.lng }, zoom: 15 }),
    setCamera: () => { },
    coordinateForPoint: () =>
      Promise.resolve({ latitude: center.lat, longitude: center.lng }),
  }));

  return (
    <View style={[{ flex: 1, width: "100%", height: "100%" }, style]}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </View>
  );
});

export default MapView;
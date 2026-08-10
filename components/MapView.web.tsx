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

const LEAFLET_CSS_ID = "leaflet-css-cdn";
const LEAFLET_JS_ID = "leaflet-js-cdn";

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
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    document.head.appendChild(link);
  }
  const existingScript = document.getElementById(LEAFLET_JS_ID) as HTMLScriptElement | null;
  if (existingScript) {
    existingScript.addEventListener("load", onReady);
    return;
  }
  const script = document.createElement("script");
  script.id = LEAFLET_JS_ID;
  script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
  script.async = true;
  script.onload = onReady;
  document.head.appendChild(script);
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
  }
  return L.divIcon({ html: "<div></div>", className: "usr-m", iconSize: [14, 14], iconAnchor: [7, 7] });
}

const MapView = forwardRef<any, any>((props, ref) => {
  const { initialRegion, children, style } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerLayersRef = useRef<Record<string, any>>({});
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
                    : t.toLowerCase() === "your location" || t.toLowerCase() === "nearby driver"
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

  // Init map once
  const propsRef = useRef<any>(props);
  useEffect(() => {
    propsRef.current = props;
  });

  // Init map once
  useEffect(() => {
    let cancelled = false;
    injectStylesOnce();
    ensureLeafletLoaded(() => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const L = (window as any).L;
      const zoom = Math.max(
        10,
        Math.min(18, Math.round(Math.log2(360 / Math.max(center.latD, center.lngD))))
      );
      const map = L.map(containerRef.current, {
        zoomControl: true,
        attributionControl: false,
      }).setView([center.lat, center.lng], zoom);
      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
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
      setReady(true);
      setTimeout(() => map.invalidateSize(), 50);
      setTimeout(() => map.invalidateSize(), 300);
      setTimeout(() => map.invalidateSize(), 1000);
      setTimeout(() => map.invalidateSize(), 2000);
    });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resize observer to keep map sized correctly in flex/responsive layouts
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
        // Recenter on active center point after layout sizing update
        if (initialRegion) {
          mapRef.current.setView([initialRegion.latitude, initialRegion.longitude], mapRef.current.getZoom() || 15);
        }
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [ready, initialRegion?.latitude, initialRegion?.longitude]);

  // Update view when initialRegion changes dynamically (e.g. when coords finish loading asynchronously)
  useEffect(() => {
    if (ready && mapRef.current && initialRegion) {
      mapRef.current.setView([initialRegion.latitude, initialRegion.longitude], mapRef.current.getZoom() || 15);
    }
  }, [ready, initialRegion?.latitude, initialRegion?.longitude]);

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
        existing.layer.setLatLng([p.lat, p.lng]);
        const el = existing.layer.getElement();
        if (el && el.firstElementChild) {
          (el.firstElementChild as HTMLElement).style.transform = `rotate(${p.angle || 0}deg)`;
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

    map.eachLayer((l: any) => {
      if (l instanceof L.Polyline) map.removeLayer(l);
    });
    polylines.forEach((p) => {
      L.polyline(p.coords, {
        color: p.color || "#3b82f6",
        weight: p.weight || 4,
        opacity: 0.8,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);
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
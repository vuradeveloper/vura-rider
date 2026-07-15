import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Image, View } from "react-native";
import { WebView } from "react-native-webview";

export function Marker(_props: any) { return null; }
export function Polyline(_props: any) { return null; }
export const PROVIDER_GOOGLE = "google"; // kept for API parity only — unused, we render OSM tiles via Leaflet

function buildHTML(center: [number, number, number, number], initialMarkers: string, initialPolylines: string) {
  const [lat, lng, latD, lngD] = center;
  const zoom = Math.max(10, Math.min(18, Math.round(Math.log2(360 / Math.max(latD || 0.05, lngD || 0.05)))));
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#f8f9fa}
#viewport{width:100vw;height:100vh;overflow:hidden;position:relative}
#m{position:absolute}
.leaflet-container{background:#f8f9fa}
.car-img-m{background:transparent;border:0;transition:transform .18s linear}
.car-img-m img{width:48px;height:48px;object-fit:contain;transition:transform .18s linear;transform-origin:center center}
.car-svg-m{background:transparent;border:0;transition:transform .18s linear}
.car-svg-m>div{width:36px;height:36px;background:#1a1a1a;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:transform .18s linear;transform-origin:center center}
.car-svg-m svg{width:20px;height:20px;fill:#fff}
.pin-m{background:transparent;border:0}
.pin-m>div{width:28px;height:28px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.2);font-size:12px;font-weight:bold;color:#fff}
.usr-m{background:transparent;border:0}
.usr-m>div{width:14px;height:14px;background:#3b82f6;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 4px rgba(59,130,246,.25)}
</style>
</head><body><div id="viewport"><div id="m"></div></div><script>
var mEl = document.getElementById('m');

function sizeMapContainer(){
  var vw = window.innerWidth, vh = window.innerHeight;
  var diag = Math.ceil(Math.sqrt(vw * vw + vh * vh)) + 40;
  mEl.style.width = diag + 'px';
  mEl.style.height = diag + 'px';
  mEl.style.left = Math.round((vw - diag) / 2) + 'px';
  mEl.style.top = Math.round((vh - diag) / 2) + 'px';
}
sizeMapContainer();

var m = L.map('m', { zoomControl:false, attributionControl:false }).setView([${lat},${lng}], ${zoom});
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png').addTo(m);

window.addEventListener('resize', function(){
  sizeMapContainer();
  m.invalidateSize();
});

var markerLayers = {};

function buildIcon(p){
  if (p.icon === 'car') {
    if (p.imgUrl) {
      return L.divIcon({ html: '<img src="' + p.imgUrl + '" />', className: 'car-img-m', iconSize: [48,48], iconAnchor: [24,24] });
    }
    return L.divIcon({
      html: '<div><svg viewBox="0 0 24 24"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg></div>',
      className: 'car-svg-m', iconSize: [36,36], iconAnchor: [18,18]
    });
  } else if (p.icon === 'pickup') {
    return L.divIcon({ html:'<div style="background:#22c55e">P</div>', className:'pin-m', iconSize:[28,28], iconAnchor:[14,14] });
  } else if (p.icon === 'dropoff') {
    return L.divIcon({ html:'<div style="background:#ef4444">D</div>', className:'pin-m', iconSize:[28,28], iconAnchor:[14,14] });
  }
  return L.divIcon({ html:'<div></div>', className:'usr-m', iconSize:[14,14], iconAnchor:[7,7] });
}

function updateMarkers(arr){
  var seen = {};
  arr.forEach(function(p, idx){
    var key = 'm' + idx;
    seen[key] = true;
    var existing = markerLayers[key];
    if (existing && existing.iconType === p.icon && existing.hasImg === !!p.imgUrl) {
      existing.layer.setLatLng([p.lat, p.lng]);
      var el = existing.layer.getElement();
      if (el && el.firstElementChild) { el.firstElementChild.style.transform = 'rotate(' + (p.angle||0) + 'deg)'; }
    } else {
      if (existing) m.removeLayer(existing.layer);
      var layer = L.marker([p.lat, p.lng], { icon: buildIcon(p) }).addTo(m);
        var el2 = layer.getElement();
        if (el2) {
        el2.style.transition = 'transform 0.18s linear';
        if (el2.firstElementChild) { el2.firstElementChild.style.transform = 'rotate(' + (p.angle||0) + 'deg)'; }
        }
      markerLayers[key] = { layer: layer, iconType: p.icon, hasImg: !!p.imgUrl };
    }
  });
  Object.keys(markerLayers).forEach(function(key){
    if (!seen[key]) { m.removeLayer(markerLayers[key].layer); delete markerLayers[key]; }
  });
}

function addPolylines(arr){
  m.eachLayer(function(l){ if (l instanceof L.Polyline) m.removeLayer(l); });
  arr.forEach(function(p){
    L.polyline(p.coords, { color: p.color || '#3b82f6', weight: p.weight || 4, opacity: .8, lineCap:'round', lineJoin:'round' }).addTo(m);
  });
}

updateMarkers(${initialMarkers});
addPolylines(${initialPolylines});

var smoothBearing = 0;

function followCar(lat, lng, bearing, zoom) {
  var size = m.getSize();
  if (!size || size.y === 0) return;
  var diff = bearing - smoothBearing;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  smoothBearing = smoothBearing + diff;
  var height = size.y;
  var offsetY = height * (0.7111 - 0.5);
  var carPoint = m.project([lat, lng], zoom);
  var targetPoint = carPoint.subtract([0, offsetY]);
  var mapCenter = m.unproject(targetPoint, zoom);
  m.setView(mapCenter, zoom, { animate: true, duration: 0.3, easeLinearity: 1.0 });
  var container = m.getContainer();
  if (container) {
    container.style.transformOrigin = '50% 71.11%';
    container.style.transition = 'transform 0.3s linear';
    container.style.transform = 'rotate(' + (-smoothBearing) + 'deg)';
  }
}

function unfollow() {
  smoothBearing = 0;
  var container = m.getContainer();
  if (container) { container.style.transform = ''; container.style.transformOrigin = ''; container.style.transition = ''; }
}

// react-native-webview delivers postMessage differently across platforms —
// Android fires it on 'document', iOS fires it on 'window'. Listening on
// both covers both platforms reliably.
function handleMessage(e){
  try {
    var d = JSON.parse(e.data);
    if (d.type === 'update') { updateMarkers(d.markers || []); addPolylines(d.polylines || []); }
    else if (d.type === 'panTo') { m.setView([d.lat, d.lng], d.zoom || m.getZoom(), { animate: true, duration: .3 }); }
    else if (d.type === 'follow') { followCar(d.lat, d.lng, d.bearing || 0, d.zoom || m.getZoom()); }
    else if (d.type === 'unfollow') { unfollow(); }
  } catch (ex) {}
}
document.addEventListener('message', handleMessage);
window.addEventListener('message', handleMessage);
<\/script></body></html>`;
}

const MapView = forwardRef<any, any>((props, ref) => {
  const { initialRegion, children, style } = props;
  const webviewRef = useRef<WebView | null>(null);
  const loadedRef = useRef(false);
  const lastRef = useRef<string>("");

  const markers = useMemo(() => {
    const r: any[] = [];
    React.Children.forEach(children, (child: any) => {
      if (React.isValidElement(child) && child.type === Marker && child.props.coordinate) {
        const t = child.props.title || "";
        let imgUrl = "";
        const imgSource = child.props.image;
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
          lat: child.props.coordinate.latitude,
          lng: child.props.coordinate.longitude,
          title: t,
          icon: child.props.image ? "car"
            : child.props.pinColor === "#22c55e" ? "pickup"
              : child.props.pinColor === "#ef4444" ? "dropoff"
                : (t.toLowerCase() === "your location" || t.toLowerCase() === "nearby driver") ? "car"
                  : "",
          angle: child.props.rotation || 0,
          imgUrl,
        });
      }
    });
    return r;
  }, [children]);

  const polylines = useMemo(() => {
    const r: any[] = [];
    React.Children.forEach(children, (child: any) => {
      if (React.isValidElement(child) && child.type === Polyline && child.props.coordinates) {
        r.push({
          coords: child.props.coordinates.map((c: any) => [c.latitude, c.longitude]),
          color: child.props.strokeColor || "#3b82f6",
          weight: child.props.strokeWidth || 4,
        });
      }
    });
    return r;
  }, [children]);

  const center: [number, number, number, number] = initialRegion
    ? [initialRegion.latitude, initialRegion.longitude, initialRegion.latitudeDelta || 0.05, initialRegion.longitudeDelta || 0.05]
    : [0, 0, 0.05, 0.05];

  const initialMs = useMemo(() => JSON.stringify(markers), []);
  const initialPs = useMemo(() => JSON.stringify(polylines), []);
  const html = useMemo(() => buildHTML(center, initialMs, initialPs), []);

  const postUpdate = useCallback(() => {
    if (!webviewRef.current) return;
    const msg = JSON.stringify({ type: "update", markers, polylines });
    if (msg !== lastRef.current) {
      lastRef.current = msg;
      webviewRef.current.postMessage(msg);
    }
  }, [markers, polylines]);

  useEffect(() => {
    if (loadedRef.current) postUpdate();
  }, [postUpdate]);

  useImperativeHandle(ref, () => ({
    animateToRegion: (region: any, _duration?: number) => {
      webviewRef.current?.postMessage(JSON.stringify({ type: "panTo", lat: region.latitude, lng: region.longitude, zoom: 15 }));
    },
    followCar: (lat: number, lng: number, bearing: number, zoom: number = 17) => {
      webviewRef.current?.postMessage(JSON.stringify({ type: "follow", lat, lng, bearing, zoom }));
    },
    unfollow: () => {
      webviewRef.current?.postMessage(JSON.stringify({ type: "unfollow" }));
    },
    getCamera: () => Promise.resolve({ center: { latitude: center[0], longitude: center[1] }, zoom: 15 }),
    setCamera: () => { },
    coordinateForPoint: () => Promise.resolve({ latitude: center[0], longitude: center[1] }),
  }));

  return (
    <View
      style={[{ flex: 1, width: "100%", height: "100%" }, style]}
    >
      <WebView
        ref={webviewRef}
        originWhitelist={["*"]}
        source={{ html }}
        onLoadStart={() => console.log("[MapView] WebView load started")}
        onLoadEnd={() => {
          loadedRef.current = true;
          console.log("[MapView] WebView load finished");
          postUpdate();
        }}
        onError={(e) => console.log("[MapView] WebView onError:", e.nativeEvent)}
        onHttpError={(e) => console.log("[MapView] WebView onHttpError:", e.nativeEvent)}
        onRenderProcessGone={(e) => console.log("[MapView] WebView renderProcessGone:", e.nativeEvent)}
        javaScriptEnabled
        domStorageEnabled
        androidLayerType="hardware"
        style={{ flex: 1, backgroundColor: "#f8f9fa" }}
      />
    </View>
  );
});

export default MapView;
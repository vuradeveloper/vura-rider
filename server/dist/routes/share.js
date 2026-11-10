"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.shareLocationHidden = shareLocationHidden;
exports.shareRidePayload = shareRidePayload;
exports.sharePage = sharePage;
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const database_1 = require("../config/database");
const vehicleImages_1 = require("../services/vehicleImages");
const shareCarIcon_1 = require("./shareCarIcon");
const router = (0, express_1.Router)();
const providerSeams_1 = require("../services/providerSeams");
// The public wordmark used on the share page. Served from this route so the
// page has no third-party image dependency (and the CSP can stay tight).
const VURA_LOGO_PATH = path_1.default.join(__dirname, "..", "..", "assets", "vura-logo.png");
const FINAL_RIDE_STATUSES = new Set(["completed", "cancelled", "expired"]);
/**
 * A completed/cancelled trip (or a rider who pressed "Stop sharing") must never
 * expose the driver's live position. The page also hides the car marker, but the
 * API is the real boundary: no coordinates leave the server once the trip is
 * over. Pure function so the privacy rule is unit-testable.
 */
function shareLocationHidden(status, sharingEnded) {
    return sharingEnded || FINAL_RIDE_STATUSES.has(String(status ?? "").toLowerCase());
}
/** Build the public payload, stripping live coordinates as soon as the trip is over. */
function shareRidePayload(ride, sharingEnded) {
    const status = String(ride?.status || "").toLowerCase();
    const tripDone = status === "completed";
    const hideLocation = shareLocationHidden(status, sharingEnded);
    return {
        id: ride.id,
        status,
        tripDone,
        hasDriver: !!ride.driver_id,
        pickupAddress: ride.pickup_address,
        pickup: ride.pickup_lat != null ? [Number(ride.pickup_lat), Number(ride.pickup_lng)] : null,
        destinationAddress: ride.destination_address,
        destination: ride.destination_lat != null ? [Number(ride.destination_lat), Number(ride.destination_lng)] : null,
        createdAt: ride.created_at,
        driverName: ride.driver_name || "Your driver",
        driverPhotoUrl: ride.driver_photo_url || null,
        driverRating: Number(ride.driver_rating) || 0,
        vehicleMake: ride.vehicle_make,
        vehicleModel: ride.vehicle_model,
        vehicleColor: ride.vehicle_color,
        vehicleImageUrl: ride.vehicle_image_url,
        licensePlate: ride.license_plate,
        // Privacy boundary: once the trip is complete (or sharing stopped) the
        // driver's coordinates are never sent to a public page again.
        driverLat: hideLocation || ride.driver_lat == null ? null : Number(ride.driver_lat),
        driverLng: hideLocation || ride.driver_lng == null ? null : Number(ride.driver_lng),
        driverHeading: hideLocation || ride.driver_heading == null ? null : Number(ride.driver_heading),
        sharingEnded,
    };
}
// Ensure safety tables exist (best-effort) — a share GET must not 500 if the
// table hasn't been created yet (e.g. first share before any POST ran).
async function ensureShareTables() {
    try {
        await (0, database_1.execute)(`CREATE TABLE IF NOT EXISTS safety_events (
         id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
         ride_id UUID REFERENCES rides(id),
         type VARCHAR(50) NOT NULL,
         data JSONB,
         created_at TIMESTAMPTZ DEFAULT NOW()
       )`).catch(() => undefined);
    }
    catch {
        /* ignore */
    }
}
// GET /api/share/logo.png — public Vura wordmark for the share page.
router.get("/logo.png", (_req, res) => {
    res.set("Cache-Control", "public, max-age=86400");
    res.type("png");
    res.sendFile(VURA_LOGO_PATH, (err) => {
        if (err && !res.headersSent)
            res.status(404).end();
    });
});
// GET /api/share/:token — Public live-trip tracking data (no auth). The token
// was stored in safety_events when the rider pressed "Share trip".
router.get("/:token", async (req, res) => {
    try {
        await ensureShareTables();
        res.set("Cache-Control", "no-store, max-age=0");
        const { token } = req.params;
        const evt = await (0, database_1.queryOne)(`SELECT ride_id FROM safety_events
       WHERE type = 'share_started' AND data->>'shareToken' = $1
       ORDER BY created_at DESC LIMIT 1`, [token]);
        if (!evt) {
            res.status(404).json({ error: "Share link not found or expired" });
            return;
        }
        // The shared photo resolver owns the answer, so a public share link can never
        // disagree with what the rider's own app is showing.
        const ride = await (0, database_1.queryOne)(`SELECT r.id, r.status, r.driver_id, r.pickup_address, r.pickup_lat, r.pickup_lng,
              r.destination_address, r.destination_lat, r.destination_lng, r.created_at,
              u.full_name AS driver_name, u.profile_photo_url AS driver_photo_url,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, dp.vehicle_year, NULL::text AS vehicle_image_url, dp.license_plate,
              COALESCE(dp.rating_avg, 0)::float AS driver_rating,
              dp.current_lat AS driver_lat, dp.current_lng AS driver_lng, dp.current_heading AS driver_heading
       FROM rides r
       LEFT JOIN users u ON u.id = r.driver_id
       LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
       WHERE r.id = $1`, [evt.ride_id]);
        if (!ride) {
            res.status(404).json({ error: "Ride not found" });
            return;
        }
        const ended = await (0, database_1.queryOne)(`SELECT EXISTS(SELECT 1 FROM safety_events WHERE ride_id = $1 AND type = 'share_ended') AS ended`, [evt.ride_id]);
        const sharingEnded = !!ended?.ended;
        await (0, vehicleImages_1.attachVehicleImages)(ride);
        res.json({ ride: shareRidePayload(ride, sharingEnded) });
    }
    catch (err) {
        console.error("Share API error:", err);
        res.status(500).json({ error: "Something went wrong" });
    }
});
// GET /share/:token — Public tracking web page
async function sharePage(req, res) {
    const token = String(req.params.token || "");
    // The page is hand-written HTML and can be cached by an intermediary after a
    // bad deploy; always serve the current version so a fixed poller is not hidden
    // behind a stale "Loading your trip…" copy.
    res.set("Cache-Control", "no-store, max-age=0");
    // Helmet's global policy is `script-src 'self'`, which BLOCKS this page's
    // inline poller (and Leaflet from unpkg). The browser then never runs
    // tick(), so every share link sits on "Loading your trip…" forever. This
    // route owns its policy: same-origin API calls + the two CDN assets + the
    // inline bootstrap. No user data is accepted by this page.
    res.set("Content-Security-Policy", [
        "default-src 'self'",
        "base-uri 'self'",
        "font-src 'self' https: data:",
        "form-action 'self'",
        "frame-ancestors 'self'",
        "img-src 'self' data: https:",
        "object-src 'none'",
        "script-src 'self' 'unsafe-inline' https://unpkg.com",
        "script-src-attr 'none'",
        "style-src 'self' https: 'unsafe-inline'",
        "connect-src 'self'",
        "upgrade-insecure-requests",
    ].join("; "));
    res.send(sharePageHtml(token));
}
function sharePageHtml(token) {
    // Same map look as the apps: OSM tiles with the grayscale/contrast filter,
    // unless SHARE_TILE_URL overrides the provider. The public OSM layer is what
    // the apps themselves use; the share page must not fall back to a blank grey
    // box in production.
    const tile = (0, providerSeams_1.shareTileProvider)();
    const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    const tileUrl = tile.url || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
    const tileLayerJs = `L.tileLayer('${tileUrl.replace(/'/g, "%27")}',{maxZoom:19,subdomains:'abc',className:'tile-grayscale',attribution:'${TILE_ATTRIBUTION}'}).addTo(map);`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="theme-color" content="#ffffff">
<title>Vura — Live trip</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
:root{--ink:#161616;--muted:#7c7c7c;--line:#ececec;--soft:#f7f7f7;--brand:#e04e2f;--green:#12805c}
*{box-sizing:border-box;margin:0;padding:0}
html,body{background:#fff}
body{color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;min-height:100vh;-webkit-font-smoothing:antialiased}
.shell{max-width:560px;margin:0 auto;padding:18px 20px 34px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:2px 0 22px}
.brand{height:30px;width:auto;display:block}
.live{display:inline-flex;align-items:center;gap:7px;font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#8a8a8a;white-space:nowrap}
.live-dot{width:6px;height:6px;border-radius:50%;background:var(--brand);box-shadow:0 0 0 4px rgba(224,78,47,.10)}
.live.ended .live-dot{background:#b5b5b5;box-shadow:none}
.status-block{padding:2px 0 20px}
.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:#fff;border-radius:999px;padding:5px 10px;font-size:10.5px;font-weight:800;letter-spacing:.10em;text-transform:uppercase;color:#5f5f5f}
.pill .dot{width:6px;height:6px;border-radius:50%;background:var(--brand);animation:pulse 1.8s ease-in-out infinite}
.pill.done{color:var(--green);border-color:#d7efe5;background:#f4fbf7}
.pill.done .dot{background:var(--green);animation:none}
.pill.ended{color:#8a8a8a;border-color:var(--line);background:#fafafa}
.pill.ended .dot{background:#b5b5b5;animation:none}
h1{font-size:26px;line-height:1.18;letter-spacing:-.02em;font-weight:800;margin-top:14px}
.sub{font-size:13.5px;line-height:1.5;color:var(--muted);margin-top:7px;max-width:430px}
.map-card{position:relative;height:300px;border:1px solid var(--line);border-radius:18px;overflow:hidden;background:var(--soft);margin-bottom:14px}
#map{width:100%;height:100%}
.leaflet-container{background:var(--soft);font:inherit}
.tile-grayscale{filter:grayscale(1) contrast(1.05) brightness(1.03)}
.vura-roam-car-icon{background:transparent!important;border:0!important;transition:transform .8s linear}
.vura-roam-car{width:56px;height:56px;display:flex;align-items:center;justify-content:center;pointer-events:none}
.vura-roam-car img{width:52px;height:52px;object-fit:contain;transform-origin:50% 50%;transition:transform .45s linear;filter:drop-shadow(0 2px 5px rgba(0,0,0,.30))}
.vura-route-pin{background:transparent!important;border:0!important}
.map-note{position:absolute;right:12px;top:12px;z-index:500;background:rgba(255,255,255,.95);border:1px solid var(--line);border-radius:999px;padding:7px 11px;font-size:11px;font-weight:700;color:#6f6f6f;box-shadow:0 4px 14px rgba(0,0,0,.06)}
.card{border:1px solid var(--line);border-radius:18px;background:#fff;padding:16px;margin-bottom:14px}
.card-label{font-size:10.5px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#9a9a9a;margin-bottom:14px}
.driver{display:flex;align-items:center;gap:13px}
.avatar{width:46px;height:46px;border-radius:50%;background:#f3f3f3;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:17px;font-weight:800;color:#8a8a8a}
.avatar img{width:100%;height:100%;object-fit:cover}
.driver-main{min-width:0;flex:1}
.driver-name{display:flex;align-items:center;gap:7px;min-width:0}
.driver-name b{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rating{font-size:10.5px;font-weight:800;color:#a16207;background:#fffbeb;border-radius:999px;padding:2px 7px;flex-shrink:0}
.vehicle{font-size:12.5px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.plate{display:inline-block;margin-top:6px;background:#111;color:#fff;border-radius:5px;padding:2px 7px;font:700 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.5px}
.car-photo{width:66px;height:48px;object-fit:contain;border-radius:9px;background:var(--soft);flex-shrink:0}
.route-row{display:grid;grid-template-columns:18px minmax(0,1fr);gap:12px;position:relative;padding-bottom:22px}
.route-row:last-child{padding-bottom:0}
.route-row:not(:last-child):before{content:"";position:absolute;left:8px;top:16px;bottom:0;width:1px;background:#e6e6e6}
.route-marker{display:flex;justify-content:center;padding-top:3px}
.route-dot{width:12px;height:12px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 1px #d9d9d9;background:#111;flex-shrink:0}
.route-dot.drop{background:var(--brand);box-shadow:0 0 0 1px #f0c9c0}
.route-label{font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#9a9a9a;margin-bottom:4px}
.route-address{font-size:14.5px;line-height:1.45;font-weight:650;color:var(--ink);overflow-wrap:anywhere}
.footer{text-align:center;padding:12px 0 0;color:#a3a3a3;font-size:11px;line-height:1.6}
.load{display:flex;align-items:center;justify-content:center;gap:9px;height:62vh;color:var(--muted);font-size:13px}
.spinner{width:15px;height:15px;border:2px solid #e6e6e6;border-top-color:var(--brand);border-radius:50%;animation:spin .8s linear infinite}
.err-card{padding:24px;text-align:center}
.err-card h2{font-size:19px;letter-spacing:-.01em;margin-bottom:8px}
.err-card p{color:var(--muted);font-size:13px;line-height:1.5}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes spin{to{transform:rotate(360deg)}}
@media (max-width:420px){.shell{padding:14px 16px 28px}.brand{height:27px}h1{font-size:23px}.map-card{height:260px}.car-photo{width:56px;height:42px}}
</style>
</head>
<body>
<div id="app"><div class="load"><span class="spinner"></span>Loading your trip…</div></div>

<script>
(function(){
  var token = ${JSON.stringify(token)};
  var app = document.getElementById('app');
  var map = null;
  var carMarker = null, routeLine = null, routeCasing = null;
  var timer = null;
  var PICKUP = [ -26.2041, 28.0473 ];
  var DROPOFF = [ -26.2041, 28.0473 ];

  function el(html){ var d=document.createElement('div'); d.innerHTML=html; return d.firstElementChild; }

  function statusText(s){
    switch(s){
      case 'searching': return 'Finding your driver';
      case 'accepted': return 'Driver on the way';
      case 'driver_arrived': return 'Driver has arrived';
      case 'in_progress': return 'Trip in progress';
      case 'completed': return 'Trip is done';
      case 'cancelled': return 'Trip cancelled';
      case 'expired': return 'Trip ended';
      default: return s || 'Live trip';
    }
  }

  function isDone(r){ return r && (r.tripDone === true || String(r.status||'').toLowerCase() === 'completed'); }
  function isCancelled(r){ var s=String((r&&r.status)||'').toLowerCase(); return s==='cancelled'||s==='expired'; }
  function isFinal(r){ return isDone(r) || isCancelled(r) || (r && r.sharingEnded === true); }

  function statusSub(r){
    if(isDone(r)) return 'This trip has ended. Live location sharing is off.';
    if(r && r.sharingEnded) return 'The rider has stopped sharing live location.';
    if(isCancelled(r)) return 'This trip was cancelled. Live location sharing is off.';
    return 'Live location shared by your rider. Updates automatically.';
  }

  function statusPill(r){
    if(isDone(r)) return '<span class="pill done"><span class="dot"></span>Completed</span>';
    if(r && r.sharingEnded) return '<span class="pill ended"><span class="dot"></span>Sharing ended</span>';
    if(isCancelled(r)) return '<span class="pill ended"><span class="dot"></span>Cancelled</span>';
    return '<span class="pill"><span class="dot"></span>Live</span>';
  }

  function driverCard(r){
    if(!r.hasDriver) return '';
    var initial = String(r.driverName || 'V').trim().charAt(0).toUpperCase();
    var photo = r.driverPhotoUrl
      ? '<img src="' + escapeHtml(r.driverPhotoUrl) + '" alt="">'
      : escapeHtml(initial);
    var carImg = '<img class="car-photo" src="' + escapeHtml(r.vehicleImageUrl || '${shareCarIcon_1.CAR_ICON_DATA_URI}') + '" alt="">';
    var rating = Number(r.driverRating) > 0
      ? '<span class="rating">\\u2605 ' + Number(r.driverRating).toFixed(1) + '</span>'
      : '';
    var plate = r.licensePlate
      ? '<span class="plate">' + escapeHtml(r.licensePlate) + '</span>'
      : '';
    return '<div class="card">' +
      '<div class="card-label">Your driver</div>' +
      '<div class="driver">' +
        '<div class="avatar">' + photo + '</div>' +
        '<div class="driver-main">' +
          '<div class="driver-name"><b>' + escapeHtml(r.driverName) + '</b>' + rating + '</div>' +
          '<div class="vehicle">' + escapeHtml(vehicleText(r)) + '</div>' +
          plate +
        '</div>' +
        carImg +
      '</div>' +
    '</div>';
  }

  function routeCard(r){
    var from = r.pickupAddress || 'Pickup location not provided';
    var to = r.destinationAddress || 'Drop-off location not provided';
    return '<div class="card">' +
      '<div class="card-label">Trip route</div>' +
      '<div class="route-row">' +
        '<div class="route-marker"><span class="route-dot"></span></div>' +
        '<div><div class="route-label">Pickup</div><div class="route-address">' + escapeHtml(from) + '</div></div>' +
      '</div>' +
      '<div class="route-row">' +
        '<div class="route-marker"><span class="route-dot drop"></span></div>' +
        '<div><div class="route-label">Drop-off</div><div class="route-address">' + escapeHtml(to) + '</div></div>' +
      '</div>' +
    '</div>';
  }

  function buildCard(r){
    var final = isFinal(r);
    var over = isDone(r) || isCancelled(r);
    var liveLabel = over ? 'Trip summary' : (r.sharingEnded ? 'Sharing ended' : 'Live trip');
    var note = final ? '<div class="map-note">Live location sharing is off</div>' : '';
    return '<div class="shell">' +
      '<div class="topbar">' +
        '<img class="brand" src="/api/share/logo.png" alt="Vura">' +
        '<span class="live' + (final ? ' ended' : '') + '"><span class="live-dot"></span>' + liveLabel + '</span>' +
      '</div>' +
      '<section class="status-block">' +
        statusPill(r) +
        '<h1>' + escapeHtml(statusText(r.status)) + '</h1>' +
        '<p class="sub">' + escapeHtml(statusSub(r)) + '</p>' +
      '</section>' +
      '<div class="map-card"><div id="map"></div>' + note + '</div>' +
      driverCard(r) +
      routeCard(r) +
      '<div class="footer">Shared securely with Vura<br>ridevura.com</div>' +
    '</div>';
  }

  function vehicleText(r){
    var parts=[];
    if(r.vehicleMake) parts.push(r.vehicleMake);
    if(r.vehicleModel) parts.push(r.vehicleModel);
    if(r.vehicleColor) parts.push(r.vehicleColor);
    return parts.length ? parts.join(' · ') : 'Private driver';
  }

  function escapeHtml(s){
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function initMap(r){
    var finished = isFinal(r);
    var hasPickup = r.pickup && r.pickup.length===2;
    var hasDrop = r.destination && r.destination.length===2;
    var hasDriver = !finished && r.driverLat!=null && r.driverLng!=null;
    // Center on pickup if we have it, else the destination, else the driver's
    // live location. A finished trip never centres on the driver.
    var center = null;
    if(hasPickup) center = r.pickup;
    else if (hasDrop) center = r.destination;
    else if (hasDriver) center = [r.driverLat, r.driverLng];
    else return;
    PICKUP = hasPickup ? r.pickup : center;
    DROPOFF = hasDrop ? r.destination : r.pickup || center;
    map = L.map('map',{zoomControl:true,attributionControl:true,preferCanvas:true,zoomSnap:0.5})
      .setView([center[0],center[1]], 14);
    ${tileLayerJs}
    // The same pickup dot + red drop-off pin the rider/driver map draws.
    if(hasPickup){
      var pickupIcon = L.divIcon({
        className:'vura-route-pin',
        html:'<div style="width:22px;height:22px;border-radius:9999px;background:#111;border:4px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>',
        iconSize:[22,22], iconAnchor:[11,11]
      });
      L.marker([PICKUP[0],PICKUP[1]],{icon:pickupIcon,interactive:false,keyboard:false,zIndexOffset:650}).addTo(map);
    }
    if(hasDrop){
      var dropIcon = L.divIcon({
        className:'vura-route-pin',
        html:'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40"><path d="M16 0C7.2 0 0 7.2 0 16c0 11.5 16 24 16 24s16-12.5 16-24C32 7.2 24.8 0 16 0z" fill="#EA4335"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg>',
        iconSize:[32,40], iconAnchor:[16,40]
      });
      L.marker([DROPOFF[0],DROPOFF[1]],{icon:dropIcon,interactive:false,keyboard:false,zIndexOffset:640}).addTo(map);
    }
    if (hasDriver) setCar(Number(r.driverLat), Number(r.driverLng), r.driverHeading);
    var bounds = [];
    if(hasPickup) bounds.push(PICKUP);
    if(hasDrop) bounds.push(DROPOFF);
    if(hasDriver) bounds.push([Number(r.driverLat),Number(r.driverLng)]);
    if(bounds.length >= 2){ try{ map.fitBounds(L.latLngBounds(bounds),{padding:[48,48],maxZoom:16}); }catch(e){} }
    else if (hasDriver){ try{ map.setView([Number(r.driverLat),Number(r.driverLng)], 16); }catch(e){} }
    loadRoute();
  }

  // The exact roam-car image used by the app map, rotated to the live heading.
  var carAnim = { lat: null, lng: null, heading: null };
  function bearingBetween(lat1,lng1,lat2,lng2){
    var toRad = function(d){ return d*Math.PI/180; };
    var p1=toRad(lat1), p2=toRad(lat2), dl=toRad(lng2-lng1);
    var y=Math.sin(dl)*Math.cos(p2);
    var x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);
    return (Math.atan2(y,x)*180/Math.PI+360)%360;
  }
  function setCar(lat,lng,heading){
    if(!map) return;
    var h = (typeof heading === 'number' && isFinite(heading)) ? Number(heading) : null;
    if(carAnim.lat != null && h == null) h = bearingBetween(carAnim.lat, carAnim.lng, lat, lng);
    if(h != null) carAnim.heading = h;
    carAnim.lat = lat; carAnim.lng = lng;
    if(!carMarker){
      var icon = L.divIcon({
        className:'vura-roam-car-icon',
        html:'<div class="vura-roam-car"><img src="${shareCarIcon_1.CAR_ICON_DATA_URI}" alt="" draggable="false"/></div>',
        iconSize:[56,56], iconAnchor:[28,28]
      });
      carMarker = L.marker([lat,lng],{icon:icon,interactive:false,keyboard:false,zIndexOffset:1000}).addTo(map);
    } else {
      carMarker.setLatLng([lat,lng]);
    }
    var el = carMarker.getElement && carMarker.getElement();
    var img = el && el.querySelector('img');
    if(img && carAnim.heading != null) img.style.transform = 'rotate(' + carAnim.heading.toFixed(1) + 'deg)';
  }

  function removeCar(){
    if(carMarker && map){ try{ map.removeLayer(carMarker); }catch(e){} }
    carMarker = null;
    carAnim = { lat: null, lng: null, heading: null };
  }

  function loadRoute(){
    if(!map || !PICKUP || !DROPOFF) return;
    if(Math.abs(DROPOFF[0]-PICKUP[0])<1e-9 && Math.abs(DROPOFF[1]-PICKUP[1])<1e-9) return;
    var pts = DROPOFF[1]+','+DROPOFF[0]+';'+PICKUP[1]+','+PICKUP[0];
    fetch('/api/route?points='+encodeURIComponent(pts)+'&overview=full')
      .then(function(res){ return res.json(); })
      .then(function(data){
        var coords = data && data.routes && data.routes[0] && data.routes[0].geometry && data.routes[0].geometry.coordinates;
        if(!coords || !coords.length) return;
        var latlngs = coords.map(function(c){ return [c[1],c[0]]; });
        if(routeCasing){ map.removeLayer(routeCasing); routeCasing = null; }
        if(routeLine){ map.removeLayer(routeLine); routeLine = null; }
        // The app's map draws a white casing under a Vura-blue line.
        routeCasing = L.polyline(latlngs,{color:'#FFFFFF',weight:9,opacity:.95,lineCap:'round',lineJoin:'round'}).addTo(map);
        routeLine = L.polyline(latlngs,{color:'#2563EB',weight:5,opacity:1,lineCap:'round',lineJoin:'round'}).addTo(map);
      })
      .catch(function(){});
  }

  function updateCar(r){
    if(!map) return;
    if(isFinal(r)){ removeCar(); return; }
    if(r.driverLat!=null && r.driverLng!=null){
      setCar(Number(r.driverLat), Number(r.driverLng), r.driverHeading);
    }
  }

  function updateMapNote(r){
    var card = document.querySelector('.map-card');
    if(!card) return;
    var note = card.querySelector('.map-note');
    if(isFinal(r)){
      if(!note) card.insertAdjacentHTML('beforeend','<div class="map-note">Live location sharing is off</div>');
    } else if(note){ note.remove(); }
  }

  function updateStatus(r){
    var block = document.querySelector('.status-block');
    if(!block) return;
    block.innerHTML = statusPill(r) +
      '<h1>' + escapeHtml(statusText(r.status)) + '</h1>' +
      '<p class="sub">' + escapeHtml(statusSub(r)) + '</p>';
  }

  function updateTopbar(r){
    var live = document.querySelector('.live');
    if(!live) return;
    var final = isFinal(r);
    var over = isDone(r) || isCancelled(r);
    var label = over ? 'Trip summary' : (r.sharingEnded ? 'Sharing ended' : 'Live trip');
    live.className = 'live' + (final ? ' ended' : '');
    live.innerHTML = '<span class="live-dot"></span>' + label;
  }

  function updateTitle(r){
    document.title = isDone(r)
      ? 'Vura — Trip completed'
      : isCancelled(r)
        ? 'Vura — Trip ended'
        : (r.sharingEnded ? 'Vura — Sharing ended' : 'Vura — Live trip');
  }

  var first = true;
  var failedCount = 0;

  function stopPolling(){
    if(timer){ clearInterval(timer); timer = null; }
  }

  function tick(){
    fetch('/api/share/'+token)
      .then(function(res){ if(!res.ok) throw new Error('nf'); return res.json(); })
      .then(function(data){
        failedCount = 0;
        var r = data.ride;
        updateTitle(r);
        if(first){
          first = false;
          app.innerHTML = buildCard(r);
          // Leaflet is loaded from a CDN. If that CDN is blocked, the trip card
          // above must still be usable — a map failure must not send us into the
          // .catch() that replaces the whole page with "link isn't available".
          try { initMap(r); } catch (e) { /* keep the card without the map */ }
        } else {
          updateTopbar(r);
          updateStatus(r);
          updateMapNote(r);
        }
        updateCar(r);
        // A completed/cancelled trip is a permanent summary: keep it on screen
        // exactly as it is and stop asking for updates. A rider who only stopped
        // live sharing mid-trip keeps the page polling (with no coordinates)
        // until the trip actually completes, so the link still ends on
        // "Trip is done" instead of freezing on the old status.
        if(isDone(r) || isCancelled(r)) stopPolling();
      })
      .catch(function(){
        failedCount++;
        if(first && failedCount >= 4){
          first = false;
          app.innerHTML = '<div class="shell">' +
            '<div class="topbar"><img class="brand" src="/api/share/logo.png" alt="Vura"></div>' +
            '<div class="card err-card"><h2>This trip link isn\\'t available</h2><p>Ask the rider for a new link or open the trip in the Vura app.</p></div>' +
          '</div>';
        }
      });
  }

  // START the poller. This call was missing: the page rendered its
  // "Loading your trip…" placeholder and never called tick(), so every share
  // link stayed on that spinner forever even though the API had the ride.
  tick();
  timer = setInterval(tick, 3000);
})();

</script>
</body>
</html>`;
}
exports.default = router;
//# sourceMappingURL=share.js.map
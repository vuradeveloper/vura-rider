"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sharePage = sharePage;
const express_1 = require("express");
const database_1 = require("../config/database");
const vehicleImages_1 = require("../services/vehicleImages");
const shareCarIcon_1 = require("./shareCarIcon");
const router = (0, express_1.Router)();
const providerSeams_1 = require("../services/providerSeams");
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
        const ride = await (0, database_1.queryOne)(`SELECT r.id, r.status, r.pickup_address, r.pickup_lat, r.pickup_lng,
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
        await (0, vehicleImages_1.attachVehicleImages)(ride);
        res.json({
            ride: {
                id: ride.id,
                status: ride.status,
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
                driverLat: ride.driver_lat != null ? Number(ride.driver_lat) : null,
                driverLng: ride.driver_lng != null ? Number(ride.driver_lng) : null,
                driverHeading: ride.driver_heading != null ? Number(ride.driver_heading) : null,
                sharingEnded: !!ended?.ended,
            },
        });
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
<title>Vura Ride — Live Trip</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  *{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  body{background:#fff;color:#2e1e1a;min-height:100vh}
  .header{background:linear-gradient(135deg,#e04e2f,#c13a1e);color:#fff;padding:22px 20px 26px;border-radius:0 0 24px 24px}
  .header h1{font-size:19px;font-weight:800;line-height:1.3}
  .header p{font-size:13px;opacity:.9;margin-top:4px}
  .status{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.18);border-radius:999px;padding:5px 12px;font-size:12px;font-weight:700;margin-top:12px}
  .status .dot{width:8px;height:8px;border-radius:50%;background:#4ade80;animation:pulse 1.6s infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
  .map-wrap{height:42vh;min-height:240px;width:100%;position:relative}
  #map{width:100%;height:100%}
  .leaflet-container{background:#f8f9fa}
  .tile-grayscale{filter:grayscale(1) contrast(1.08) brightness(1.02)}
  .vura-roam-car-icon{background:transparent!important;border:0!important;transition:transform .8s linear}
  .vura-roam-car{width:56px;height:56px;display:flex;align-items:center;justify-content:center;pointer-events:none}
  .vura-roam-car img{width:52px;height:52px;object-fit:contain;transform-origin:50% 50%;transition:transform .45s linear;filter:drop-shadow(0 2px 5px rgba(0,0,0,.30))}
  .vura-route-pin{background:transparent!important;border:0!important}
  .driver-card{display:flex;align-items:center;gap:14px;padding:16px 20px;border-bottom:1px solid #f1ebe7}
  .avatar{width:46px;height:46px;border-radius:50%;background:#fdeeea;display:flex;align-items:center;justify-content:center;font-size:20px;overflow:hidden;flex-shrink:0}
  .avatar img{width:100%;height:100%;object-fit:cover}
  .driver-main{min-width:0;flex:1}
  .driver-name{display:flex;align-items:center;gap:6px;min-width:0}
  .driver-name b{font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .rating{font-size:11px;font-weight:700;color:#b26a00;background:#fff7e6;border-radius:999px;padding:2px 6px;flex-shrink:0}
  .driver-card span{font-size:12.5px;color:#80716b;display:block}
  .plate{display:inline-block;margin-top:5px;background:#111;color:#fff;border-radius:6px;padding:2px 7px;font:700 11.5px/1.2 ui-monospace,monospace;letter-spacing:.5px;width:max-content}
  .car-photo{width:74px;height:54px;object-fit:contain;border-radius:8px;background:#f7f7f7;flex-shrink:0}
  .info{display:flex;justify-content:space-between;align-items:center;padding:16px 20px}
  .info .big{font-size:13px;color:#80716b}
  .info .eta{font-size:24px;font-weight:800}
  .addr{padding:4px 20px 8px;display:flex;align-items:flex-start;gap:10px}
  .addr .pin{width:10px;height:10px;border-radius:50%;margin-top:5px;flex-shrink:0}
  .addr b{font-size:14px;display:block}
  .addr span{font-size:12.5px;color:#80716b}
  .footer{text-align:center;padding:18px;color:#b7a49b;font-size:11.5px}
  .ended-banner{background:#dc2626;color:#fff;text-align:center;padding:12px;font-weight:700;font-size:14px}
  .load{display:flex;align-items:center;justify-content:center;height:60vh;color:#80716b;font-size:14px}
  .err{padding:40px 24px;text-align:center}
  .err h2{font-size:18px;margin-bottom:8px}
  .err p{color:#80716b;font-size:13px}
</style>
</head>
<body>
<div id="app"><div class="load">Loading your trip…</div></div>

<script>
(function(){
  var token = ${JSON.stringify(token)};
  var app = document.getElementById('app');
  var map = null;
  var carMarker = null, routeLine = null, routeCasing = null;
  var PICKUP = [ -26.2041, 28.0473 ];
  var DROPOFF = [ -26.2041, 28.0473 ];

  function el(html){ var d=document.createElement('div'); d.innerHTML=html; return d.firstElementChild; }

  function statusText(s){
    switch(s){
      case 'searching': return 'Finding your driver';
      case 'accepted': return 'Driver on the way';
      case 'driver_arrived': return 'Driver has arrived';
      case 'in_progress': return 'Trip in progress';
      case 'completed': return 'Trip completed';
      case 'cancelled': return 'Trip cancelled';
      default: return s || 'Active trip';
    }
  }

  function buildCard(r){
    var ended = r.sharingEnded;
    var photo = r.driverPhotoUrl
      ? '<img src="' + escapeHtml(r.driverPhotoUrl) + '" alt="">'
      : '🚗';
    var carImg = '<img class="car-photo" src="' + escapeHtml(r.vehicleImageUrl || '${shareCarIcon_1.CAR_ICON_DATA_URI}') + '" alt="">';
    var rating = Number(r.driverRating) > 0
      ? '<span class="rating">★ ' + Number(r.driverRating).toFixed(1) + '</span>'
      : '';
    var plate = r.licensePlate
      ? '<span class="plate">' + escapeHtml(r.licensePlate) + '</span>'
      : '';
    return '<div class="header">' +
      '<h1>I\\'m on a Vura ride!<br>Track my trip live</h1>' +
      '<p>Live location shared by your rider</p>' +
      (ended
        ? '<div class="status" style="background:#dc2626"><span>Sharing ended</span></div>'
        : '<div class="status"><span class="dot"></span><span>' + statusText(r.status) + '</span></div>') +
      '</div>' +
      (ended ? '<div class="ended-banner">This rider has stopped sharing their trip.</div>' : '') +
      '<div class="map-wrap"><div id="map"></div></div>' +
      '<div class="driver-card">' +
        '<div class="avatar">' + photo + '</div>' +
        '<div class="driver-main">' +
          '<div class="driver-name"><b>' + escapeHtml(r.driverName) + '</b>' + rating + '</div>' +
          '<span>' + escapeHtml(vehicleText(r)) + '</span>' +
          plate +
        '</div>' +
        carImg +
      '</div>' +
      '<div class="info"><div><div class="big">Ride from</div><div class="addr"><div class="pin" style="background:#22c55e"></div><div><b>' + escapeHtml(r.pickupAddress||'Pickup') + '</b></div></div></div></div>' +
      '<div class="addr" style="margin-top:-12px"><div class="pin" style="background:#ef4444"></div><div><b>' + escapeHtml(r.destinationAddress||'Destination') + '</b></div></div>' +
      '<div class="footer">Vura Ride • Powered by Ridevura</div>';
  }

  function vehicleText(r){
    var parts=[];
    if(r.vehicleMake) parts.push(r.vehicleMake);
    if(r.vehicleModel) parts.push(r.vehicleModel);
    if(r.vehicleColor) parts.push(r.vehicleColor);
    return parts.length ? parts.join(' • ') : 'Private driver';
  }

  function escapeHtml(s){
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function initMap(r){
    var hasPickup = r.pickup && r.pickup.length===2;
    var hasDrop = r.destination && r.destination.length===2;
    var hasDriver = r.driverLat!=null && r.driverLng!=null;
    // Center on pickup if we have it, else the driver's live location, else the
    // destination — so the trip ALWAYS renders even mid-search / pre-driver.
    var center = null;
    if(hasPickup) center = r.pickup;
    else if (hasDriver) center = [r.driverLat, r.driverLng];
    else if (hasDrop) center = r.destination;
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
    if(r.driverLat!=null && r.driverLng!=null){
      setCar(Number(r.driverLat), Number(r.driverLng), r.driverHeading);
    }
  }

var first = true;
  var failedCount = 0;
  function tick(){
    fetch('/api/share/'+token)
      .then(function(res){ if(!res.ok) throw new Error('nf'); return res.json(); })
      .then(function(data){
        failedCount = 0;
        var r = data.ride;
        if(first){
          first = false;
          app.innerHTML = buildCard(r);
          // Leaflet is loaded from a CDN. If that CDN is blocked, the trip card
          // above must still be usable — a map failure must not send us into the
          // .catch() that replaces the whole page with "link isn't available".
          try { initMap(r); } catch (e) { /* keep the card without the map */ }
        } else {
          var st = document.querySelector('.status');
          if(st && !r.sharingEnded){ st.innerHTML = '<span class="dot"></span><span>'+statusText(r.status)+'</span>'; }
          if(r.sharingEnded && !document.querySelector('.ended-banner')){
            var hdr = document.querySelector('.header');
            if(hdr){ hdr.insertAdjacentHTML('beforeend','<div class="ended-banner" style="border-radius:12px;margin-top:12px">This rider has stopped sharing their trip.</div>'); }
            var st2=document.querySelector('.status'); if(st2){ st2.style.background='#dc2626'; st2.innerHTML='<span>Sharing ended</span>'; }
          }
        }
        updateCar(r);
      })
      .catch(function(){
        failedCount++;
        if(first && failedCount >= 4){
          first = false;
          app.innerHTML = '<div class="err"><h2>This trip link isn\\'t available</h2><p>The share link may have expired or the trip has ended.</p></div>';
        }
      });
  }

  // START the poller. This call was missing: the page rendered its
  // "Loading your trip…" placeholder and never called tick(), so every share
  // link stayed on that spinner forever even though the API had the ride.
  tick();
  setInterval(tick, 3000);
})();

</script>
</body>
</html>`;
}
exports.default = router;
//# sourceMappingURL=share.js.map
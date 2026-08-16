import { Router, Request, Response } from "express";
import { query, queryOne } from "../config/database";

const router = Router();

// GET /api/share/:token — Public live-trip tracking data (no auth). The token
// was stored in safety_events when the rider pressed "Share trip".
router.get("/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const evt = await queryOne<{ ride_id: string }>(
      `SELECT ride_id FROM safety_events
       WHERE type = 'share_started' AND data->>'shareToken' = $1
       ORDER BY created_at DESC LIMIT 1`,
      [token]
    );
    if (!evt) {
      res.status(404).json({ error: "Share link not found or expired" });
      return;
    }

    const ride = await queryOne<any>(
      `SELECT r.id, r.status, r.pickup_address, r.pickup_lat, r.pickup_lng,
              r.destination_address, r.destination_lat, r.destination_lng, r.created_at,
              u.full_name AS driver_name,
              dp.vehicle_make, dp.vehicle_model, dp.vehicle_color, dp.license_plate,
              dp.current_lat AS driver_lat, dp.current_lng AS driver_lng, dp.current_heading AS driver_heading
       FROM rides r
       LEFT JOIN users u ON u.id = r.driver_id
       LEFT JOIN driver_profiles dp ON dp.user_id = r.driver_id
       WHERE r.id = $1`,
      [evt.ride_id]
    );

    if (!ride) {
      res.status(404).json({ error: "Ride not found" });
      return;
    }

    const ended = await queryOne<{ ended: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM safety_events WHERE ride_id = $1 AND type = 'share_ended') AS ended`,
      [evt.ride_id]
    );

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
        vehicleMake: ride.vehicle_make,
        vehicleModel: ride.vehicle_model,
        vehicleColor: ride.vehicle_color,
        licensePlate: ride.license_plate,
        driverLat: ride.driver_lat != null ? Number(ride.driver_lat) : null,
        driverLng: ride.driver_lng != null ? Number(ride.driver_lng) : null,
        driverHeading: ride.driver_heading != null ? Number(ride.driver_heading) : null,
        sharingEnded: !!ended?.ended,
      },
    });
  } catch (err: any) {
    console.error("Share API error:", err);
    res.status(500).json({ error: "Something went wrong" });
  }
});

// GET /share/:token — Public tracking web page
export async function sharePage(req: Request, res: Response) {
  const token = String(req.params.token || "");
  res.send(sharePageHtml(token));
}

function sharePageHtml(token: string): string {
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
  .driver-card{display:flex;align-items:center;gap:14px;padding:16px 20px;border-bottom:1px solid #f1ebe7}
  .avatar{width:46px;height:46px;border-radius:50%;background:#fdeeea;display:flex;align-items:center;justify-content:center;font-size:20px}
  .driver-card b{font-size:15px;display:block}
  .driver-card span{font-size:12.5px;color:#80716b}
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
  var carMarker = null, routeLine = null;
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
        '<div class="avatar">🚗</div>' +
        '<div><b>' + escapeHtml(r.driverName) + '</b>' +
        '<span>' + escapeHtml(vehicleText(r)) + '</span></div>' +
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
    if(r.licensePlate) parts.push(r.licensePlate);
    return parts.length ? parts.join(' • ') : 'Private driver';
  }

  function escapeHtml(s){
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function initMap(r){
    var hasPickup = r.pickup && r.pickup.length===2;
    var hasDrop = r.destination && r.destination.length===2;
    if(!hasPickup) return;
    PICKUP = r.pickup; DROPOFF = hasDrop ? r.destination : r.pickup;
    var center = PICKUP;
    map = L.map('map',{zoomControl:true,attributionControl:true}).setView([center[0],center[1]], 13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map);
    L.marker([PICKUP[0],PICKUP[1]],{icon:L.divIcon({html:'<div style="background:#22c55e;width:22px;height:22px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fff">P</div>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(map);
    if(hasDrop && !(Math.abs(DROPOFF[0]-PICKUP[0])<1e-9 && Math.abs(DROPOFF[1]-PICKUP[1])<1e-9)){
      L.marker([DROPOFF[0],DROPOFF[1]],{icon:L.divIcon({html:'<div style="background:#ef4444;width:22px;height:22px;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fff">D</div>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(map);
    }
    carMarker = L.marker([PICKUP[0],PICKUP[1]],{icon:L.divIcon({html:'<div style="width:30px;height:30px;background:#1a1a1a;border-radius:50%;border:3px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3)">🚗</div>',iconSize:[30,30],iconAnchor:[15,15]})}).addTo(map);
    // Fit both points
    if(hasDrop){ try{ map.fitBounds(L.latLngBounds([PICKUP,DROPOFF]),{padding:[40,40]}); }catch(e){} }
    loadRoute();
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
        if(routeLine){ map.removeLayer(routeLine); }
        routeLine = L.polyline(latlngs,{color:'#e04e2f',weight:5,opacity:.85,lineCap:'round',lineJoin:'round'}).addTo(map);
      })
      .catch(function(){});
  }

  function updateCar(r){
    if(!map || !carMarker) return;
    if(r.driverLat!=null && r.driverLng!=null){
      carMarker.setLatLng([r.driverLat,r.driverLng]);
      if(r.driverHeading!=null){
        var el2=carMarker.getElement();
        if(el2){ el2.style.transition='transform .3s linear'; }
      }
    }
  }

  var first = true;
  function tick(){
    fetch('/api/share/'+token)
      .then(function(res){ if(!res.ok) throw new Error('nf'); return res.json(); })
      .then(function(data){
        var r = data.ride;
        if(first){
          first = false;
          app.innerHTML = buildCard(r);
          initMap(r);
        } else {
          // update status text + ended banner if changed
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
        if(first){
          first = false;
          app.innerHTML = '<div class="err"><h2>This trip link isn\\'t available</h2><p>The share link may have expired or the trip has ended.</p></div>';
        }
      });
  }

  tick();
  setInterval(tick, 3000);
})();
</script>
</body>
</html>`;
}

export default router;

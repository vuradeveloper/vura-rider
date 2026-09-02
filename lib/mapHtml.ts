// Leaflet is bundled INSIDE the app (lib/leafletBundle.ts) so maps appear
// instantly on cold start — no CDN download wait. The CDN list is only used
// as a fallback if the bundled copy ever fails to evaluate.
import { LEAFLET_JS, LEAFLET_CSS } from "./leafletBundle";

let cachedHtml: string | null = null;

export function getMapHtml(): string {
  if (cachedHtml) return cachedHtml;
  cachedHtml = buildMapHtml();
  return cachedHtml;
}

// Same tile-caching trick used by the web build: tiles are fetched via XHR,
// stored in localStorage as data URLs and reused on the next visit so repeat
// maps load instantly and use far less mobile data. The cache is capped so it
// can never fill storage and break other data (e.g. recent searches).
const TILE_CACHE_JS = `
function storeTile(url,dataUrl){
  try{
    var n=0, del=[];
    for(var i=0;i<localStorage.length;i++){
      var k=localStorage.key(i);
      if(k && k.indexOf('vura:tile:')===0){ n++; if(n>250) del.push(k); }
    }
    for(var j=0;j<del.length;j++){ try{ localStorage.removeItem(del[j]); }catch(e){} }
    localStorage.setItem('vura:tile:'+url,dataUrl);
  }catch(e){}
}
function createCachedTileLayer(tpl,opts){
  var L=window.L;
  var CacheLayer=L.TileLayer.extend({
    createTile:function(coords,done){
      var url=this.getTileUrl(coords);
      var cached=null;
      try{ cached=localStorage.getItem('vura:tile:'+url); }catch(e){}
      var img=document.createElement('img');
      img.style.width=img.style.height='256px';
      var finish=function(){ done(null,img); };
      var fail=function(){ done('error'); };
      if(cached){ img.onload=finish; img.onerror=fail; img.src=cached; return img; }
      var xhr=new XMLHttpRequest();
      xhr.open('GET',url,true);
      xhr.responseType='blob';
      xhr.onload=function(){
        if(xhr.status!==200){ fail(); return; }
        var fr=new FileReader();
        fr.onload=function(){
          var dataUrl=fr.result;
          storeTile(url,dataUrl);
          img.onload=finish; img.onerror=fail; img.src=dataUrl;
        };
        fr.readAsDataURL(xhr.response);
      };
      xhr.onerror=fail;
      xhr.send();
      return img;
    }
  });
  return new CacheLayer(tpl,{maxZoom:19,subdomains:opts&&opts.subdomains||'abc',detectRetina:opts&&opts.detectRetina||false,maxNativeZoom:opts&&opts.maxNativeZoom||19,className:opts&&opts.className||'',attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'});
}
`;

const MAP_BODY_JS = `
(function(){
  var map=null, markerLayers={}, polylineLayers={};
  var smoothBearing=0;
  function post(obj){ if(window.ReactNativeWebView){ window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } }

  var IMG_MAP={}, anims={};
  var DURATION=1900;

  function bearingDeg(lat1,lng1,lat2,lng2){
    var dLng=(lng2-lng1)*Math.PI/180;
    var la1=lat1*Math.PI/180, la2=lat2*Math.PI/180;
    var y=Math.sin(dLng)*Math.cos(la2);
    var x=Math.cos(la1)*Math.sin(la2)-Math.sin(la1)*Math.cos(la2)*Math.cos(dLng);
    var b=Math.atan2(y,x)*180/Math.PI;
    return (b+360)%360;
  }
  function rotateMarker(layer,deg){
    var el=layer.getElement();
    if(!el || !el.firstElementChild) return;
    el.firstElementChild.style.transform='rotate('+deg+'deg)';
  }
  // Smoothly moves a marker from its current position to a new one.
  function animTo(key,layer,toLat,toLng,deg,duration){
    var cur=layer.getLatLng();
    var fromLat=cur.lat, fromLng=cur.lng;
    var start=null;
    function step(ts){
      if(start===null) start=ts;
      var t=Math.min(1,(ts-start)/duration);
      layer.setLatLng([fromLat+(toLat-fromLat)*t, fromLng+(toLng-fromLng)*t]);
      if(deg!==null && deg!==undefined){ rotateMarker(layer,deg); }
      if(t<1){ anims[key]=requestAnimationFrame(step); }
      else { delete anims[key]; }
    }
    if(anims[key]){ cancelAnimationFrame(anims[key]); }
    anims[key]=requestAnimationFrame(step);
  }

  function buildIcon(p){
    var imgUrl = p.imgKey ? (IMG_MAP[p.imgKey]||'') : (p.imgUrl||'');
    if(p.icon==='car'){
      if(imgUrl){ return L.divIcon({ html:'<img src="'+imgUrl+'" />', className:'car-img-m', iconSize:[48,48], iconAnchor:[24,24] }); }
      return L.divIcon({ html:'<div><svg viewBox="0 0 24 24"><path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/></svg></div>', className:'car-svg-m', iconSize:[36,36], iconAnchor:[18,18] });
    }
    if(p.icon==='pickup'){ return L.divIcon({ html:'<div style="background:#22c55e">P</div>', className:'pin-m', iconSize:[28,28], iconAnchor:[14,14] }); }
    if(p.icon==='dropoff'){ return L.divIcon({ html:'<div style="background:#ef4444">D</div>', className:'pin-m', iconSize:[28,28], iconAnchor:[14,14] }); }
    if(p.icon==='entrance'){ return L.divIcon({ html:'<div></div>', className:'ent-m', iconSize:[14,14], iconAnchor:[7,7] }); }
    if(p.icon==='entrance-sel'){ return L.divIcon({ html:'<div></div>', className:'ent-sel-m', iconSize:[16,16], iconAnchor:[8,8] }); }
    if(p.icon==='you'){ return L.divIcon({ html:'<div></div>', className:'you-m', iconSize:[16,16], iconAnchor:[8,8] }); }
    return L.divIcon({ html:'<div></div>', className:'usr-m', iconSize:[14,14], iconAnchor:[7,7] });
  }

  function init(region){
    if(map) return;
    var latD=region.latitudeDelta||0.05, lngD=region.longitudeDelta||0.05;
    var zoom=Math.max(10, Math.min(18, Math.round(Math.log2(360/Math.max(latD,lngD)))+1));
    map=L.map('map',{zoomControl:true,attributionControl:true}).setView([region.latitude,region.longitude],zoom);
    createCachedTileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{subdomains:'abc',detectRetina:false,maxNativeZoom:19,className:'tile-grayscale'}).addTo(map);
    map.on('move',function(){ if(!map)return; var c=map.getCenter(),b=map.getBounds(); post({type:'regionChange',latitude:c.lat,longitude:c.lng,latitudeDelta:Math.abs(b.getNorth()-b.getSouth()),longitudeDelta:Math.abs(b.getEast()-b.getWest())}); });
    map.on('moveend',function(){ if(!map)return; var c=map.getCenter(),b=map.getBounds(); post({type:'regionChangeComplete',latitude:c.lat,longitude:c.lng,latitudeDelta:Math.abs(b.getNorth()-b.getSouth()),longitudeDelta:Math.abs(b.getEast()-b.getWest())}); });
    setTimeout(function(){ if(map) map.invalidateSize(); }, 50);
    post({type:'ready'});
  }

  function setData(data){
    if(!map) return;
    IMG_MAP = data.images || {};
    var markers=data.markers||[], polylines=data.polylines||[];
    var seen={};
    markers.forEach(function(p,idx){
      var key='m'+idx; seen[key]=true;
      var imgUrl = p.imgKey ? (IMG_MAP[p.imgKey]||'') : (p.imgUrl||'');
      var iconType=p.icon;
      var hasImg=!!imgUrl;
      var existing=markerLayers[key];
      if(existing && existing.iconType===iconType && existing.hasImg===hasImg){
        var prev=existing.layer.getLatLng();
        if(Math.abs(prev.lat-p.lat)>1e-7 || Math.abs(prev.lng-p.lng)>1e-7){
          var deg=(iconType==='car') ? (bearingDeg(prev.lat,prev.lng,p.lat,p.lng)+90)%360 : null;
          animTo(key,existing.layer,p.lat,p.lng,deg,p.duration||DURATION);
        }
      } else {
        if(existing){ cancelAnimationFrame(anims[key]); map.removeLayer(existing.layer); delete anims[key]; }
        var layer=L.marker([p.lat,p.lng],{icon:buildIcon(p)}).addTo(map);
        layer.on('click',function(){ post({type:'markerPress',index:idx}); });
        if(iconType==='car'){ rotateMarker(layer, p.angle||0); }
        markerLayers[key]={layer:layer,iconType:iconType,hasImg:hasImg};
      }
    });
    for(var mk in markerLayers){
      if(!seen[mk]){
        if(anims[mk]) cancelAnimationFrame(anims[mk]);
        map.removeLayer(markerLayers[mk].layer);
        delete markerLayers[mk];
        delete anims[mk];
      }
    }
    var seenP={};
    polylines.forEach(function(p,idx){
      var key='p'+idx; seenP[key]=true;
      var first=p.coords[0], last=p.coords[p.coords.length-1];
      var sig=p.color+'|'+p.weight+'|'+p.coords.length+'|'+(first?first[0]+','+first[1]:'')+'|'+(last?last[0]+','+last[1]:'');
      var ex=polylineLayers[key];
      if(ex && ex.sig===sig) return;
      if(ex){ map.removeLayer(ex.layer); }
      var layer=L.polyline(p.coords,{color:p.color||'#3b82f6',weight:p.weight||4,opacity:0.8,lineCap:'round',lineJoin:'round'}).addTo(map);
      polylineLayers[key]={layer:layer,sig:sig};
    });
    for(var pk in polylineLayers){ if(!seenP[pk]){ map.removeLayer(polylineLayers[pk].layer); delete polylineLayers[pk]; } }
  }

  function animateToRegion(region,duration){
    if(!map) return;
    var latD=region.latitudeDelta||0.02, lngD=region.longitudeDelta||0.02;
    var zoom=Math.max(10,Math.min(18,Math.round(Math.log2(360/Math.max(latD,lngD)))+1));
    map.setView([region.latitude,region.longitude],zoom,{animate:true,duration:(duration||300)/1000});
  }

  function followCar(lat,lng,bearing,zoom){
    if(!map) return;
    var size=map.getSize(); if(!size || size.y===0) return;
    var diff=bearing-smoothBearing; if(diff>180)diff-=360; if(diff<-180)diff+=360; smoothBearing+=diff;
    var currentZoom=map.getZoom()||zoom||17;
    var offsetY=size.y*(0.30-0.5);
    var carPoint=map.project([lat,lng],currentZoom);
    var targetPoint=carPoint.subtract([0,offsetY]);
    var mapCenter=map.unproject(targetPoint,currentZoom);
    map.setView(mapCenter,currentZoom,{animate:true,duration:0.3,easeLinearity:1.0});
  }

  function unfollow(){ smoothBearing=0; }

  function getCamera(reqId){
    if(!map){ post({type:'getCamera',requestId:reqId,camera:null}); return; }
    var c=map.getCenter();
    post({type:'getCamera',requestId:reqId,camera:{center:{latitude:c.lat,longitude:c.lng},zoom:map.getZoom()}});
  }

  function setCamera(camera){
    if(!map || !camera) return;
    if(camera.center){ map.setView([camera.center.latitude,camera.center.longitude],camera.zoom||map.getZoom()); }
  }

  function coordinateForPoint(reqId,x,y){
    if(!map){ post({type:'coordinateForPoint',requestId:reqId,coordinate:null}); return; }
    var ll=map.containerPointToLatLng([x,y]);
    post({type:'coordinateForPoint',requestId:reqId,coordinate:{latitude:ll.lat,longitude:ll.lng}});
  }

  window.__vuraMap={
    init:init, setData:setData, animateToRegion:animateToRegion, followCar:followCar,
    unfollow:unfollow, getCamera:getCamera, setCamera:setCamera, coordinateForPoint:coordinateForPoint
  };
  post({type:'mounted'});
})();
`;

const MARKER_STYLES = `
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
.tile-grayscale{filter:grayscale(1) contrast(1.08) brightness(1.02)}
`;

// CDN fallbacks used only if the bundled Leaflet copy fails to evaluate.
const LEAFLET_JS_FALLBACKS = [
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
];

const LOADER_JS = `
(function(){
  var sources = ${JSON.stringify(LEAFLET_JS_FALLBACKS)};
  var idx = 0;
  function report(msg){ try{ if(window.ReactNativeWebView){ window.ReactNativeWebView.postMessage(JSON.stringify({type:'log', message:String(msg)})); } }catch(e){} }
  window.onerror = function(m, src, line){ report('page-error: ' + m + ' (' + src + ':' + line + ')'); };
  function boot(){
    ${TILE_CACHE_JS}
    ${MAP_BODY_JS}
  }
  function loadNext(){
    if(window.L){ boot(); return; }
    if(idx >= sources.length){ report('leaflet-load-failed: all CDNs failed'); return; }
    var s = document.createElement('script');
    s.src = sources[idx++];
    s.onload = function(){ if(window.L){ boot(); } else { loadNext(); } };
    s.onerror = function(){ loadNext(); };
    document.head.appendChild(s);
  }
  loadNext();
})();
`;

function buildMapHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
html, body { height: 100%; margin: 0; padding: 0; }
#map { position: fixed; top: 0; left: 0; right: 0; bottom: 0; }
${LEAFLET_CSS}
${MARKER_STYLES}
</style>
</head>
<body>
<div id="map"></div>
<script>
${LEAFLET_JS}
</script>
<script>
${LOADER_JS}
</script>
</body>
</html>`;
}

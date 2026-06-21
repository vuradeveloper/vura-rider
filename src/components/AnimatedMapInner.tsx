import { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import * as h3 from "h3-js";

const carIconFixed = L.divIcon({
  html: `<img class="vura-car-img" src="/CarLocator.png" style="width: 100%; height: 100%; transition: transform 0.3s linear; transform-origin: center center;" />`,
  className: "car-marker-container border-0 bg-transparent",
  iconSize: [48, 48],
  iconAnchor: [24, 24]
});

const userIcon = L.divIcon({
  html: `<div class="relative grid place-items-center"><div class="h-4 w-4 bg-primary rounded-full z-10 border-2 border-white shadow-md"></div><div class="h-10 w-10 bg-primary/20 rounded-full absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-[pulse_2s_infinite]"></div></div>`,
  className: "bg-transparent border-0",
  iconSize: [40, 40],
  iconAnchor: [20, 20]
});

// Calculate bearing between two points
function getBearing(startLat: number, startLng: number, destLat: number, destLng: number) {
  const startLatRad = startLat * Math.PI / 180;
  const startLngRad = startLng * Math.PI / 180;
  const destLatRad = destLat * Math.PI / 180;
  const destLngRad = destLng * Math.PI / 180;

  const y = Math.sin(destLngRad - startLngRad) * Math.cos(destLatRad);
  const x = Math.cos(startLatRad) * Math.sin(destLatRad) -
            Math.sin(startLatRad) * Math.cos(destLatRad) * Math.cos(destLngRad - startLngRad);
  const brng = Math.atan2(y, x);
  return (brng * 180 / Math.PI + 360) % 360;
}

function MapController({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, map.getZoom(), { animate: false });
  }, [center, map]);
  return null;
}

// Helper to densify route so car moves at a constant smooth speed
function densifyRoute(route: [number, number][], segmentLengthMeters = 30): [number, number][] {
  if (route.length < 2) return route;
  const rad = Math.PI / 180;
  const R = 6371e3; // earth radius in meters

  const distance = (p1: [number, number], p2: [number, number]) => {
    const dLat = (p2[0] - p1[0]) * rad;
    const dLon = (p2[1] - p1[1]) * rad;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(p1[0] * rad) * Math.cos(p2[0] * rad) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const newRoute: [number, number][] = [route[0]];
  for (let i = 0; i < route.length - 1; i++) {
    const p1 = route[i];
    const p2 = route[i + 1];
    const dist = distance(p1, p2);
    const steps = Math.max(1, Math.floor(dist / segmentLengthMeters));
    for (let j = 1; j <= steps; j++) {
      const lat = p1[0] + (p2[0] - p1[0]) * (j / steps);
      const lon = p1[1] + (p2[1] - p1[1]) * (j / steps);
      newRoute.push([lat, lon]);
    }
  }
  return newRoute;
}

// Helper to fetch a route between two points
async function fetchRoute(start: [number, number], end: [number, number]) {
  try {
    const res = await fetch(`https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?geometries=geojson&overview=full`);
    const data = await res.json();
    if (data.routes && data.routes[0]) {
      const rawRoute = data.routes[0].geometry.coordinates.map((c: any) => [c[1], c[0]] as [number, number]);
      return densifyRoute(rawRoute, 30);
    }
  } catch (e) {
    console.error(e);
  }
  return [];
}

function playPing8Times() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const playNote = (freq: number, start: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.2, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + start + 0.4);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + 0.4);
    };
    
    // Ping 8 times
    for (let i = 0; i < 8; i++) {
      const offset = i * 1.0; 
      playNote(659.25, offset); // E5
      playNote(880.00, offset + 0.2); // A5
    }
  } catch (e) {}
}

type IdleCar = { id: number; pos: [number, number]; route: [number, number][]; step: number };

export default function AnimatedMapInner({ mode = "idle", height = 320, onComplete }: { mode?: "idle" | "track", height?: number, onComplete?: () => void }) {
  const [userLocation, setUserLocation] = useState<[number, number]>([-26.2041, 28.0473]);
  const [route, setRoute] = useState<[number, number][]>([]);
  const [carPos, setCarPos] = useState<[number, number]>([-26.2041, 28.0473]);
  const [idleCars, setIdleCars] = useState<IdleCar[]>([]);
  const [address, setAddress] = useState("Locating...");
  const [trackStep, setTrackStep] = useState(0);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation([pos.coords.latitude, pos.coords.longitude]),
        (err) => console.error("Error fetching location", err)
      );
    }
  }, []);

  useEffect(() => {
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${userLocation[0]}&lon=${userLocation[1]}`)
      .then(r => r.json())
      .then(d => {
        if (d && d.display_name) {
          setAddress(d.display_name.split(',').slice(0, 3).join(', '));
        } else {
          setAddress("Unknown Location");
        }
      })
      .catch(() => setAddress("Unknown Location"));
  }, [userLocation]);

  // Initialize idle cars with real routes
  useEffect(() => {
    if (mode !== "idle") return;
    
    let isMounted = true;

    const initIdleCars = async () => {
      const newCars: IdleCar[] = [];
      for (let i = 0; i < 4; i++) {
        // Start near user
        const startLat = userLocation[0] + (Math.random() - 0.5) * 0.015;
        const startLon = userLocation[1] + (Math.random() - 0.5) * 0.015;
        // End somewhere else
        const endLat = startLat + (Math.random() - 0.5) * 0.02;
        const endLon = startLon + (Math.random() - 0.5) * 0.02;

        const path = await fetchRoute([startLat, startLon], [endLat, endLon]);
        newCars.push({ id: i, pos: [startLat, startLon], route: path, step: 0 });
      }
      if (isMounted) setIdleCars(newCars);
    };

    initIdleCars();

    return () => { isMounted = false; };
  }, [userLocation, mode]);

  // Animate idle cars along their individual routes
  useEffect(() => {
    if (mode !== "idle" || idleCars.length === 0) return;

    const interval = setInterval(() => {
      setIdleCars(cars => cars.map(car => {
        if (car.route.length > 0 && car.step < car.route.length - 1) {
          return { ...car, step: car.step + 1, pos: car.route[car.step + 1] };
        }
        return car;
      }));
    }, 2000);

    return () => clearInterval(interval);
  }, [idleCars.length, mode]);

  const [trackStage, setTrackStage] = useState<"idle" | "approaching" | "arrived" | "en_route" | "completed">("idle");

  // Track Mode Initial Fetch
  useEffect(() => {
    if (mode !== "track") return;

    let pLocation = userLocation;
    try {
      const p = JSON.parse(localStorage.getItem("vura.ride.pickup") || "null");
      if (p && p.length === 2) pLocation = p;
    } catch(e) {}

    // ---- H3 SMART MATCHING ENGINE ----
    console.log("Initializing Smart Driver Matching Algorithm...");
    // 1. Get Rider H3 Cell (resolution 8 is about 460 meters wide)
    const riderHex = h3.latLngToCell(pLocation[0], pLocation[1], 8);
    console.log("Rider mapped to H3 Hexagon:", riderHex);

    // 2. Expand search using kRing (radius of 5 hexagons ~ 2.3km)
    const searchArea = h3.gridDisk(riderHex, 5);
    console.log(`Expanded kRing search to ${searchArea.length} neighboring hexes.`);

    // 3. Generate random mock drivers across the broader city
    const mockDrivers = Array.from({ length: 150 }).map((_, i) => ({
      id: i,
      lat: pLocation[0] + (Math.random() - 0.5) * 0.1,
      lon: pLocation[1] + (Math.random() - 0.5) * 0.1,
      rating: 4.5 + Math.random() * 0.5
    }));

    // 4. Filter drivers who are inside the kRing search area
    const nearbyDrivers = mockDrivers.filter(d => searchArea.includes(h3.latLngToCell(d.lat, d.lon, 8)));
    console.log(`Found ${nearbyDrivers.length} drivers within the kRing search area.`);

    // 5. Score candidates based on H3 grid distance (ETA proxy) and rating
    let bestDriver = null;
    let bestScore = -Infinity;

    nearbyDrivers.forEach(d => {
      const driverHex = h3.latLngToCell(d.lat, d.lon, 8);
      const hexDistance = h3.gridDistance(riderHex, driverHex);
      
      // Score formula: Higher rating is better, smaller distance is better.
      const score = (d.rating * 10) - (hexDistance * 2);
      if (score > bestScore) {
        bestScore = score;
        bestDriver = d;
      }
    });

    let startPos = [pLocation[0] + 0.015, pLocation[1] + 0.015] as [number, number];
    
    if (bestDriver) {
      console.log(`Driver ${bestDriver.id} won the bid with score ${bestScore.toFixed(2)}!`);
      startPos = [bestDriver.lat, bestDriver.lon];
    } else {
      console.log("No drivers inside kRing. Falling back to default spawn...");
    }
    // ----------------------------------

    setCarPos(startPos);

    fetchRoute(startPos, pLocation).then(path => {
      if (path.length > 0) {
        setRoute(path);
        setTrackStep(0);
        setTrackStage("approaching");
      }
    });
  }, [mode]);

  const carMarkerRef = useRef<L.Marker>(null);

  // Animate Track Mode Car
  useEffect(() => {
    if (mode !== "track" || route.length === 0 || (trackStage !== "approaching" && trackStage !== "en_route")) return;

    let step = 0;
    setTrackStep(0);
    const interval = setInterval(() => {
      if (step < route.length - 1) {
        const currentP = route[step];
        const nextP = route[step + 1];
        
        // Update bearing
        const newBearing = getBearing(currentP[0], currentP[1], nextP[0], nextP[1]);
        if (carMarkerRef.current) {
          const el = carMarkerRef.current.getElement();
          if (el) {
            const img = el.querySelector('.vura-car-img') as HTMLImageElement;
            // The image faces left naturally (West, 270 deg). 
            // We add 90 deg so that 0 bearing (North) makes the car point UP.
            if (img) img.style.transform = `rotate(${newBearing + 90}deg)`;
          }
        }

        setCarPos(nextP);
        step++;
        setTrackStep(step);
      } else {
        clearInterval(interval);
        
        if (trackStage === "approaching") {
          playPing8Times();
          setTrackStage("arrived");
          setRoute([]); // Clear route so blue line disappears
          
          setTimeout(() => {
            let pLocation = userLocation;
            try {
              const p = JSON.parse(localStorage.getItem("vura.ride.pickup") || "null");
              if (p && p.length === 2) pLocation = p;
            } catch(e) {}

            let dLocation = userLocation;
            try {
              const d = JSON.parse(localStorage.getItem("vura.ride.dropoff") || "null");
              if (d && d.length === 2) dLocation = d;
            } catch(e) {}

            fetchRoute(pLocation, dLocation).then(path => {
              if (path.length > 0) {
                setRoute(path);
                setTrackStep(0);
                setTrackStage("en_route");
              }
            });
          }, 4500); // wait ~4.5 seconds for ping to finish
        } else if (trackStage === "en_route") {
          setTrackStage("completed");
          setRoute([]);
          if (onComplete) onComplete();
        }
      }
    }, 300);

    return () => clearInterval(interval);
  }, [route, trackStage, mode, onComplete]);

  if (typeof window === 'undefined') {
    return <div style={{ height, background: "#f8f9fa" }} />;
  }

  // Calculate the remaining route to draw from the current step
  const remainingRoute = route.length > 0 ? route.slice(trackStep) : [];

  return (
    <div className="relative w-full overflow-hidden z-0" style={{ height }}>
      <MapContainer center={userLocation} zoom={15} style={{ height: "100%", width: "100%" }} zoomControl={false} attributionControl={false}>
        <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
        <MapController center={userLocation} />
        
        <Marker position={userLocation} icon={userIcon}>
          <Popup className="font-sans">
            <strong className="text-sm font-bold text-foreground">Your Location</strong><br/>
            <span className="text-xs text-muted-foreground">{address}</span>
          </Popup>
        </Marker>

        {mode === "idle" && idleCars.map(car => (
          <Marker key={car.id} position={car.pos} icon={carIconFixed} />
        ))}

        {mode === "track" && (
          <>
            {remainingRoute.length > 1 && (
              <Polyline positions={remainingRoute} pathOptions={{ color: '#3b82f6', weight: 4, opacity: 0.8 }} />
            )}
            <Marker position={carPos} icon={carIconFixed} ref={carMarkerRef} />
          </>
        )}
      </MapContainer>
      <style dangerouslySetInnerHTML={{__html: `
        .leaflet-container { background: #f8f9fa; z-index: 10; }
        .leaflet-marker-icon { transition: transform 0.3s linear; } 
        @keyframes pulse {
          0% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.7); }
          70% { box-shadow: 0 0 0 10px rgba(59, 130, 246, 0); }
          100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
        }
      `}} />
    </div>
  );
}

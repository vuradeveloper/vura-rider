import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, MapPin, Circle, Star, Clock } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/search")({
  head: () => ({ meta: [{ title: "Where to? — Vura" }] }),
  component: Search,
});

function Search() {
  const nav = useNavigate();
  const [activeInput, setActiveInput] = useState<"pickup" | "dropoff">("dropoff");
  const [pickup, setPickup] = useState("Locating...");
  const [dropoff, setDropoff] = useState("");
  const [results, setResults] = useState<any[]>([]);

  const [userCountry, setUserCountry] = useState<string>("");

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          localStorage.setItem("vura.ride.pickup", JSON.stringify([pos.coords.latitude, pos.coords.longitude]));
          fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&addressdetails=1`)
            .then(r => r.json())
            .then(d => {
              if (d && d.address && d.address.country_code) {
                setUserCountry(d.address.country_code);
              }
              if (d && d.display_name) {
                setPickup(d.display_name.split(',').slice(0, 2).join(', '));
              } else {
                setPickup("Current location");
              }
            }).catch(() => setPickup("Current location"));
        },
        () => setPickup("Current location")
      );
    } else {
      setPickup("Current location");
    }
  }, []);

  useEffect(() => {
    const q = activeInput === "pickup" ? pickup : dropoff;
    if (q === "Locating..." || q === "Current location" || q.length < 3) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      let locBias = "";
      try {
        const p = JSON.parse(localStorage.getItem("vura.ride.pickup") || "null");
        if (p && p.length === 2) locBias = `&lat=${p[0]}&lon=${p[1]}`;
      } catch(e) {}
      
      // Use Photon API which is much better for Uber-like fuzzy search and handles typos perfectly
      fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6${locBias}`)
        .then(r => r.json())
        .then((data: any) => {
          if (data.features) {
            setResults(data.features.map((f: any) => ({
              name: f.properties.name || f.properties.street || f.properties.city,
              addr: [f.properties.street, f.properties.district, f.properties.city, f.properties.state, f.properties.country].filter(Boolean).join(", "),
              lat: f.geometry.coordinates[1],
              lon: f.geometry.coordinates[0]
            })));
          }
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [pickup, dropoff, activeInput, userCountry]);

  const [entranceModal, setEntranceModal] = useState<{ s: any, type: "pickup" | "dropoff" } | null>(null);
  const [realEntrances, setRealEntrances] = useState<string[]>([]);
  const [fetchingEntrances, setFetchingEntrances] = useState(false);

  const handleSelect = (s: any) => {
    const isMall = /mall|shopping|centre|center|square|plaza/i.test(s.name) || /mall|shopping/i.test(s.addr);
    if (isMall) {
      setEntranceModal({ s, type: activeInput });
      setFetchingEntrances(true);
      setRealEntrances([]);

      // Fetch REAL entrances and drop-off zones near the location using Overpass API
      const query = `[out:json];(node(around:200,${s.lat},${s.lon})["entrance"];node(around:200,${s.lat},${s.lon})["highway"="bus_stop"];node(around:200,${s.lat},${s.lon})["amenity"="parking_entrance"];);out;`;
      
      fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`)
        .then(res => res.json())
        .then(data => {
          if (data.elements && data.elements.length > 0) {
            const entrances = data.elements.map((e: any, i: number) => {
              if (e.tags?.name) return e.tags.name;
              if (e.tags?.ref) return `Entrance ${e.tags.ref}`;
              if (e.tags?.entrance === "main") return "Main Entrance";
              if (e.tags?.amenity === "parking_entrance") return "Parking Drop-off";
              if (e.tags?.highway === "bus_stop") return "Transit Drop-off Zone";
              return `Gate / Entrance ${i + 1}`;
            });
            // Remove duplicates and keep up to 6
            const unique = Array.from(new Set(entrances)) as string[];
            setRealEntrances(unique.slice(0, 6));
          } else {
            // Fallback if the map data for this specific mall has no entrances mapped
            setRealEntrances(["Main Entrance", "Secondary Entrance", "Parking Drop-off"]);
          }
        })
        .catch(() => {
          setRealEntrances(["Main Entrance", "Secondary Entrance", "Parking Drop-off"]);
        })
        .finally(() => {
          setFetchingEntrances(false);
        });

      return;
    }
    
    proceedWithSelection(s, s.name);
  };

  const proceedWithSelection = (s: any, displayName: string) => {
    if (activeInput === "pickup" || (entranceModal && entranceModal.type === "pickup")) {
      setPickup(displayName);
      localStorage.setItem("vura.ride.pickup", JSON.stringify([s.lat, s.lon]));
      setActiveInput("dropoff");
      setEntranceModal(null);
    } else {
      setDropoff(displayName);
      localStorage.setItem("vura.ride.dropoff", JSON.stringify([s.lat, s.lon]));
      setEntranceModal(null);
      // Navigate to ride options when dropoff is selected
      nav({ to: "/ride/options" });
    }
  };

  const defaultSuggestions = [
    { name: "Heathrow Airport", addr: "Terminal 5, London TW6", lat: 51.4700, lon: -0.4543 },
    { name: "Mall of Africa", addr: "Waterfall City, Midrand", lat: -26.0152, lon: 28.1065 },
    { name: "British Museum", addr: "Great Russell St, London", lat: 51.5194, lon: -0.1270 },
    { name: "King's Cross Station", addr: "Euston Rd, London N1C", lat: 51.5320, lon: -0.1240 },
  ];

  const displayResults = results.length > 0 ? results : defaultSuggestions;

  return (
    <PhoneShell hideTabs>
      <div className="px-5 pt-3 pb-4 bg-surface border-b border-border">
        <div className="flex items-center gap-3 mb-4">
          <Link to="/" className="grid place-items-center h-9 w-9 rounded-full bg-secondary">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-base font-bold">Plan your ride</h1>
        </div>

        <div className="flex gap-3">
          <div className="flex flex-col items-center pt-3">
            <Circle className="h-3 w-3 fill-foreground text-foreground" />
            <div className="w-px flex-1 my-1 border-l-2 border-dashed border-muted-foreground/40" />
            <MapPin className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 space-y-2">
            <input
              value={pickup}
              onFocus={() => setActiveInput("pickup")}
              onChange={(e) => setPickup(e.target.value)}
              className={`w-full rounded-xl px-3 py-3 text-sm font-medium outline-none transition ${activeInput === "pickup" ? "bg-accent border border-primary/30 ring-2 ring-primary/40" : "bg-secondary border border-transparent"}`}
            />
            <input
              autoFocus
              placeholder="Where to?"
              value={dropoff}
              onFocus={() => setActiveInput("dropoff")}
              onChange={(e) => setDropoff(e.target.value)}
              className={`w-full rounded-xl px-3 py-3 text-sm font-medium outline-none transition ${activeInput === "dropoff" ? "bg-accent border border-primary/30 ring-2 ring-primary/40" : "bg-secondary border border-transparent"}`}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 px-5 py-4 overflow-y-auto">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
          {results.length > 0 ? "Search Results" : "Suggestions"}
        </p>
        <div className="divide-y divide-border">
          {displayResults.map((s, i) => (
            <button key={i} onClick={() => handleSelect(s)} className="w-full flex items-center gap-3 py-3 text-left">
              <span className="grid place-items-center shrink-0 h-10 w-10 rounded-full bg-secondary">
                {results.length > 0 ? <MapPin className="h-4 w-4 text-primary" /> : (i === 0 ? <Star className="h-4 w-4 text-primary" /> : <Clock className="h-4 w-4 text-muted-foreground" />)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold truncate">{s.name}</p>
                <p className="text-xs text-muted-foreground truncate">{s.addr}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {entranceModal && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end">
          <div className="w-full bg-surface rounded-t-[2rem] p-5 shadow-float animate-in slide-in-from-bottom max-h-[80vh] flex flex-col">
            <h3 className="text-lg font-bold">Choose an entrance</h3>
            <p className="text-sm text-muted-foreground mb-4 mt-1">Select the most convenient point for {entranceModal.s.name}.</p>
            
            {fetchingEntrances ? (
              <div className="py-8 flex flex-col items-center justify-center space-y-3">
                <div className="h-6 w-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <p className="text-xs font-semibold text-muted-foreground animate-pulse">Scanning map for drop-off zones...</p>
              </div>
            ) : (
              <div className="space-y-2 overflow-y-auto pb-4">
                {realEntrances.map((ent, i) => (
                  <button
                    key={i}
                    onClick={() => proceedWithSelection(entranceModal.s, `${entranceModal.s.name} (${ent})`)}
                    className="w-full text-left px-4 py-3.5 rounded-full border border-border bg-surface hover:bg-secondary/50 transition text-sm font-semibold flex items-center justify-between"
                  >
                    {ent}
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}

            <button 
              onClick={() => setEntranceModal(null)}
              className="mt-2 w-full py-3.5 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary text-sm font-bold hover:bg-secondary/80 transition"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </PhoneShell>
  );
}

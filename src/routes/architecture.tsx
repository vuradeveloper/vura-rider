import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Hexagon, Database, Navigation, Route as RouteIcon, Map } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";

export const Route = createFileRoute("/architecture")({
  head: () => ({ meta: [{ title: "System Architecture — Vura" }] }),
  component: ArchitecturePage,
});

function ArchitecturePage() {
  return (
    <PhoneShell hideTabs>
      <div className="bg-[#111111] min-h-full text-white font-sans overflow-y-auto pb-10">
        <div className="sticky top-0 z-10 bg-[#111111]/80 backdrop-blur-md px-5 pt-4 pb-4 border-b border-white/10 flex items-center gap-3">
          <Link to="/account" className="grid place-items-center h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 transition">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-lg font-bold">System Architecture</h1>
        </div>

        <div className="px-5 pt-6 space-y-12">
          {/* Part 1: Finding Drivers */}
          <section>
            <h2 className="text-center text-sm font-bold text-white/90 mb-6">Part 1 — Finding nearby drivers (geospatial search)</h2>
            
            <div className="flex justify-center mb-6 opacity-80">
              <div className="relative h-24 w-32">
                <Hexagon className="absolute top-0 left-1/2 -translate-x-1/2 h-12 w-12 text-[#f59e0b] fill-[#f59e0b]/10" strokeWidth={1} />
                <Hexagon className="absolute top-6 left-2 h-12 w-12 text-[#3b82f6] fill-transparent" strokeWidth={1} />
                <Hexagon className="absolute top-6 right-2 h-12 w-12 text-[#3b82f6] fill-transparent" strokeWidth={1} />
                <Hexagon className="absolute top-12 left-1/2 -translate-x-1/2 h-12 w-12 text-[#3b82f6] fill-transparent" strokeWidth={1} />
                <div className="absolute top-4 left-1/2 -translate-x-1/2 text-[8px] font-bold text-[#f59e0b]">Rider</div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex gap-2">
                <div className="flex-1 bg-[#854d0e] border border-[#a16207] rounded-xl p-3 text-center shadow-lg">
                  <h3 className="text-xs font-bold text-white">1. GPS collection</h3>
                  <p className="text-[9px] text-white/70">Raw GPS from driver app</p>
                </div>
                <div className="flex items-center justify-center opacity-50"><ArrowRight /></div>
                <div className="flex-1 bg-[#1e3a8a] border border-[#2563eb] rounded-xl p-3 text-center shadow-lg">
                  <h3 className="text-xs font-bold text-white">2. Kalman filter</h3>
                  <p className="text-[9px] text-white/70">Smooth noisy GPS signal</p>
                </div>
                <div className="flex items-center justify-center opacity-50"><ArrowRight /></div>
                <div className="flex-1 bg-[#14532d] border border-[#16a34a] rounded-xl p-3 text-center shadow-lg">
                  <h3 className="text-xs font-bold text-white">3. Map matching</h3>
                  <p className="text-[9px] text-white/70">Snap to nearest road</p>
                </div>
              </div>

              <div className="flex justify-center gap-12 py-1 opacity-50">
                <ArrowDown />
                <ArrowDown />
              </div>

              <div className="flex gap-4">
                <div className="flex-1 bg-[#4c1d95] border border-[#7c3aed] rounded-xl p-3 text-center shadow-lg">
                  <h3 className="text-xs font-bold text-white">4. H3 hexagonal index</h3>
                  <p className="text-[9px] text-white/70">Convert coords to 64-bit ID</p>
                </div>
                <div className="flex items-center justify-center opacity-50"><ArrowRight /></div>
                <div className="flex-1 bg-[#4c1d95] border border-[#7c3aed] rounded-xl p-3 text-center shadow-lg">
                  <h3 className="text-xs font-bold text-white">5. kRing search</h3>
                  <p className="text-[9px] text-white/70">Expand to neighbor hexes</p>
                </div>
              </div>

              <div className="flex justify-center gap-12 py-1 opacity-50">
                <ArrowDown />
                <ArrowDown />
              </div>

              <div className="flex gap-4">
                <div className="flex-1 bg-[#7c2d12] border border-[#ea580c] rounded-xl p-3 text-center shadow-lg">
                  <h3 className="text-xs font-bold text-white">6. Score candidates</h3>
                  <p className="text-[9px] text-white/70">ETA + rating + acceptance</p>
                </div>
                <div className="flex-1 bg-[#27272a] border border-[#52525b] rounded-xl p-3 text-center shadow-lg">
                  <h3 className="text-xs font-bold text-white">Storage layer</h3>
                  <p className="text-[9px] text-white/70">Redis cache + Cassandra</p>
                </div>
              </div>

              <div className="flex justify-center py-1 opacity-50">
                <ArrowDown />
              </div>

              <div className="mx-8 bg-[#15803d] border border-[#22c55e] rounded-xl p-3 text-center shadow-lg">
                <h3 className="text-xs font-bold text-white">7. Send ride offer</h3>
                <p className="text-[9px] text-white/70">Top driver first — 15s timeout</p>
              </div>
            </div>
          </section>

          <hr className="border-white/10" />

          {/* Part 2: Routing */}
          <section>
            <h2 className="text-center text-sm font-bold text-white/90 mb-6">Part 2 — Routing to a destination (shortest path)</h2>
            
            <div className="relative h-20 mb-6 flex justify-between items-center px-4 opacity-80">
              <div className="h-4 w-4 rounded-full bg-[#22c55e] z-10" />
              <div className="absolute top-1/2 left-6 right-6 h-0.5 bg-[#f59e0b] -translate-y-1/2 z-0" />
              <div className="absolute top-1/4 left-[30%] h-0.5 w-[40%] bg-white/20 rotate-12 z-0" />
              <div className="absolute top-3/4 left-[30%] h-0.5 w-[40%] bg-white/20 -rotate-12 z-0" />
              
              <div className="h-4 w-4 rounded-full bg-white/30 z-10" />
              <div className="h-4 w-4 rounded-full bg-[#ea580c] z-10" />
            </div>

            <div className="flex flex-col gap-3">
              <div className="bg-[#1e3a8a] border border-[#3b82f6] rounded-xl p-4 shadow-lg flex items-center gap-3">
                <RouteIcon className="h-5 w-5 text-blue-300 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-white">Dijkstra's algorithm</h3>
                  <p className="text-[10px] text-white/70">Explores all paths • 100% accurate</p>
                </div>
              </div>
              
              <div className="flex justify-center opacity-50">
                <ArrowDown />
              </div>

              <div className="bg-[#0f766e] border border-[#14b8a6] rounded-xl p-4 shadow-lg flex items-center gap-3">
                <Navigation className="h-5 w-5 text-teal-300 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-white">A* (A-star)</h3>
                  <p className="text-[10px] text-white/70">Uses heuristic estimate • Faster than Dijkstra</p>
                </div>
              </div>

              <div className="flex justify-center opacity-50">
                <ArrowDown />
              </div>

              <div className="bg-[#4c1d95] border border-[#8b5cf6] rounded-xl p-4 shadow-lg flex items-center gap-3">
                <Map className="h-5 w-5 text-purple-300 shrink-0" />
                <div>
                  <h3 className="text-sm font-bold text-white">Graph partitioning</h3>
                  <p className="text-[10px] text-white/70">Pre-compute sub-regions • Scales to millions</p>
                </div>
              </div>
            </div>
            <p className="text-center text-[9px] text-white/50 mt-6 font-medium">Road = weighted graph: intersections = nodes, streets = edges with real-time traffic cost</p>
          </section>
        </div>
      </div>
    </PhoneShell>
  );
}

function ArrowRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M12 5l7 7-7 7"/>
    </svg>
  );
}

function ArrowDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M19 12l-7 7-7-7"/>
    </svg>
  );
}

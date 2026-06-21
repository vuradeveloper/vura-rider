import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { Search, Clock, Home as HomeIcon, Briefcase, Car, UtensilsCrossed, Package, Bell } from "lucide-react";
import { PhoneShell, FakeMap } from "@/components/PhoneShell";
import { useAuth } from "@/lib/auth";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Vura — Get there, your way" },
      { name: "description", content: "Request a ride in seconds. Track your driver in real time." },
    ],
  }),
  component: Home,
});

function Home() {
  const user = useAuth();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;
  if (!user) return <Navigate to="/welcome" />;
  if (user.role === "driver") return <Navigate to="/driver" />;
  return (
    <PhoneShell>
      {/* Hero greeting */}
      <div className="hero-gradient text-primary-foreground px-5 pt-4 pb-10 rounded-b-[2rem] relative overflow-hidden">
        <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10" />
        <div className="absolute right-12 top-20 h-24 w-24 rounded-full bg-white/10" />
        <div className="flex items-center justify-between relative">
          <div>
            <p className="text-xs/4 opacity-80">Good morning,</p>
            <h1 className="text-2xl font-bold tracking-tight">{user.name}</h1>
          </div>
          <button className="grid place-items-center h-10 w-10 rounded-full bg-white/15 backdrop-blur">
            <Bell className="h-5 w-5" />
          </button>
        </div>

        <Link
          to="/search"
          className="mt-6 flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 text-foreground shadow-float relative"
        >
          <Search className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium text-muted-foreground">Where to?</span>
          <span className="ml-auto flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold">
            <Clock className="h-3 w-3" /> Now
          </span>
        </Link>
      </div>

      {/* Quick services */}
      <div className="px-5 -mt-4">
        <div className="grid grid-cols-4 gap-3 rounded-2xl bg-surface border border-border shadow-sm p-4">
          {[
            { icon: Car, label: "Ride", to: "/search" },
            { icon: UtensilsCrossed, label: "Eats", to: "/services" },
            { icon: Package, label: "Package", to: "/services" },
            { icon: Briefcase, label: "Business", to: "/services" },
          ].map(({ icon: Icon, label, to }) => (
            <Link key={label} to={to} className="flex flex-col items-center gap-2">
              <span className="grid place-items-center h-12 w-12 rounded-xl bg-accent text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-[11px] font-semibold text-foreground">{label}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Saved places */}
      <div className="px-5 mt-6">
        <h2 className="text-sm font-bold text-foreground/90 mb-3">Saved places</h2>
        <div className="space-y-2">
          {[
            { icon: HomeIcon, label: "Home", sub: "221B Baker St, London" },
            { icon: Briefcase, label: "Work", sub: "Canary Wharf, London" },
          ].map((p) => (
            <Link key={p.label} to="/search" className="flex items-center gap-3 rounded-xl bg-surface border border-border px-3.5 py-3 hover:border-primary/40 transition">
              <span className="grid place-items-center h-10 w-10 rounded-full bg-secondary text-foreground">
                <p.icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{p.label}</p>
                <p className="text-xs text-muted-foreground truncate">{p.sub}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Map preview */}
      <div className="mx-5 mt-6 rounded-2xl overflow-hidden border border-border shadow-sm border border-border">
        <FakeMap height={180} />
        <div className="flex items-center justify-between px-4 py-3 bg-surface">
          <div>
            <p className="text-xs text-muted-foreground">Nearest driver</p>
            <p className="text-sm font-bold">2 min away</p>
          </div>
          <Link to="/search" className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-sm">
            Book now
          </Link>
        </div>
      </div>

      <div className="h-6" />
    </PhoneShell>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { Car, UtensilsCrossed, Package, Briefcase, Plane, Bike, Truck, Calendar } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";

export const Route = createFileRoute("/services")({
  head: () => ({ meta: [{ title: "Services — Vura" }] }),
  component: Services,
});

const services = [
  { icon: Car, label: "Ride", desc: "Get a car in minutes" },
  { icon: Calendar, label: "Reserve", desc: "Plan ahead, save time" },
  { icon: UtensilsCrossed, label: "Eats", desc: "Food delivered fast" },
  { icon: Package, label: "Package", desc: "Send across town" },
  { icon: Plane, label: "Airport", desc: "Curbside pickup" },
  { icon: Bike, label: "Bike", desc: "Cheaper short trips" },
  { icon: Truck, label: "Moving", desc: "Help with big loads" },
  { icon: Briefcase, label: "Business", desc: "For your team" },
];

function Services() {
  return (
    <PhoneShell>
      <div className="hero-gradient text-primary-foreground px-5 pt-4 pb-8 rounded-b-[2rem]">
        <h1 className="text-2xl font-bold tracking-tight">Services</h1>
        <p className="text-sm opacity-85 mt-1">Everything Vura can do for you.</p>
      </div>

      <div className="px-5 mt-5">
        <div className="grid grid-cols-2 gap-3">
          {services.map((s) => (
            <Link key={s.label} to="/search" className="rounded-md border border-border bg-surface p-4 border border-border shadow-sm hover:border-primary/40 transition">
              <span className="grid place-items-center h-11 w-11 rounded-xl bg-accent text-primary">
                <s.icon className="h-5 w-5" />
              </span>
              <p className="mt-3 text-sm font-bold">{s.label}</p>
              <p className="text-xs text-muted-foreground">{s.desc}</p>
            </Link>
          ))}
        </div>

        <div className="mt-6 rounded-2xl hero-gradient text-primary-foreground p-5 shadow-float">
          <p className="text-xs font-bold uppercase tracking-wider opacity-80">Vura One</p>
          <h3 className="text-lg font-bold mt-1">Save 10% on every ride</h3>
          <p className="text-xs opacity-85 mt-1">Membership perks across rides & eats.</p>
          <button className="mt-3 rounded-full bg-surface text-primary px-4 py-2 text-xs font-bold">Try free for 30 days</button>
        </div>
      </div>
      <div className="h-6" />
    </PhoneShell>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Gift, Tag, ChevronRight } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";

export const Route = createFileRoute("/promotions")({
  head: () => ({ meta: [{ title: "Promotions — Vura" }] }),
  component: PromotionsPage,
});

function PromotionsPage() {
  const promos = [
    { title: "20% off your next 3 rides", desc: "Up to R50 per ride. Valid until end of month.", active: true },
    { title: "R100 Welcome Bonus", desc: "Applied automatically on your first ride.", active: true },
  ];

  return (
    <PhoneShell hideTabs>
      <div className="hero-gradient text-primary-foreground px-5 pt-4 pb-8 rounded-b-[2rem] relative">
        <Link to="/account" className="absolute top-4 left-4 grid place-items-center h-9 w-9 rounded-full bg-white/20 hover:bg-white/30 transition">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="mt-12 text-2xl font-extrabold tracking-tight">Promotions</h1>
      </div>

      <div className="px-5 mt-6 flex-1 flex flex-col pb-6 space-y-6 overflow-y-auto">
        <div className="flex gap-2">
          <input
            placeholder="Enter promo code"
            className="flex-1 rounded-md border border-border bg-surface px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary shadow-sm"
          />
          <button className="rounded-2xl bg-primary px-5 font-bold text-primary-foreground shadow-sm hover:brightness-110 transition">
            Apply
          </button>
        </div>

        <div>
          <h2 className="text-sm font-extrabold text-foreground mb-3">Active Offers</h2>
          <div className="space-y-3">
            {promos.map((p, i) => (
              <div key={i} className="rounded-2xl bg-surface border border-border p-4 shadow-sm flex items-start gap-4">
                <div className="h-10 w-10 rounded-full bg-red-100 text-red-600 grid place-items-center shrink-0">
                  <Gift className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">{p.title}</p>
                  <p className="text-xs text-muted-foreground mt-1 leading-snug">{p.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-md bg-secondary/50 p-4 border border-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Tag className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-bold text-foreground">Past promotions</span>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
    </PhoneShell>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Users, Zap, Crown, CreditCard, Tag, Banknote, X } from "lucide-react";
import { PhoneShell, FakeMap } from "@/components/PhoneShell";

export const Route = createFileRoute("/ride/options")({
  head: () => ({ meta: [{ title: "Choose your ride — Vura" }] }),
  component: RideOptions,
});

const rides = [
  { id: "go", name: "VuraGo", desc: "Affordable, everyday rides", eta: "3 min", price: "R12.40", icon: Users },
  { id: "x", name: "VuraX", desc: "Faster pickups, comfy cars", eta: "4 min", price: "R15.90", icon: Zap, badge: "Popular" },
  { id: "lux", name: "VuraLux", desc: "Premium cars, top-rated drivers", eta: "6 min", price: "R24.50", icon: Crown },
];

const paymentOptions = [
  { type: "card", last4: "4242" },
  { type: "card", last4: "1234" },
  { type: "cash" },
];

function RideOptions() {
  const [selected, setSelected] = useState("x");
  const [showPayment, setShowPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(paymentOptions[0]);

  return (
    <PhoneShell hideTabs>
      <div className="relative">
        <FakeMap height={260} />
        <Link to="/search" className="absolute top-3 left-4 grid place-items-center h-9 w-9 rounded-full bg-surface border border-border shadow-sm">
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </div>

      <div className="-mt-5 rounded-t-3xl bg-surface px-5 pt-5 pb-4 shadow-float flex-1 flex flex-col">
        <div className="mx-auto h-1.5 w-12 rounded-full bg-border mb-4" />
        <h2 className="text-lg font-bold mb-1">Choose a ride</h2>
        <p className="text-xs text-muted-foreground mb-3">Recommended for your trip</p>

        <div className="space-y-2 flex-1">
          {rides.map((r) => {
            const Icon = r.icon;
            const active = selected === r.id;
            return (
              <button
                key={r.id}
                onClick={() => setSelected(r.id)}
                className={`w-full flex items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition ${active ? "border-primary bg-accent shadow-sm" : "border-border bg-surface"}`}
              >
                <span className={`grid place-items-center h-12 w-12 rounded-xl ${active ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground"}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold">{r.name}</p>
                    {r.badge && <span className="text-[10px] font-bold uppercase rounded-md bg-primary/10 text-primary px-2 py-0.5">{r.badge}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{r.desc} · {r.eta}</p>
                </div>
                <p className="text-sm font-extrabold">{r.price}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button onClick={() => setShowPayment(true)} className="flex-1 flex items-center justify-center gap-2 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-2.5 text-xs font-semibold hover:bg-secondary/80 transition">
            {paymentMethod.type === "card" ? <CreditCard className="h-4 w-4" /> : <Banknote className="h-4 w-4" />}
            {paymentMethod.type === "card" ? `•••• ${paymentMethod.last4}` : "Cash"}
          </button>
          <button className="flex-1 flex items-center justify-center gap-2 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-2.5 text-xs font-semibold hover:bg-secondary/80 transition">
            <Tag className="h-4 w-4" /> Add promo
          </button>
        </div>

        <Link
          to="/ride/track"
          className="mt-3 grid place-items-center rounded-md bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] transition"
        >
          Confirm {rides.find(r => r.id === selected)?.name}
        </Link>
      </div>

      {showPayment && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end">
          <div className="w-full bg-surface rounded-t-[2rem] p-5 shadow-float animate-in slide-in-from-bottom">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Select Payment</h3>
              <button onClick={() => setShowPayment(false)} className="h-8 w-8 rounded-full bg-secondary grid place-items-center hover:bg-secondary/80 transition"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2">
              {paymentOptions.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => { setPaymentMethod(opt); setShowPayment(false); }}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border transition ${paymentMethod.type === opt.type && paymentMethod.last4 === opt.last4 ? "border-primary bg-primary/5" : "border-border bg-surface hover:bg-secondary/50"}`}
                >
                  <div className={`h-10 w-10 rounded-full grid place-items-center shrink-0 ${opt.type === "card" ? "bg-blue-100 text-blue-600" : "bg-green-100 text-green-600"}`}>
                    {opt.type === "card" ? <CreditCard className="h-5 w-5" /> : <Banknote className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 text-left">
                    <p className="text-sm font-bold">{opt.type === "card" ? `•••• ${opt.last4}` : "Cash"}</p>
                  </div>
                  {paymentMethod.type === opt.type && paymentMethod.last4 === opt.last4 && (
                     <div className="h-2.5 w-2.5 rounded-md bg-primary" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </PhoneShell>
  );
}

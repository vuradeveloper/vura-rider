import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ShieldCheck, Users, KeyRound, BellRing, ChevronRight, Check } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";
import { useState } from "react";

export const Route = createFileRoute("/safety")({
  head: () => ({ meta: [{ title: "Safety — Vura" }] }),
  component: SafetyPage,
});

function SafetyPage() {
  const [activeSetting, setActiveSetting] = useState<string | null>(null);

  const settings = [
    { id: "contacts", icon: Users, title: "Trusted Contacts", desc: "Share your trip status with family and friends." },
    { id: "pin", icon: KeyRound, title: "Verify Your Ride", desc: "Use a PIN to make sure you get in the right car." },
    { id: "check", icon: BellRing, title: "RideCheck", desc: "We'll check on you if your trip goes off route." },
  ];

  return (
    <PhoneShell hideTabs>
      <div className="hero-gradient text-primary-foreground px-5 pt-4 pb-8 rounded-b-[2rem] relative">
        <Link to="/account" className="absolute top-4 left-4 grid place-items-center h-9 w-9 rounded-full bg-white/20 hover:bg-white/30 transition">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="mt-12 flex items-center gap-3">
          <ShieldCheck className="h-8 w-8" />
          <h1 className="text-2xl font-extrabold tracking-tight">Safety Center</h1>
        </div>
        <p className="text-sm opacity-85 mt-2">Your safety is our priority. Manage your preferences below.</p>
      </div>

      <div className="px-5 mt-6 flex-1 flex flex-col pb-6 space-y-4 overflow-y-auto">
        <h2 className="text-sm font-extrabold text-foreground mb-1">Safety tools</h2>
        <div className="rounded-2xl bg-surface border border-border divide-y divide-border overflow-hidden shadow-sm">
          {settings.map((s) => (
            <div key={s.id}>
              <div onClick={() => setActiveSetting(activeSetting === s.id ? null : s.id)} className="flex items-center gap-4 p-4 active:bg-secondary/50 transition cursor-pointer">
                <div className="h-10 w-10 rounded-full bg-secondary text-primary grid place-items-center shrink-0">
                  <s.icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold">{s.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{s.desc}</p>
                </div>
                <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${activeSetting === s.id ? "rotate-90" : ""}`} />
              </div>
              {activeSetting === s.id && (
                <div className="px-4 pb-4 animate-in slide-in-from-top-2">
                  <div className="rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary/50 p-4 border border-border">
                    <p className="text-sm font-bold text-foreground flex justify-between items-center">
                      Feature Enabled <Check className="h-4 w-4 text-green-600" />
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">This feature is actively running to keep you safe.</p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="rounded-2xl bg-red-50 p-5 mt-4 border border-red-100 flex flex-col items-center text-center">
          <p className="text-sm font-bold text-red-800">Need emergency help?</p>
          <p className="text-xs text-red-600 mt-1 mb-4">Our emergency response team is available 24/7.</p>
          <button onClick={() => alert("Connecting to emergency services...")} className="rounded-xl bg-red-600 text-white font-bold text-sm px-6 py-2.5 w-full hover:bg-red-700 transition shadow-sm">
            Call Emergency Services
          </button>
        </div>
      </div>
    </PhoneShell>
  );
}

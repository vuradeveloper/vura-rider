import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, MessageSquare, Car, Receipt, AlertCircle, ChevronRight } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";
import { useState } from "react";

export const Route = createFileRoute("/help")({
  head: () => ({ meta: [{ title: "Help — Vura" }] }),
  component: HelpPage,
});

function HelpPage() {
  const [activeTopic, setActiveTopic] = useState<string | null>(null);

  const topics = [
    { id: "trip", icon: Car, title: "Trip Issues and Refunds" },
    { id: "account", icon: Receipt, title: "Account and Payment Options" },
    { id: "safety", icon: AlertCircle, title: "Report a Safety Incident" },
    { id: "support", icon: MessageSquare, title: "Support Messages" },
  ];

  return (
    <PhoneShell hideTabs>
      <div className="hero-gradient text-primary-foreground px-5 pt-4 pb-8 rounded-b-[2rem] relative">
        <Link to="/account" className="absolute top-4 left-4 grid place-items-center h-9 w-9 rounded-full bg-white/20 hover:bg-white/30 transition">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="mt-12 text-2xl font-extrabold tracking-tight">Help</h1>
      </div>

      <div className="px-5 mt-6 flex-1 flex flex-col pb-6 space-y-6 overflow-y-auto">
        <div>
          <h2 className="text-sm font-extrabold text-foreground mb-3">Recent Trip</h2>
          <div className="rounded-2xl bg-surface border border-border shadow-sm p-4 border border-border flex items-center justify-between cursor-pointer hover:border-primary/40 transition">
            <div className="flex items-center gap-4">
              <div className="h-12 w-12 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary flex flex-col items-center justify-center">
                <span className="text-[10px] uppercase font-bold text-muted-foreground leading-none">Jun</span>
                <span className="text-lg font-extrabold text-foreground leading-tight">19</span>
              </div>
              <div>
                <p className="text-sm font-bold">Toyota Prius</p>
                <p className="text-xs text-muted-foreground mt-0.5">R 15.90 • Cancelled</p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <button className="mt-2 text-xs font-bold text-primary w-full text-left ml-2">View all past trips</button>
        </div>

        <div>
          <h2 className="text-sm font-extrabold text-foreground mb-3">All topics</h2>
          <div className="rounded-2xl bg-surface border border-border divide-y divide-border overflow-hidden shadow-sm">
            {topics.map((t) => (
              <div key={t.id}>
                <div onClick={() => setActiveTopic(activeTopic === t.id ? null : t.id)} className="flex items-center gap-3 p-4 active:bg-secondary/50 transition cursor-pointer">
                  <div className="h-8 w-8 rounded-full bg-secondary text-foreground grid place-items-center shrink-0">
                    <t.icon className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-bold flex-1 min-w-0">{t.title}</p>
                  <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${activeTopic === t.id ? "rotate-90" : ""}`} />
                </div>
                {activeTopic === t.id && (
                  <div className="px-4 pb-4 animate-in slide-in-from-top-2">
                    <div className="rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary p-4 border border-border">
                      <p className="text-sm font-bold text-foreground">Support Assistant</p>
                      <p className="text-xs text-muted-foreground mt-1">Our team is available to assist you with {t.title.toLowerCase()}. We typically reply within 2 hours.</p>
                      <button onClick={() => alert("Connecting to support...")} className="mt-3 text-xs font-bold bg-primary text-primary-foreground px-3 py-1.5 rounded-lg shadow-sm">Contact Support</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </PhoneShell>
  );
}

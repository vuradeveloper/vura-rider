import type { ReactNode } from "react";
import { useState, useEffect } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Compass, Receipt, User, Car, Wallet, BarChart3 } from "lucide-react";
import { useAuth } from "@/lib/auth";

function StatusBar() {
  return (
    <div className="flex items-center justify-between px-6 pt-3 pb-1 text-xs font-semibold text-foreground/80">
      <span>9:41</span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-2 rounded-full bg-foreground/70" />
        <span className="inline-block h-2 w-3 rounded-sm bg-foreground/70" />
        <span className="inline-block h-2 w-5 rounded-sm border border-foreground/70" />
      </span>
    </div>
  );
}

const riderTabs = [
  { to: "/", label: "Home", icon: Home },
  { to: "/services", label: "Services", icon: Compass },
  { to: "/activity", label: "Activity", icon: Receipt },
  { to: "/account", label: "Account", icon: User },
] as const;

const driverTabs = [
  { to: "/driver", label: "Drive", icon: Car },
  { to: "/driver/earnings", label: "Earnings", icon: Wallet },
  { to: "/driver/trips", label: "Trips", icon: BarChart3 },
  { to: "/account", label: "Account", icon: User },
] as const;

export function PhoneShell({ children, hideTabs = false }: { children: ReactNode; hideTabs?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const user = useAuth();
  const tabs = user?.role === "driver" ? driverTabs : riderTabs;
  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-accent via-background to-secondary flex items-start justify-center py-6 px-3 sm:py-12">
      <div className="w-full max-w-[420px] phone-frame relative">
        <div className="bg-surface min-h-[820px] flex flex-col">
          <StatusBar />
          <div className="flex-1 flex flex-col">{children}</div>
          {!hideTabs && (
            <nav className="sticky bottom-0 grid grid-cols-4 border-t border-border bg-surface/95 backdrop-blur px-2 pt-2 pb-4">
              {tabs.map((t) => {
                const active = pathname === t.to;
                const Icon = t.icon;
                return (
                  <Link
                    key={t.to}
                    to={t.to}
                    className={`flex flex-col items-center gap-1 py-1.5 text-[11px] font-medium transition-colors ${active ? "text-primary" : "text-muted-foreground"}`}
                  >
                    {active ? (
                      <span className="grid place-items-center h-9 w-9 rounded-md bg-primary text-primary-foreground shadow-soft -mt-5">
                        <Icon className="h-4 w-4" />
                      </span>
                    ) : (
                      <Icon className="h-5 w-5" />
                    )}
                    <span>{t.label}</span>
                  </Link>
                );
              })}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}

import { AnimatedMap } from "@/components/AnimatedMap";

export function FakeMap({ height = 320, mode = "idle", onComplete }: { height?: number, mode?: "idle" | "track", onComplete?: () => void }) {
  return <AnimatedMap height={height} mode={mode} onComplete={onComplete} />;
}

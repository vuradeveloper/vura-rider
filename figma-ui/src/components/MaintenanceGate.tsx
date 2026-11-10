// ─────────────────────────────────────────────────────────────────────────────
// MAINTENANCE GATE — the rider-facing side of the admin kill switch.
//
// GET /api/app-status returns { rider: { maintenance, message } }. While it is
// ON this covers the app with a clear notice, and the server independently
// blocks new bookings. A rider who is ALREADY on a trip only gets a thin top
// banner: covering the live trip screen would be dangerous and would stop them
// from seeing/cancelling/contacting the driver.
//
// Fail OPEN: if the status call fails, the app runs normally rather than
// locking every rider out because one endpoint blipped.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getActiveRide, getAppStatus } from "../lib/backend";

type SideStatus = { maintenance: boolean; message: string };

export function MaintenanceGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SideStatus | null>(null);
  const [hasActiveRide, setHasActiveRide] = useState(false);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const s = await getAppStatus();
      setStatus(s.rider);
    } catch {
      /* fail open */
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  useEffect(() => {
    if (!status?.maintenance) return;
    let alive = true;
    getActiveRide()
      .then((ride: any) => {
        if (alive) setHasActiveRide(Boolean(ride?.id));
      })
      .catch(() => {
        if (alive) setHasActiveRide(false);
      });
    return () => {
      alive = false;
    };
  }, [status?.maintenance]);

  const maintenance = status?.maintenance === true;
  const message = status?.message || "Vura is under maintenance. We'll be back shortly.";

  return (
    <>
      {children}

      {maintenance && hasActiveRide && (
        <div className="fixed top-0 left-0 right-0 z-[9998] bg-[#1A1A1A] text-white px-4 py-2.5 text-center shadow-lg">
          <p className="text-[12px] font-semibold leading-snug">{message}</p>
          <p className="text-[10px] text-white/70 mt-0.5">Your current trip is still active.</p>
        </div>
      )}

      {maintenance && !hasActiveRide && (
        <div className="fixed inset-0 z-[9999] bg-white flex flex-col items-center justify-center px-8 text-center">
          <div className="w-20 h-20 rounded-2xl bg-[#EA4335] flex items-center justify-center shadow-lg shadow-[#EA4335]/30">
            <span className="text-white text-[34px] font-black" style={{ fontFamily: "Space Grotesk, sans-serif" }}>
              V
            </span>
          </div>
          <h1 className="mt-6 text-[24px] font-bold text-[#1A1A1A]" style={{ fontFamily: "Space Grotesk, sans-serif" }}>
            Vura is under maintenance
          </h1>
          <p className="mt-3 text-[14px] text-[#6B6B6B] leading-relaxed max-w-sm">{message}</p>
          <p className="mt-2 text-[12px] text-[#ADADAD]">
            We’re making things better. Please try again shortly.
          </p>
          <button
            onClick={() => void check()}
            disabled={checking}
            className="mt-7 rounded-2xl bg-[#EA4335] px-8 py-3.5 text-[14px] font-semibold text-white active:bg-[#C5221F] disabled:opacity-60"
          >
            {checking ? "Checking…" : "Check again"}
          </button>
          <p className="mt-8 text-[10px] uppercase tracking-[0.24em] text-[#C4C4C4]">Vura Ride</p>
        </div>
      )}
    </>
  );
}

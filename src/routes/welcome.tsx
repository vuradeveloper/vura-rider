import { createFileRoute, Link } from "@tanstack/react-router";
import { Car, ChevronRight } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";

export const Route = createFileRoute("/welcome")({
  head: () => ({ meta: [{ title: "Welcome to Vura Ride" }] }),
  component: Welcome,
});

function Welcome() {
  return (
    <PhoneShell hideTabs>
      <div className="hero-gradient text-primary-foreground flex-1 flex flex-col px-6 pt-10 pb-8 rounded-b-[2rem] relative overflow-hidden">
        <div className="absolute -right-16 -top-10 h-56 w-56 rounded-full bg-white/10" />
        <div className="absolute -left-10 bottom-24 h-40 w-40 rounded-full bg-white/10" />

        <div className="flex items-center gap-2 relative">
          <div className="grid place-items-center h-10 w-10 rounded-2xl bg-white/15 backdrop-blur">
            <Car className="h-5 w-5" />
          </div>
          <span className="text-lg font-extrabold tracking-tight">Vura Ride</span>
        </div>

        <div className="mt-auto relative">
          <h1 className="text-3xl font-extrabold leading-tight">Go anywhere. <br />Get anything.</h1>
          <p className="mt-3 text-sm opacity-90 max-w-[18rem]">
            Request a ride, hop in, and relax. Drive on your terms — earn whenever you want.
          </p>
        </div>
      </div>

      <div className="px-6 py-6 space-y-3 bg-surface">
        <Link
          to="/signup"
          className="flex items-center justify-center gap-2 rounded-full bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm"
        >
          Create an account <ChevronRight className="h-4 w-4" />
        </Link>
        <Link
          to="/login"
          className="flex items-center justify-center rounded-full border border-border bg-surface py-4 text-sm font-bold"
        >
          I already have an account
        </Link>
        <p className="text-[11px] text-center text-muted-foreground mt-3 px-4">
          By continuing, you agree to Vura Ride's Terms of Service and Privacy Policy.
        </p>
      </div>
    </PhoneShell>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Phone, MessageCircle, Shield, Star, X, Share2, AlertTriangle } from "lucide-react";
import { PhoneShell, FakeMap } from "@/components/PhoneShell";
import { useState } from "react";

export const Route = createFileRoute("/ride/track")({
  head: () => ({ meta: [{ title: "Your driver is on the way — Vura" }] }),
  component: Track,
});

function Track() {
  const navigate = useNavigate();
  const [showCancel, setShowCancel] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [rating, setRating] = useState(0);

  const cancelOptions = [
    "Driver is taking too long",
    "Driver asked me to cancel",
    "I accidentally requested",
    "Wait time was too long",
    "Driver isn't moving",
    "My pickup location is wrong"
  ];

  return (
    <PhoneShell hideTabs>
      <div className="relative">
        <FakeMap height={420} mode="track" onComplete={() => setIsCompleted(true)} />
        <Link to="/" className="absolute top-3 right-4 grid place-items-center h-9 w-9 rounded-full bg-surface border border-border shadow-sm">
          <X className="h-4 w-4" />
        </Link>
        <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-foreground text-background px-4 py-1.5 text-xs font-bold shadow-float">
          Arriving in 3 min
        </div>
        <div className="absolute top-14 left-1/2 -translate-x-1/2 rounded-full bg-green-100 border border-green-200 text-green-800 px-3 py-1 text-[10px] font-bold shadow-float flex items-center gap-1">
          <Shield className="h-3 w-3" /> Smart Safety Active
        </div>
      </div>

      <div className="-mt-6 rounded-t-3xl bg-surface px-5 pt-5 pb-4 flex-1 flex flex-col shadow-float">
        <div className="mx-auto h-1.5 w-12 rounded-full bg-border mb-4" />

        <div className="flex items-center gap-3">
          <div className="h-14 w-14 rounded-full bg-gradient-to-br from-primary to-primary/60 grid place-items-center text-primary-foreground font-bold text-lg">
            MR
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-1">
              <p className="font-bold">Marcus R.</p>
              <span className="flex items-center gap-0.5 text-xs font-semibold ml-1">
                <Star className="h-3 w-3 fill-primary text-primary" /> 4.96
              </span>
            </div>
            <p className="text-xs text-muted-foreground">Toyota Prius · Silver</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-extrabold tracking-tight">LX24 PQR</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Plate</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-2">
          <button className="flex flex-col items-center gap-1 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary py-3 text-xs font-semibold">
            <Phone className="h-4 w-4 text-primary" /> Call
          </button>
          <button className="flex flex-col items-center gap-1 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary py-3 text-xs font-semibold">
            <MessageCircle className="h-4 w-4 text-primary" /> Chat
          </button>
          <button className="flex flex-col items-center gap-1 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary py-3 text-xs font-semibold" onClick={() => alert("Ride link copied to clipboard!")}>
            <Share2 className="h-4 w-4 text-primary" /> Share
          </button>
          <button className="flex flex-col items-center gap-1 rounded-xl bg-red-50 text-red-700 py-3 text-xs font-bold border border-red-200" onClick={() => alert("SOS Triggered! Dispatching emergency services.")}>
            <AlertTriangle className="h-4 w-4 text-red-600" /> SOS
          </button>
        </div>

        <div className="mt-4 rounded-md border border-border p-3.5">
          <p className="text-[11px] uppercase tracking-wider font-bold text-muted-foreground">Trip</p>
          <div className="mt-2 flex items-start gap-3 text-sm">
            <div className="flex flex-col items-center pt-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-foreground" />
              <span className="w-px h-6 border-l-2 border-dashed border-muted-foreground/40" />
              <span className="h-2.5 w-2.5 rounded-md bg-primary" />
            </div>
            <div className="flex-1 space-y-3">
              <p className="font-medium leading-tight">Current location</p>
              <p className="font-medium leading-tight">Shoreditch High St, London</p>
            </div>
            <p className="text-sm font-extrabold">R15.90</p>
          </div>
        </div>

        <button onClick={() => setShowCancel(true)} className="mt-auto grid place-items-center rounded-md bg-secondary py-3.5 text-sm font-bold w-full hover:bg-secondary/80 transition">
          Cancel trip
        </button>
      </div>

      {showCancel && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end">
          <div className="w-full bg-surface rounded-t-[2rem] p-5 shadow-float animate-in slide-in-from-bottom">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">Why are you cancelling?</h3>
              <button onClick={() => setShowCancel(false)} className="h-8 w-8 rounded-full bg-secondary grid place-items-center hover:bg-secondary/80 transition"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-2">
              {cancelOptions.map((opt, i) => (
                <button
                  key={i}
                  onClick={() => { setShowCancel(false); navigate({ to: "/" }); }}
                  className="w-full text-left px-4 py-3.5 rounded-full border border-border bg-surface hover:bg-secondary/50 transition text-sm font-semibold"
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isCompleted && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end">
          <div className="w-full bg-surface rounded-t-[2rem] p-6 shadow-float animate-in slide-in-from-bottom">
            <h3 className="text-xl font-extrabold text-center mb-1">Rate your driver</h3>
            <p className="text-sm text-center text-muted-foreground mb-6">How was your trip with Marcus R.?</p>
            
            <div className="flex justify-center gap-2 mb-6">
              {[1, 2, 3, 4, 5].map((star) => (
                <button 
                  key={star} 
                  onClick={() => setRating(star)}
                  className="p-1 transition hover:scale-110 active:scale-95"
                >
                  <Star className={`h-10 w-10 ${rating >= star ? "fill-primary text-primary" : "text-border"}`} />
                </button>
              ))}
            </div>

            <textarea 
              placeholder="Add a comment (optional)"
              className="w-full rounded-md border border-border bg-secondary px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none resize-none h-24 mb-6"
            />

            <button 
              disabled={rating === 0}
              onClick={() => navigate({ to: "/" })}
              className="w-full rounded-md bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm hover:bg-primary/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Submit Rating
            </button>
          </div>
        </div>
      )}
    </PhoneShell>
  );
}

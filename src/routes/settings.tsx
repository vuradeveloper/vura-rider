import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Save, Upload, FileText, BadgeCheck } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";
import { useAuth, setUser } from "@/lib/auth";
import { useState, useRef } from "react";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — Vura" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const user = useAuth();
  const nav = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState(user?.phone || "");
  const [idNumber, setIdNumber] = useState(user?.idNumber || "");
  const [docName, setDocName] = useState(
    (user?.role === "driver" ? user?.licenseDocumentName : user?.idDocumentName) || ""
  );

  if (!user) return null;

  const isDriver = user.role === "driver";

  let progress = 0;
  if (idNumber) progress += 50;
  if (docName) progress += 50;
  const isVerified = progress === 100;

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setUser({
      ...user!,
      name,
      email,
      phone,
      idNumber,
      ...(isDriver ? { licenseDocumentName: docName } : { idDocumentName: docName }),
    });
    nav({ to: "/account" });
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      setDocName(file.name);
    }
  }

  return (
    <PhoneShell hideTabs>
      <div className="hero-gradient text-primary-foreground px-5 pt-4 pb-8 rounded-b-[2rem] relative">
        <Link to="/account" className="absolute top-4 left-4 grid place-items-center h-9 w-9 rounded-full bg-white/20 hover:bg-white/30 transition">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="mt-12 text-2xl font-extrabold tracking-tight">Settings</h1>
        <p className="text-sm opacity-85 mt-1">Update your personal details</p>
      </div>

      <div className="px-5 mt-6 flex-1 flex flex-col">
        <form onSubmit={handleSave} className="flex-1 flex flex-col gap-4">
          <div className="space-y-2 mb-2">
            <div className="flex items-center justify-between">
              <span className={`text-sm font-bold flex items-center gap-2 transition ${isVerified ? "text-[#10b981]" : "text-muted-foreground"}`}>
                <BadgeCheck className="h-5 w-5" />
                {isVerified ? "Verified Account" : "Verification in progress"}
              </span>
              <span className="text-xs font-semibold text-muted-foreground">{progress}%</span>
            </div>
            <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-secondary">
              <div 
                className={`h-full transition-all duration-500 ease-in-out ${isVerified ? "bg-[#10b981]" : "bg-muted-foreground"}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-muted-foreground ml-1">Full Name</label>
            <input
              required
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-muted-foreground ml-1">Email Address</label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          
          <div className="space-y-1">
            <label className="text-xs font-bold text-muted-foreground ml-1">Phone Number</label>
            <input
              required
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-muted-foreground ml-1">ID Number</label>
            <input
              type="text"
              placeholder="Enter your ID Number"
              value={idNumber}
              onChange={(e) => setIdNumber(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-4 py-3.5 text-sm font-semibold transition focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div className="space-y-1 mt-2">
            <label className="text-xs font-bold text-muted-foreground ml-1">
              {isDriver ? "Driver's License Document" : "ID Document"}
            </label>
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="w-full border-2 border-dashed border-border rounded-md p-6 flex flex-col items-center justify-center gap-2 bg-surface cursor-pointer hover:border-primary/50 transition text-center"
            >
              {docName ? (
                <>
                  <FileText className="h-6 w-6 text-primary" />
                  <span className="text-sm font-bold text-primary truncate max-w-full px-4">{docName}</span>
                </>
              ) : (
                <>
                  <Upload className="h-6 w-6 text-muted-foreground" />
                  <span className="text-sm font-semibold text-muted-foreground">
                    Tap to upload {isDriver ? "Driver's License" : "ID Document"}
                  </span>
                </>
              )}
            </div>
            <input 
              type="file" 
              className="hidden" 
              ref={fileInputRef}
              onChange={handleFileChange}
              accept="image/*,.pdf"
            />
          </div>

          {isDriver && (
            <div className="mt-2 pt-4 border-t border-border">
              <Link to="/driver/vehicle" className="flex items-center justify-between p-4 rounded-md bg-secondary hover:bg-secondary/80 transition">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-md bg-primary/10 grid place-items-center text-primary">
                    <BadgeCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold">Vehicle Verification</p>
                    <p className="text-xs text-muted-foreground">PRDP & Scans</p>
                  </div>
                </div>
                <ArrowLeft className="h-4 w-4 rotate-180 text-muted-foreground" />
              </Link>
            </div>
          )}

          <div className="mt-auto pt-6 pb-6">
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-2 rounded-md bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] transition"
            >
              <Save className="h-4 w-4" /> Save Changes
            </button>
          </div>
        </form>
      </div>
    </PhoneShell>
  );
}

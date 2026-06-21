import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, User, Car } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";
import { setUser, type Role } from "@/lib/auth";
import { countries } from "@/lib/countries";

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Create account — Vura" }] }),
  component: Signup,
});

function Signup() {
  const nav = useNavigate();
  const role: Role = "rider";
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [countryCode, setCountryCode] = useState("+44");
  const [phone, setPhone] = useState("");
  const [pwd, setPwd] = useState("");
  const [otp, setOtp] = useState("");

  function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    setStep(2);
  }

  function submitOtp(e: React.FormEvent) {
    e.preventDefault();
    setUser({ name: name || "New rider", email, phone: `${countryCode} ${phone}`, role });
    nav({ to: "/" });
  }

  return (
    <PhoneShell hideTabs>
      <div className="px-5 pt-3 pb-2 flex items-center gap-3">
        <Link to="/welcome" className="grid place-items-center h-9 w-9 rounded-full bg-secondary">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-base font-bold">Create account</h1>
      </div>

      {step === 1 ? (
        <div className="px-5 pt-4 pb-6 flex-1 flex flex-col justify-center relative z-10">
          <div className="bg-surface border border-border shadow-md rounded-[1.5rem] p-6 pb-8">
            <h2 className="text-2xl font-extrabold tracking-tight">Your details</h2>
            <p className="text-sm text-muted-foreground mt-1 mb-5">Signing up as <span className="font-bold text-primary capitalize">{role}</span></p>

            <form onSubmit={submitDetails} className="space-y-4">
              {[
                { label: "Full name", value: name, set: setName, type: "text", placeholder: "Sagar Dash", isPhone: false },
                { label: "Email", value: email, set: setEmail, type: "email", placeholder: "you@email.com", isPhone: false },
                { label: "Phone", value: phone, set: setPhone, type: "tel", placeholder: "7700 900123", isPhone: true },
                { label: "Password", value: pwd, set: setPwd, type: "password", placeholder: "••••••••", isPhone: false },
              ].map((f) => (
                <label key={f.label} className="block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">{f.label}</span>
                  {f.isPhone ? (
                    <div className="mt-1 flex gap-2">
                      <select
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value)}
                        className="w-24 rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-3 text-sm font-medium outline-none appearance-none text-center"
                      >
                        {countries.map((c) => (
                          <option key={c.code} value={c.dial_code}>
                            {c.flag} {c.dial_code}
                          </option>
                        ))}
                      </select>
                      <input
                        type={f.type}
                        value={f.value}
                        onChange={(e) => f.set(e.target.value)}
                        placeholder={f.placeholder}
                        required
                        className="flex-1 w-full rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-3 text-sm font-medium outline-none"
                      />
                    </div>
                  ) : (
                    <input
                      type={f.type}
                      value={f.value}
                      onChange={(e) => f.set(e.target.value)}
                      placeholder={f.placeholder}
                      required
                      className="mt-1 w-full rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-3 text-sm font-medium outline-none"
                    />
                  )}
                </label>
              ))}

              <button
                type="submit"
                className="mt-6 w-full rounded-full bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] transition"
              >
                Continue
              </button>
            </form>
          </div>

          <p className="mt-8 text-center text-sm font-medium">
            Already have one?{" "}
            <Link to="/login" className="font-bold text-primary hover:underline">Sign in</Link>
          </p>
        </div>
      ) : (
        <div className="px-5 pt-4 pb-6 flex-1 flex flex-col justify-center relative z-10">
          <div className="bg-surface border border-border shadow-md rounded-[1.5rem] p-6 pb-8">
            <h2 className="text-2xl font-extrabold tracking-tight">Verify your number</h2>
            <p className="text-sm text-muted-foreground mt-1 mb-5">We sent an SMS code to <span className="font-bold text-foreground">{countryCode} {phone}</span></p>

            <form onSubmit={submitOtp} className="space-y-4">
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Verification Code</span>
                <input
                  type="text"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  required
                  className="mt-1 w-full rounded-full bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-4 text-center text-2xl font-extrabold tracking-widest outline-none"
                />
              </label>

              <button
                type="submit"
                disabled={otp.length < 4}
                className="mt-6 w-full rounded-full bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm disabled:opacity-50 active:scale-[0.99] transition"
              >
                Create account
              </button>
            </form>
          </div>

          <button
            type="button"
            onClick={() => setStep(1)}
            className="mt-8 w-full text-center text-sm font-bold text-primary hover:underline"
          >
            Go back
          </button>
        </div>
      )}
    </PhoneShell>
  );
}

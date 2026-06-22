import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";
import { setUser, type Role } from "@/lib/auth";
import { countries } from "@/lib/countries";
import { sendVerificationEmail } from "@/lib/email";
import { toast } from "sonner";

declare global {
  interface Window {
    grecaptcha: any;
    onRecaptchaLoad: () => void;
  }
}

export const Route = createFileRoute("/signup")({
  head: () => ({ meta: [{ title: "Create account — Vura" }] }),
  component: Signup,
});
function Signup() {
  const nav = useNavigate();
  const role: Role = "rider";
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [countryCode, setCountryCode] = useState("+44");
  const [phone, setPhone] = useState("");
  const [pwd, setPwd] = useState("");
  
  const [sendingEmail, setSendingEmail] = useState(false);
  const [generatedCode, setGeneratedCode] = useState("");
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState("");

  // Step 4 Personal Information
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [idNumber, setIdNumber] = useState("");

  // Load and render Google reCAPTCHA dynamically when step 2 is active
  useEffect(() => {
    if (step === 2) {
      // Clear previous container content to prevent duplicate render errors
      const container = document.getElementById("recaptcha-container");
      if (container) {
        container.innerHTML = "";
      }

      const scriptId = "google-recaptcha-script";
      let script = document.getElementById(scriptId) as HTMLScriptElement;

      const renderRecaptcha = () => {
        if (window.grecaptcha && document.getElementById("recaptcha-container")) {
          try {
            window.grecaptcha.render("recaptcha-container", {
              sitekey: "6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI", // Google's official test sitekey (always passes)
              callback: (token: string) => {
                toast.success("Robot check passed!");
                setTimeout(() => {
                  triggerEmailSend();
                }, 1000);
              },
            });
          } catch (e) {
            console.error("Error rendering reCAPTCHA:", e);
          }
        }
      };

      if (window.grecaptcha) {
        renderRecaptcha();
      } else {
        if (!script) {
          script = document.createElement("script");
          script.id = scriptId;
          script.src = "https://www.google.com/recaptcha/api.js?onload=onRecaptchaLoad&render=explicit";
          script.async = true;
          script.defer = true;
          document.body.appendChild(script);
        }
        window.onRecaptchaLoad = () => {
          renderRecaptcha();
        };
      }
    }
  }, [step]);

  // Handle Submit Details
  function submitDetails(e: React.FormEvent) {
    e.preventDefault();
    setStep(2); // Go to Robot Verification
  }

  // Trigger Email Sending and transition to Step 3
  async function triggerEmailSend() {
    setSendingEmail(true);
    setOtpError("");

    // Generate a 6-digit random code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    setGeneratedCode(code);

    try {
      const res = await sendVerificationEmail({ data: { email, code } });
      if (res.success) {
        toast.success("Verification code sent to your email!");
        setStep(3);
      } else {
        toast.error(res.error || "Failed to send verification email. Please check configuration.");
        setStep(1); // Go back to start
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to send verification email due to server error.");
      setStep(1); // Go back to start
    } finally {
      setSendingEmail(false);
    }
  }

  // Handle Submit OTP
  function submitOtp(e: React.FormEvent) {
    e.preventDefault();
    if (otp === generatedCode) {
      toast.success("Email verified!");
      setStep(4); // Go to Personal Information
    } else {
      setOtpError("Invalid verification code. Please try again.");
      toast.error("Invalid verification code");
    }
  }

  // Handle Personal Info Submit
  function submitPersonalInfo(e: React.FormEvent) {
    e.preventDefault();
    setUser({ 
      name: `${firstName} ${lastName}`, 
      email, 
      phone: `${countryCode} ${phone}`, 
      role, 
      idNumber 
    });
    toast.success("Account created successfully!");
    nav({ to: "/" });
  }

  return (
    <PhoneShell hideTabs>
      <div className="px-5 pt-3 pb-3 flex items-center justify-between border-b border-border bg-background">
        <Link 
          to={step <= 1 ? "/welcome" : undefined}
          onClick={step > 1 ? () => setStep((s) => (s - 1) as any) : undefined}
          className="grid place-items-center h-9 w-9 rounded-full bg-secondary cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4 text-foreground/80" />
        </Link>
        <span className="text-sm font-bold text-foreground">Create account</span>
        <div className="w-9 h-9" />
      </div>

      <div className="flex gap-2 px-5 py-2">
        {[1, 2, 3, 4].map((s) => (
          <div 
            key={s} 
            className={`h-1 flex-1 rounded-full transition-all duration-300 ${
              step >= s ? "bg-primary" : "bg-secondary"
            }`}
          />
        ))}
      </div>

      {step === 1 && (
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
                        className="w-20 rounded-lg bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-1 py-1.5 text-xs font-medium outline-none text-muted-foreground"
                      >
                        {countries.sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
                          <option key={c.code} value={c.dial_code} className="text-foreground">
                            {c.flag} {c.name} {c.dial_code}
                          </option>
                        ))}
                      </select>
                      <input
                        type={f.type}
                        value={f.value}
                        onChange={(e) => f.set(e.target.value)}
                        placeholder={f.placeholder}
                        required
                        className="flex-1 w-full rounded-xl bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-3 text-sm font-medium outline-none"
                      />
                    </div>
                  ) : (
                    <input
                      type={f.type}
                      value={f.value}
                      onChange={(e) => f.set(e.target.value)}
                      placeholder={f.placeholder}
                      required
                      className="mt-1 w-full rounded-xl bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-3 text-sm font-medium outline-none"
                    />
                  )}
                </label>
              ))}

              <button
                type="submit"
                className="mt-6 w-full rounded-2xl bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] transition flex items-center justify-center gap-2"
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
      )}

      {step === 2 && (
        <div className="px-5 pt-4 pb-6 flex-1 flex flex-col justify-center relative z-10">
          <div className="bg-surface border border-border shadow-md rounded-[1.5rem] p-6 pb-8 text-center flex flex-col items-center">
            <ShieldCheck className="h-12 w-12 text-primary mb-4 animate-bounce" />
            <h2 className="text-2xl font-extrabold tracking-tight">Security Check</h2>
            <p className="text-sm text-muted-foreground mt-1 mb-8">
              Verify you are not a robot to receive your email code.
            </p>

            {/* Real Google reCAPTCHA Container */}
            <div className="min-h-[78px] flex items-center justify-center">
              <div id="recaptcha-container"></div>
            </div>

            {sendingEmail && (
              <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Sending verification email...
              </div>
            )}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="px-5 pt-4 pb-6 flex-1 flex flex-col justify-center relative z-10">
          <div className="bg-surface border border-border shadow-md rounded-[1.5rem] p-6 pb-8">
            <h2 className="text-2xl font-extrabold tracking-tight">Verify your email</h2>
            <p className="text-sm text-muted-foreground mt-1 mb-5">We sent a verification code to <span className="font-bold text-foreground">{email}</span></p>

            <form onSubmit={submitOtp} className="space-y-4">
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Verification Code</span>
                <input
                  type="text"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => {
                    setOtp(e.target.value.replace(/\D/g, ''));
                    setOtpError("");
                  }}
                  placeholder="123456"
                  required
                  className="mt-1 w-full rounded-xl bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-4 text-center text-2xl font-extrabold tracking-widest outline-none"
                />
              </label>

              {otpError && (
                <p className="text-xs text-red-500 font-semibold text-center mt-1">{otpError}</p>
              )}

              <button
                type="submit"
                disabled={otp.length < 4}
                className="mt-6 w-full rounded-2xl bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm disabled:opacity-50 active:scale-[0.99] transition"
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

      {step === 4 && (
        <div className="px-5 pt-4 pb-6 flex-1 flex flex-col justify-start relative z-10 overflow-y-auto">
          <div className="bg-surface border border-border shadow-md rounded-[1.5rem] p-6 pb-8 space-y-5">
            <div>
              <h2 className="text-xl font-extrabold tracking-tight text-foreground">Personal information</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Only your first name and vehicle details are visible to clients during the booking.
              </p>
              <p className="text-xs font-semibold text-primary mt-3 cursor-pointer hover:underline">
                Need help getting documents? Click here!
              </p>
            </div>

            <form onSubmit={submitPersonalInfo} className="space-y-4 text-left">
              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">First name *</span>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="First name"
                  required
                  className="mt-1 w-full rounded-xl bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-3 text-sm font-medium outline-none"
                />
              </label>

              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Last name *</span>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Last name"
                  required
                  className="mt-1 w-full rounded-xl bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-3 text-sm font-medium outline-none"
                />
              </label>

              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Date of Birth *</span>
                <div className="relative mt-1">
                  <input
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    required
                    className="w-full rounded-xl bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-3 text-sm font-medium outline-none text-muted-foreground"
                  />
                </div>
              </label>

              <label className="block">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">ID Number or Passport Number *</span>
                <input
                  type="text"
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  placeholder="Enter your ID or passport number"
                  required
                  className="mt-1 w-full rounded-xl bg-secondary border border-transparent transition-colors focus-within:bg-background focus-within:border-primary focus:bg-background focus:border-primary px-3 py-3 text-sm font-medium outline-none"
                />
                <p className="text-[10px] text-muted-foreground mt-1 ml-1 leading-normal">
                  Your ID number is used for identity verification purposes.
                </p>
              </label>

              <button
                type="submit"
                className="mt-6 w-full rounded-2xl bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] transition"
              >
                Create account
              </button>
            </form>
          </div>
        </div>
      )}
    </PhoneShell>
  );
}

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Eye, EyeOff, Mail, Lock } from "lucide-react";
import { PhoneShell } from "@/components/PhoneShell";
import { setUser, type Role } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — Vura" }] }),
  component: Login,
});

function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("sagar@vura.app");
  const [pwd, setPwd] = useState("password");
  const [show, setShow] = useState(false);
  const role: Role = "rider";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setUser({ name: email.split("@")[0] || "Rider", email, role });
    nav({ to: "/" });
  }

  return (
    <PhoneShell hideTabs>
      <div className="px-5 pt-3 pb-2 flex items-center gap-3">
        <Link to="/welcome" className="grid place-items-center h-9 w-9 rounded-full bg-secondary">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-base font-bold">Sign in</h1>
      </div>

      <div className="px-5 pt-4 pb-6 flex-1 flex flex-col justify-center relative z-10">
        <div className="bg-surface border border-border shadow-md rounded-[1.5rem] p-6 pb-8">
          <h2 className="text-2xl font-extrabold tracking-tight">Welcome back</h2>
          <p className="text-sm text-muted-foreground mt-1 mb-5">Enter your details to continue.</p>

          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Email</span>
              <div className="mt-1 flex items-center gap-2 rounded-full bg-secondary border border-transparent focus-within:bg-background focus-within:border-primary px-4 py-3 transition-colors">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="flex-1 bg-transparent text-sm font-medium outline-none px-1"
                  required
                />
              </div>
            </label>
            <label className="block">
              <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">Password</span>
              <div className="mt-1 flex items-center gap-2 rounded-full bg-secondary border border-transparent focus-within:bg-background focus-within:border-primary px-4 py-3 transition-colors">
                <Lock className="h-4 w-4 text-muted-foreground" />
                <input
                  type={show ? "text" : "password"}
                  value={pwd}
                  onChange={(e) => setPwd(e.target.value)}
                  className="flex-1 bg-transparent text-sm font-medium outline-none px-1"
                  required
                />
                <button type="button" onClick={() => setShow((s) => !s)} className="text-muted-foreground">
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>

            <div className="flex justify-end mt-1 mb-2">
              <Link to="/login" className="text-xs font-semibold text-primary hover:underline">Forgot password?</Link>
            </div>

            <button
              type="submit"
              className="w-full rounded-full bg-primary py-4 text-sm font-bold text-primary-foreground shadow-sm active:scale-[0.99] transition mt-2"
            >
              Sign in
            </button>
          </form>

          <div className="mt-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" /> or continue with <span className="h-px flex-1 bg-border" />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {["Google", "Apple", "Phone"].map((p) => (
              <button key={p} className="rounded-full border border-border py-2.5 text-xs font-bold transition hover:border-primary/40 shadow-sm">{p}</button>
            ))}
          </div>
        </div>

        <p className="mt-8 text-center text-sm font-medium">
          New to Vura Ride?{" "}
          <Link to="/signup" className="font-bold text-primary hover:underline">Create account</Link>
        </p>
      </div>
    </PhoneShell>
  );
}

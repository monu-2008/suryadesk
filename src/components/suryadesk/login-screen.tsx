"use client";
// SuryaDesk authentication screen — premium split layout with demo access.
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Eye, EyeOff, Loader2, Mail, Lock, Building2, User as UserIcon, ArrowLeft, ShieldCheck, Sparkles, MapPin, ChevronRight, Info } from "lucide-react";
import { api } from "@/lib/surya/client";
import { SuryaLogo } from "./shared/bits";
import { DemoBadge } from "./shared/bits";
import { cn } from "@/lib/utils";

type Mode = "signin" | "signup" | "forgot" | "reset" | "verify";

export default function LoginScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [city, setCity] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [needsVerification, setNeedsVerification] = useState<string | null>(null);

  const go = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const signIn = (e?: React.FormEvent) => {
    e?.preventDefault();
    return go(async () => {
      try {
        await api("/api/auth/login", { method: "POST", json: { email, password } });
        onAuthenticated();
      } catch (err) {
        const ae = err as { status: number; data?: { needsVerification?: boolean; email?: string } };
        if (ae.status === 403 && ae.data?.needsVerification) {
          setMode("verify");
          setNeedsVerification(ae.data.email ?? email);
          setInfo("Your email is not confirmed yet. Verify it to activate your account.");
          return;
        }
        throw err;
      }
    });
  };

  const signInDemo = (demoEmail: string, demoPassword: string) => {
    setEmail(demoEmail);
    setPassword(demoPassword);
    setMode("signin");
    setBusy(true);
    setError(null);
    setInfo(null);
    api("/api/auth/login", { method: "POST", json: { email: demoEmail, password: demoPassword } })
      .then(() => onAuthenticated())
      .catch((e) => setError(e instanceof Error ? e.message : "Login failed"))
      .finally(() => setBusy(false));
  };

  const submitSignup = (e: React.FormEvent) => {
    e.preventDefault();
    return go(async () => {
      const res = await api<{ message: string }>("/api/auth/register", {
        method: "POST",
        json: { name, email, password, organizationName: orgName, city },
      });
      setMode("verify");
      setNeedsVerification(email);
      setInfo(res.message);
    });
  };

  const submitForgot = (e: React.FormEvent) => {
    e.preventDefault();
    return go(async () => {
      const res = await api<{ demoResetToken?: string; smtpConfigured: boolean; message: string }>("/api/auth/forgot", {
        method: "POST",
        json: { email },
      });
      if (res.demoResetToken) {
        setResetToken(res.demoResetToken);
        setMode("reset");
        setInfo("Demo mode: SMTP is not configured, so the reset token is provided here directly.");
      } else {
        setInfo(res.message);
      }
    });
  };

  const submitReset = (e: React.FormEvent) => {
    e.preventDefault();
    return go(async () => {
      const res = await api<{ message: string }>("/api/auth/reset", { method: "POST", json: { token: resetToken, password: newPassword } });
      setMode("signin");
      setInfo(res.message);
      setPassword("");
    });
  };

  const verifyDemo = () => {
    if (!needsVerification) return;
    return go(async () => {
      const res = await api<{ message: string }>("/api/auth/verify-demo", { method: "POST", json: { email: needsVerification } });
      setMode("signin");
      setNeedsVerification(null);
      setInfo(res.message);
    });
  };

  const demoAccounts = [
    { role: "Owner", name: "Priya Sharma", email: "owner@demo.suryadesk.in", password: "Demo@1234", desc: "Full company workspace & analytics" },
    { role: "Manager", name: "Arjun Mehta", email: "manager@demo.suryadesk.in", password: "Demo@1234", desc: "Requests, assignments & job board" },
    { role: "Technician", name: "Ravi Kumar", email: "tech1@demo.suryadesk.in", password: "Demo@1234", desc: "Mobile field app with offline sync" },
    { role: "Customer", name: "Anita Deshmukh", email: "customer@demo.suryadesk.in", password: "Demo@1234", desc: "Homeowner portal & service history" },
  ];

  return (
    <div className="min-h-screen bg-sd-cream flex flex-col">
      {/* mobile header */}
      <div className="lg:hidden px-5 pt-6 pb-2 flex items-center justify-between">
        <SuryaLogo size={30} />
        <DemoBadge />
      </div>

      <div className="flex-1 flex flex-col lg:flex-row w-full max-w-7xl mx-auto">
        {/* left panel */}
        <div className="relative hidden lg:flex flex-col w-[46%] p-10 xl:p-14 gap-8 overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[#104B3D] via-[#176B52] to-[#1D7A5D]" />
          <div className="absolute -right-24 -top-24 -z-10 w-96 h-96 rounded-full bg-[#F2B84B]/20 blur-3xl" />
          <div className="absolute left-10 bottom-24 -z-10 w-72 h-72 rounded-full bg-white/10 blur-3xl" />
          <SuryaLogo size={40} light />
          <div className="flex-1 flex flex-col justify-center">
            <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
              { }
              <img
                src="/suryadesk/login-art.png"
                alt="Illustration of a rooftop solar installation with warm sunlight"
                className="w-full max-w-[420px] rounded-3xl shadow-2xl border border-white/20"
              />
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.6 }}
              className="text-white text-[2.1rem] xl:text-[2.5rem] font-bold tracking-tight leading-tight mt-8"
            >
              Keep every solar service on track.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.6 }}
              className="text-white/75 text-[0.95rem] mt-3 max-w-md leading-relaxed"
            >
              The after-sales workspace for solar installation companies — customers, AMC contracts, maintenance scheduling, field jobs and verified proof of service.
            </motion.p>
            <div className="flex flex-wrap gap-2.5 mt-6">
              {["OTP proof of service", "Offline-first field app", "AI triage assistant"].map((f) => (
                <span key={f} className="text-white/85 text-xs font-medium bg-white/10 border border-white/15 rounded-full px-3.5 py-1.5 backdrop-blur">
                  {f}
                </span>
              ))}
            </div>
          </div>
          <p className="text-white/50 text-xs">Demo dataset is fictional. © SuryaDesk</p>
        </div>

        {/* right panel */}
        <div className="flex-1 flex items-center justify-center p-5 sm:p-10">
          <div className="w-full max-w-md">
            <AnimatePresence mode="wait">
              {mode === "signin" && (
                <motion.div key="signin" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
                  <div className="sd-clay p-7 sm:p-8">
                    <div className="flex items-center justify-between mb-1">
                      <h2 className="text-xl font-bold text-sd-ink">Welcome back</h2>
                      <span className="hidden lg:inline"><DemoBadge /></span>
                    </div>
                    <p className="text-sm text-sd-ink-soft mb-6">Sign in to your SuryaDesk workspace.</p>

                    <form onSubmit={signIn} className="space-y-4">
                      <div>
                        <label htmlFor="email" className="text-[0.8rem] font-medium text-sd-ink mb-1.5 block">Email address</label>
                        <div className="relative">
                          <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sd-ink-soft" />
                          <input
                            id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@company.in"
                            className="w-full sd-inset py-3 pl-10 pr-4 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-sd-forest/40"
                          />
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label htmlFor="password" className="text-[0.8rem] font-medium text-sd-ink">SuryaDesk password</label>
                          <button type="button" onClick={() => setMode("forgot")} className="text-xs text-sd-forest font-medium hover:underline">
                            Forgot password?
                          </button>
                        </div>
                        <div className="relative">
                          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-sd-ink-soft" />
                          <input
                            id="password" type={showPassword ? "text" : "password"} required autoComplete="current-password" value={password}
                            onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                            className="w-full sd-inset py-3 pl-10 pr-11 text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none focus:ring-2 focus:ring-sd-forest/40"
                          />
                          <button type="button" onClick={() => setShowPassword((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-sd-ink-soft hover:text-sd-ink" aria-label={showPassword ? "Hide password" : "Show password"}>
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        <p className="text-[0.68rem] text-sd-ink-soft mt-1.5 flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" /> This is your SuryaDesk password — we never ask for your Google password.
                        </p>
                      </div>

                      {error && <div className="text-[0.8rem] text-[#a03340] bg-[#C94B55]/8 rounded-xl px-4 py-3">{error}</div>}
                      {info && <div className="text-[0.8rem] text-sd-forest bg-sd-forest/8 rounded-xl px-4 py-3">{info}</div>}

                      <button type="submit" disabled={busy} className="sd-btn-primary w-full py-3.5 font-semibold text-sm flex items-center justify-center gap-2">
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Sign in
                      </button>
                    </form>

                    <div className="flex items-center gap-3 my-5">
                      <div className="h-px bg-sd-line flex-1" />
                      <span className="text-[0.7rem] text-sd-ink-soft font-medium uppercase tracking-wider">Explore demo</span>
                      <div className="h-px bg-sd-line flex-1" />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {demoAccounts.map((d) => (
                        <button
                          key={d.email}
                          onClick={() => signInDemo(d.email, d.password)}
                          disabled={busy}
                          className="sd-clay-sm sd-clay-raise sd-focus p-3 text-left group"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[0.72rem] font-bold text-sd-forest uppercase tracking-wide">{d.role}</span>
                            <ChevronRight className="w-3.5 h-3.5 text-sd-ink-soft group-hover:text-sd-forest transition-colors" />
                          </div>
                          <div className="text-[0.82rem] font-semibold text-sd-ink mt-1">{d.name}</div>
                          <div className="text-[0.68rem] text-sd-ink-soft mt-0.5 leading-snug">{d.desc}</div>
                        </button>
                      ))}
                    </div>
                    <p className="text-[0.66rem] text-sd-ink-soft mt-3 flex items-start gap-1.5">
                      <Info className="w-3 h-3 mt-0.5 shrink-0" />
                      One-click demo signs you into the real seeded demo organization. Password for all demo accounts: Demo@1234
                    </p>

                    <div className="mt-5 text-center">
                      <span className="text-sm text-sd-ink-soft">New solar company? </span>
                      <button onClick={() => setMode("signup")} className="text-sm font-semibold text-sd-forest hover:underline">
                        Create an organization
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

              {mode === "signup" && (
                <motion.div key="signup" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
                  <div className="sd-clay p-7 sm:p-8">
                    <button onClick={() => setMode("signin")} className="text-xs text-sd-ink-soft hover:text-sd-ink flex items-center gap-1 mb-4">
                      <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
                    </button>
                    <h2 className="text-xl font-bold text-sd-ink">Create your organization</h2>
                    <p className="text-sm text-sd-ink-soft mb-6">Register your solar company and invite your team.</p>
                    <form onSubmit={submitSignup} className="space-y-4">
                      <Field id="su-name" label="Your name" icon={UserIcon}>
                        <input id="su-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Priya Sharma" className="w-full bg-transparent text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none" />
                      </Field>
                      <Field id="su-org" label="Organization name" icon={Building2}>
                        <input id="su-org" required value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="SunRoot Solar Energy" className="w-full bg-transparent text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none" />
                      </Field>
                      <Field id="su-city" label="City (optional)" icon={MapPin}>
                        <input id="su-city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Jaipur" className="w-full bg-transparent text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none" />
                      </Field>
                      <Field id="su-email" label="Work email" icon={Mail}>
                        <input id="su-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.in" className="w-full bg-transparent text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none" />
                      </Field>
                      <Field id="su-pass" label="Create password (min 8 characters)" icon={Lock}>
                        <input id="su-pass" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="w-full bg-transparent text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none" />
                      </Field>
                      {error && <div className="text-[0.8rem] text-[#a03340] bg-[#C94B55]/8 rounded-xl px-4 py-3">{error}</div>}
                      <button type="submit" disabled={busy} className="sd-btn-primary w-full py-3.5 font-semibold text-sm flex items-center justify-center gap-2">
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Create organization
                      </button>
                    </form>
                  </div>
                </motion.div>
              )}

              {mode === "forgot" && (
                <motion.div key="forgot" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
                  <div className="sd-clay p-7 sm:p-8">
                    <button onClick={() => setMode("signin")} className="text-xs text-sd-ink-soft hover:text-sd-ink flex items-center gap-1 mb-4">
                      <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
                    </button>
                    <h2 className="text-xl font-bold text-sd-ink">Reset your password</h2>
                    <p className="text-sm text-sd-ink-soft mb-6">We&apos;ll send password reset instructions to your email.</p>
                    <form onSubmit={submitForgot} className="space-y-4">
                      <Field id="fg-email" label="Email address" icon={Mail}>
                        <input id="fg-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.in" className="w-full bg-transparent text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none" />
                      </Field>
                      {error && <div className="text-[0.8rem] text-[#a03340] bg-[#C94B55]/8 rounded-xl px-4 py-3">{error}</div>}
                      {info && <div className="text-[0.8rem] text-sd-forest bg-sd-forest/8 rounded-xl px-4 py-3">{info}</div>}
                      <button type="submit" disabled={busy} className="sd-btn-primary w-full py-3.5 font-semibold text-sm flex items-center justify-center gap-2">
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Send reset instructions
                      </button>
                    </form>
                  </div>
                </motion.div>
              )}

              {mode === "reset" && (
                <motion.div key="reset" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
                  <div className="sd-clay p-7 sm:p-8">
                    <h2 className="text-xl font-bold text-sd-ink">Choose a new password</h2>
                    <p className="text-sm text-sd-ink-soft mb-6">{info ?? "Enter the new password for your account."}</p>
                    <form onSubmit={submitReset} className="space-y-4">
                      <Field id="rs-pass" label="New password (min 8 characters)" icon={Lock}>
                        <input id="rs-pass" type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" className="w-full bg-transparent text-sm text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none" />
                      </Field>
                      {error && <div className="text-[0.8rem] text-[#a03340] bg-[#C94B55]/8 rounded-xl px-4 py-3">{error}</div>}
                      <button type="submit" disabled={busy} className="sd-btn-primary w-full py-3.5 font-semibold text-sm flex items-center justify-center gap-2">
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        Update password
                      </button>
                    </form>
                  </div>
                </motion.div>
              )}

              {mode === "verify" && (
                <motion.div key="verify" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
                  <div className="sd-clay p-7 sm:p-8 text-center">
                    <div className="mx-auto w-14 h-14 rounded-2xl bg-sd-forest/10 flex items-center justify-center mb-4">
                      <Mail className="w-6 h-6 text-sd-forest" />
                    </div>
                    <h2 className="text-xl font-bold text-sd-ink">Confirm your email</h2>
                    <p className="text-sm text-sd-ink-soft mt-2 mb-1">
                      We queued a verification email for <span className="font-semibold text-sd-ink">{needsVerification}</span>.
                    </p>
                    <p className="text-xs text-sd-ink-soft mb-6">{info}</p>
                    <div className="sd-inset p-4 text-left mb-5">
                      <div className="flex items-start gap-2.5">
                        <Sparkles className="w-4 h-4 text-[#96660d] mt-0.5 shrink-0" />
                        <p className="text-xs text-sd-ink-soft leading-relaxed">
                          <span className="font-semibold text-sd-ink">Demo mode:</span> SMTP is not configured in this environment, so you can verify instantly with the button below. With SMTP configured, this button would resend the email instead (rate-limited).
                        </p>
                      </div>
                    </div>
                    {error && <div className="text-[0.8rem] text-[#a03340] bg-[#C94B55]/8 rounded-xl px-4 py-3 mb-4">{error}</div>}
                    <button onClick={verifyDemo} disabled={busy} className="sd-btn-primary w-full py-3.5 font-semibold text-sm flex items-center justify-center gap-2 mb-3">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Verify email (demo mode)
                    </button>
                    <button onClick={() => setMode("signin")} className="text-xs text-sd-ink-soft hover:text-sd-ink">
                      Back to sign in
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ id, label, icon: Icon, children }: { id: string; label: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="text-[0.8rem] font-medium text-sd-ink mb-1.5 block">{label}</label>
      <div className="sd-inset flex items-center gap-3 px-3.5 py-3 focus-within:ring-2 focus-within:ring-sd-forest/40">
        <Icon className="w-4 h-4 text-sd-ink-soft shrink-0" />
        {children}
      </div>
    </div>
  );
}

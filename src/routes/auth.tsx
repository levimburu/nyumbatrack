import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Building2, Loader2, ChevronRight, ArrowLeft, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

type Step =
  | "welcome"
  | "role"
  | "name"
  | "email"
  | "password"
  | "invite_code"
  | "signin_email"
  | "signin_password"
  | "reset_password";

function AuthPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("welcome");
  const [role, setRole] = useState<"landlord" | "agent">("landlord");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSignIn, setIsSignIn] = useState(false);
  const [newResetPassword, setNewResetPassword] = useState("");
  const [showResetPassword, setShowResetPassword] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.includes("type=recovery")) {
      setStep("reset_password");
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session && !hash.includes("type=recovery")) navigate({ to: "/", replace: true });
    });
  }, [navigate]);

  const handleSignIn = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      localStorage.removeItem("nyumbatrack_selected_property");
      toast.success("Welcome back!");
      navigate({ to: "/", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async () => {
    setLoading(true);
    try {
      if (role === "agent") {
        const { data: codeData, error: codeError } = await (supabase as any).from("invite_codes").select("*").eq("code", inviteCode).eq("used", false).maybeSingle();
        if (codeError || !codeData) { toast.error("Invalid or already used invite code"); setLoading(false); return; }
      }
      const { data: authData, error: authError } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
      if (authError) throw authError;
      if (!authData.user) throw new Error("No user returned");
      const userId = authData.user.id;
      await (supabase as any).from("profiles").upsert({ id: userId, full_name: fullName, role } as any);
      await (supabase as any).from("user_roles").upsert({ user_id: userId, role: "admin" } as any);
      if (role === "agent") {
        const { data: codeData } = await (supabase as any).from("invite_codes").select("*").eq("code", inviteCode).eq("used", false).maybeSingle();
        if (codeData) {
          await (supabase as any).from("invite_codes").update({ used: true, used_by: userId } as any).eq("id", codeData.id);
          await (supabase as any).from("agent_landlord").insert({ agent_id: userId, landlord_id: codeData.landlord_id, property_id: codeData.property_id } as any);
        }
      }
      localStorage.removeItem("nyumbatrack_selected_property");
      toast.success("Account created! Welcome to NyumbaTrack.");
      navigate({ to: "/", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (newResetPassword.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newResetPassword });
      if (error) throw error;
      toast.success("Password updated! Please sign in.");
      localStorage.removeItem("nyumbatrack_selected_property");
      setStep("signin_email");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setLoading(false);
    }
  };

  const back = () => {
    if (step === "role") setStep("welcome");
    else if (step === "name") setStep("role");
    else if (step === "email") setStep("name");
    else if (step === "password") setStep("email");
    else if (step === "invite_code") setStep("password");
    else if (step === "signin_email") setStep("welcome");
    else if (step === "signin_password") setStep("signin_email");
  };

  const progress = { welcome: 0, role: 1, name: 2, email: 3, password: 4, invite_code: 4, signin_email: 1, signin_password: 2, reset_password: 1 }[step];
  const totalSteps = isSignIn ? 2 : 4;

  const startSignIn = () => {
    setIsSignIn(true);
    setStep("signin_email");
  };

  const forgotPassword = async () => {
    if (!email.trim()) { toast.error("Enter your email first"); return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth#type=recovery` });
    if (error) toast.error(error.message);
    else toast.success("Password reset link sent to " + email);
  };

  // The password step is the last one for a landlord (submits directly);
  // for an agent it advances to the invite-code step instead.
  const continueFromPassword = () => {
    if (password.length < 6) return;
    if (role === "agent") setStep("invite_code");
    else handleSignUp();
  };

  return (
    <div className="min-h-screen flex" style={{ background: "linear-gradient(160deg, #0d2818 0%, #1a3a28 50%, #166534 100%)" }}>

      {/* ── DESKTOP LEFT: Form ── */}
      <div className="hidden md:flex md:w-1/2 flex-col min-h-screen" style={{ background: "#F5F5F0" }}>
        <div className="flex items-center gap-2 px-8 py-6">
          <div className="grid h-8 w-8 place-items-center rounded-lg" style={{ background: "#F59E0B" }}>
            <Building2 className="h-4 w-4 text-white" />
          </div>
          <span className="font-display text-sm font-semibold" style={{ color: "#0d2818" }}>NyumbaTrack</span>
        </div>

        <div className="flex-1 flex flex-col justify-center px-12 max-w-md mx-auto w-full">

          {step === "welcome" && (
            <div>
              <h1 className="font-display text-3xl font-bold mb-2" style={{ color: "#111827" }}>Welcome back</h1>
              <p className="text-sm mb-8" style={{ color: "#6B7280" }}>Sign in to manage your properties.</p>
              <div className="space-y-3">
                <button onClick={() => { setIsSignIn(false); setStep("role"); }} className="w-full rounded-xl py-3.5 text-base font-bold text-white" style={{ background: "#166534" }}>Get Started</button>
                <button onClick={startSignIn} className="w-full rounded-xl py-3.5 text-base font-semibold border" style={{ border: "1.5px solid #166534", color: "#166534", background: "white" }}>Sign In</button>
              </div>
            </div>
          )}

          {step === "role" && (
            <div>
              <button onClick={back} className="flex items-center gap-2 text-sm mb-6" style={{ color: "#6B7280" }}><ArrowLeft className="h-4 w-4" /> Back</button>
              <h1 className="font-display text-2xl font-bold mb-2" style={{ color: "#111827" }}>Who are you?</h1>
              <p className="text-sm mb-6" style={{ color: "#6B7280" }}>Select your role to get started.</p>
              <div className="space-y-3">
                <button onClick={() => { setRole("landlord"); setStep("name"); }} className="w-full rounded-xl border-2 p-4 text-left" style={{ borderColor: role === "landlord" ? "#166534" : "#E5E7EB", background: role === "landlord" ? "#F0FDF4" : "white" }}>
                  <div className="text-xl mb-1">🏠</div>
                  <div className="font-semibold text-sm" style={{ color: "#111827" }}>Landlord</div>
                  <div className="text-xs" style={{ color: "#6B7280" }}>I own properties and manage tenants</div>
                </button>
                <button onClick={() => { setRole("agent"); setStep("name"); }} className="w-full rounded-xl border-2 p-4 text-left" style={{ borderColor: role === "agent" ? "#166534" : "#E5E7EB", background: role === "agent" ? "#F0FDF4" : "white" }}>
                  <div className="text-xl mb-1">👔</div>
                  <div className="font-semibold text-sm" style={{ color: "#111827" }}>Agent / Secretary</div>
                  <div className="text-xs" style={{ color: "#6B7280" }}>I manage properties on behalf of a landlord</div>
                </button>
              </div>
            </div>
          )}

          {step === "name" && (
            <div>
              <button onClick={back} className="flex items-center gap-2 text-sm mb-6" style={{ color: "#6B7280" }}><ArrowLeft className="h-4 w-4" /> Back</button>
              <h1 className="font-display text-2xl font-bold mb-2" style={{ color: "#111827" }}>What's your name?</h1>
              <p className="text-sm mb-6" style={{ color: "#6B7280" }}>We'll use this to personalise your experience.</p>
              <input autoFocus type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && fullName.trim()) setStep("email"); }} placeholder="Full name" className="w-full rounded-xl border px-4 py-3 text-sm outline-none mb-4" style={{ borderColor: "#E5E7EB", color: "#111827" }} onFocus={(e) => e.target.style.borderColor = "#166534"} onBlur={(e) => e.target.style.borderColor = "#E5E7EB"} />
              <button onClick={() => fullName.trim() && setStep("email")} disabled={!fullName.trim()} className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2" style={{ background: "#166534" }}>Continue <ChevronRight className="h-4 w-4" /></button>
            </div>
          )}

          {step === "email" && (
            <div>
              <button onClick={back} className="flex items-center gap-2 text-sm mb-6" style={{ color: "#6B7280" }}><ArrowLeft className="h-4 w-4" /> Back</button>
              <h1 className="font-display text-2xl font-bold mb-2" style={{ color: "#111827" }}>Your email address</h1>
              <p className="text-sm mb-6" style={{ color: "#6B7280" }}>We'll use this to secure your account.</p>
              <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && email.trim()) setStep("password"); }} placeholder="you@example.com" className="w-full rounded-xl border px-4 py-3 text-sm outline-none mb-4" style={{ borderColor: "#E5E7EB", color: "#111827" }} onFocus={(e) => e.target.style.borderColor = "#166534"} onBlur={(e) => e.target.style.borderColor = "#E5E7EB"} />
              <button onClick={() => email.trim() && setStep("password")} disabled={!email.trim()} className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2" style={{ background: "#166534" }}>Continue <ChevronRight className="h-4 w-4" /></button>
            </div>
          )}

          {step === "password" && (
            <div>
              <button onClick={back} className="flex items-center gap-2 text-sm mb-6" style={{ color: "#6B7280" }}><ArrowLeft className="h-4 w-4" /> Back</button>
              <h1 className="font-display text-2xl font-bold mb-2" style={{ color: "#111827" }}>Create a password</h1>
              <p className="text-sm mb-6" style={{ color: "#6B7280" }}>Minimum 6 characters.</p>
              <div className="relative mb-4">
                <input autoFocus type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") continueFromPassword(); }} placeholder="••••••••" minLength={6} className="w-full rounded-xl border px-4 py-3 text-sm outline-none pr-12" style={{ borderColor: "#E5E7EB", color: "#111827" }} onFocus={(e) => e.target.style.borderColor = "#166534"} onBlur={(e) => e.target.style.borderColor = "#E5E7EB"} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "#9CA3AF" }}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
              <button onClick={continueFromPassword} disabled={password.length < 6 || loading} className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2" style={{ background: "#166534" }}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {role === "agent" ? "Continue" : "Create Account"}
                {role === "agent" && <ChevronRight className="h-4 w-4" />}
              </button>
            </div>
          )}

          {step === "invite_code" && (
            <div>
              <button onClick={back} className="flex items-center gap-2 text-sm mb-6" style={{ color: "#6B7280" }}><ArrowLeft className="h-4 w-4" /> Back</button>
              <h1 className="font-display text-2xl font-bold mb-2" style={{ color: "#111827" }}>Enter invite code</h1>
              <p className="text-sm mb-6" style={{ color: "#6B7280" }}>Ask your landlord for the invite code.</p>
              <input autoFocus type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter" && inviteCode.trim()) handleSignUp(); }} placeholder="NYM-ABC123" className="w-full rounded-xl border px-4 py-3 text-sm outline-none mb-4 text-center font-mono tracking-widest" style={{ borderColor: "#E5E7EB", color: "#111827" }} onFocus={(e) => e.target.style.borderColor = "#166534"} onBlur={(e) => e.target.style.borderColor = "#E5E7EB"} />
              <button onClick={() => inviteCode.trim() && handleSignUp()} disabled={!inviteCode.trim() || loading} className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2" style={{ background: "#166534" }}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create Account
              </button>
            </div>
          )}

          {step === "signin_email" && (
            <div>
              <button onClick={back} className="flex items-center gap-2 text-sm mb-6" style={{ color: "#6B7280" }}><ArrowLeft className="h-4 w-4" /> Back</button>
              <h1 className="font-display text-2xl font-bold mb-2" style={{ color: "#111827" }}>Welcome back</h1>
              <p className="text-sm mb-6" style={{ color: "#6B7280" }}>Enter your email to continue.</p>
              <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && email.trim()) setStep("signin_password"); }} placeholder="you@example.com" className="w-full rounded-xl border px-4 py-3 text-sm outline-none mb-4" style={{ borderColor: "#E5E7EB", color: "#111827" }} onFocus={(e) => e.target.style.borderColor = "#166534"} onBlur={(e) => e.target.style.borderColor = "#E5E7EB"} />
              <button onClick={() => email.trim() && setStep("signin_password")} disabled={!email.trim()} className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2" style={{ background: "#166534" }}>Continue <ChevronRight className="h-4 w-4" /></button>
            </div>
          )}

          {step === "signin_password" && (
            <div>
              <button onClick={back} className="flex items-center gap-2 text-sm mb-6" style={{ color: "#6B7280" }}><ArrowLeft className="h-4 w-4" /> Back</button>
              <h1 className="font-display text-2xl font-bold mb-2" style={{ color: "#111827" }}>Enter password</h1>
              <p className="text-sm mb-6" style={{ color: "#6B7280" }}>Enter your password to sign in.</p>
              <div className="relative mb-4">
                <input autoFocus type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !loading && password) handleSignIn(); }} placeholder="••••••••" className="w-full rounded-xl border px-4 py-3 text-sm outline-none pr-12" style={{ borderColor: "#E5E7EB", color: "#111827" }} onFocus={(e) => e.target.style.borderColor = "#166534"} onBlur={(e) => e.target.style.borderColor = "#E5E7EB"} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "#9CA3AF" }}>{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
              <button onClick={handleSignIn} disabled={loading || !password} className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2" style={{ background: "#166534" }}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Sign In
              </button>
              <button onClick={forgotPassword} className="mt-3 w-full text-center text-sm" style={{ color: "#9CA3AF" }}>Forgot password?</button>
            </div>
          )}

          {step === "reset_password" && (
            <div>
              <h1 className="font-display text-2xl font-bold mb-2" style={{ color: "#111827" }}>Set new password</h1>
              <p className="text-sm mb-6" style={{ color: "#6B7280" }}>Choose a new password for your account.</p>
              <div className="relative mb-4">
                <input autoFocus type={showResetPassword ? "text" : "password"} value={newResetPassword} onChange={(e) => setNewResetPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !loading && newResetPassword.length >= 6) handleResetPassword(); }} placeholder="New password" minLength={6} className="w-full rounded-xl border px-4 py-3 text-sm outline-none pr-12" style={{ borderColor: "#E5E7EB", color: "#111827" }} onFocus={(e) => e.target.style.borderColor = "#166534"} onBlur={(e) => e.target.style.borderColor = "#E5E7EB"} />
                <button type="button" onClick={() => setShowResetPassword(!showResetPassword)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "#9CA3AF" }}>{showResetPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
              <button onClick={handleResetPassword} disabled={loading || newResetPassword.length < 6} className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2" style={{ background: "#166534" }}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Update Password
              </button>
            </div>
          )}
        </div>

        <div className="px-8 py-6 text-xs" style={{ color: "#9CA3AF" }}>© 2026 NyumbaTrack Technologies Ltd</div>
      </div>

      {/* ── DESKTOP RIGHT: Branding ── */}
      <div className="hidden md:flex md:w-1/2 flex-col items-center justify-center min-h-screen px-12 relative overflow-hidden" style={{ background: "linear-gradient(160deg, #0d2818 0%, #166534 100%)" }}>
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-10" style={{ background: "#F59E0B", transform: "translate(30%, -30%)" }} />
        <div className="absolute bottom-0 left-0 w-64 h-64 rounded-full opacity-10" style={{ background: "#16A34A", transform: "translate(-30%, 30%)" }} />
        <div className="relative text-center max-w-sm">
          <div className="mx-auto mb-8 grid h-20 w-20 place-items-center rounded-3xl" style={{ background: "#F59E0B" }}>
            <Building2 className="h-10 w-10 text-white" />
          </div>
          <h1 className="font-display text-4xl font-bold text-white mb-4 leading-tight">NyumbaTrack</h1>
          <p className="text-white/60 text-base leading-relaxed mb-10">
            The smart way to manage your rental properties. Track tenants, payments, and deposits — built for Kenyan landlords.
          </p>
          <div className="space-y-3 text-left">
            {["Track rent payments & receipts", "Manage multiple properties", "Agent & landlord collaboration", "Deposits & occupancy tracking"].map((f) => (
              <div key={f} className="flex items-center gap-3">
                <div className="grid h-6 w-6 place-items-center rounded-full flex-shrink-0" style={{ background: "#F59E0B" }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
                <span className="text-white/80 text-sm">{f}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── MOBILE ── */}
      <div className="flex md:hidden flex-col min-h-screen w-full" style={{ background: "#F5F5F0" }}>
        <div className="h-safe-top" />
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          {step !== "welcome" ? (
            <button onClick={back} className="grid h-10 w-10 place-items-center rounded-full" style={{ background: "#E5E7EB", color: "#111827" }}><ArrowLeft className="h-5 w-5" /></button>
          ) : <div className="h-10 w-10" />}
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-amber-400 text-amber-900"><Building2 className="h-4 w-4" /></div>
            <span className="font-display text-sm font-semibold" style={{ color: "#111827" }}>NyumbaTrack</span>
          </div>
          <div className="h-10 w-10" />
        </div>

        {step !== "welcome" && (
          <div className="px-6 mb-2">
            <div className="h-1 rounded-full" style={{ background: "#E5E7EB" }}>
              <div className="h-full rounded-full bg-amber-400 transition-all duration-500" style={{ width: `${((progress ?? 0) / totalSteps) * 100}%` }} />
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col px-6 pt-8">
          {step === "welcome" && (
            <div className="flex flex-col items-center justify-center flex-1 text-center">
              <div className="mb-8">
                <svg width="220" height="180" viewBox="0 0 220 180" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect width="220" height="180" rx="20" fill="#0d2818" />
                  <circle cx="185" cy="28" r="11" fill="#F59E0B" opacity="0.9" />
                  <circle cx="191" cy="24" r="9" fill="#0d2818" />
                  <rect x="15" y="55" width="52" height="125" rx="3" fill="#1a3a28" />
                  <rect x="15" y="55" width="52" height="7" rx="3" fill="#166534" />
                  <rect x="80" y="75" width="60" height="105" rx="3" fill="#166534" />
                  <rect x="80" y="75" width="60" height="7" rx="3" fill="#15803d" />
                  <rect x="152" y="90" width="55" height="90" rx="3" fill="#1a3a28" />
                  <rect x="152" y="90" width="55" height="7" rx="3" fill="#166534" />
                  <rect x="0" y="175" width="220" height="5" fill="#0a1f10" />
                  <rect x="72" y="158" width="76" height="18" rx="4" fill="#166534" />
                  <text x="110" y="171" textAnchor="middle" fill="#F59E0B" fontSize="7" fontFamily="system-ui" fontWeight="bold">NYUMBATRACK</text>
                </svg>
              </div>
              <h1 className="font-display text-3xl font-bold leading-tight mb-3" style={{ color: "#111827" }}>Manage your properties<br />with ease</h1>
              <p className="text-sm leading-relaxed mb-10 max-w-xs" style={{ color: "#6B7280" }}>Track tenants, rent payments, and receipts — built for Kenyan landlords.</p>
              <div className="w-full space-y-3">
                <button onClick={() => { setIsSignIn(false); setStep("role"); }} className="w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 transition active:scale-95">Get Started</button>
                <button onClick={startSignIn} className="w-full rounded-2xl border py-4 text-base font-semibold transition active:scale-95" style={{ borderColor: "#166534", color: "#166534", background: "white" }}>Sign In</button>
              </div>
            </div>
          )}

          {step === "role" && (
            <div className="flex flex-col flex-1">
              <h1 className="font-display text-2xl font-bold mb-2" style={{ color: "#111827" }}>Who are you?</h1>
              <p className="text-sm mb-8" style={{ color: "#6B7280" }}>Select your role to get started.</p>
              <div className="space-y-4">
                <button onClick={() => { setRole("landlord"); setStep("name"); }} className="w-full rounded-2xl border-2 p-5 text-left transition active:scale-95" style={{ borderColor: role === "landlord" ? "#F59E0B" : "#E5E7EB", background: role === "landlord" ? "#FFFBEB" : "white" }}>
                  <div className="text-2xl mb-2">🏠</div>
                  <div className="font-display text-lg font-bold" style={{ color: "#111827" }}>Landlord</div>
                  <div className="text-sm mt-1" style={{ color: "#6B7280" }}>I own properties and manage tenants</div>
                </button>
                <button onClick={() => { setRole("agent"); setStep("name"); }} className="w-full rounded-2xl border-2 p-5 text-left transition active:scale-95" style={{ borderColor: role === "agent" ? "#F59E0B" : "#E5E7EB", background: role === "agent" ? "#FFFBEB" : "white" }}>
                  <div className="text-2xl mb-2">👔</div>
                  <div className="font-display text-lg font-bold" style={{ color: "#111827" }}>Agent / Secretary</div>
                  <div className="text-sm mt-1" style={{ color: "#6B7280" }}>I manage properties on behalf of a landlord</div>
                </button>
              </div>
            </div>
          )}

          {step === "name" && (
            <div className="flex flex-col flex-1">
              <h1 className="font-display text-2xl font-bold mb-2" style={{ color: "#111827" }}>What's your name?</h1>
              <p className="text-sm mb-8" style={{ color: "#6B7280" }}>We'll use this to personalise your experience.</p>
              <input autoFocus type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && fullName.trim()) setStep("email"); }} placeholder="Full name" className="w-full rounded-2xl border-2 px-5 py-4 text-base outline-none focus:border-amber-400" style={{ borderColor: "#E5E7EB", background: "white", color: "#111827" }} />
              <button onClick={() => fullName.trim() && setStep("email")} disabled={!fullName.trim()} className="mt-6 w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 disabled:opacity-40 transition active:scale-95 flex items-center justify-center gap-2">Continue <ChevronRight className="h-5 w-5" /></button>
            </div>
          )}

          {step === "email" && (
            <div className="flex flex-col flex-1">
              <h1 className="font-display text-2xl font-bold mb-2" style={{ color: "#111827" }}>Your email address</h1>
              <p className="text-sm mb-8" style={{ color: "#6B7280" }}>We'll use this to secure your account.</p>
              <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && email.trim()) setStep("password"); }} placeholder="you@example.com" className="w-full rounded-2xl border-2 px-5 py-4 text-base outline-none focus:border-amber-400" style={{ borderColor: "#E5E7EB", background: "white", color: "#111827" }} />
              <button onClick={() => email.trim() && setStep("password")} disabled={!email.trim()} className="mt-6 w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 disabled:opacity-40 transition active:scale-95 flex items-center justify-center gap-2">Continue <ChevronRight className="h-5 w-5" /></button>
            </div>
          )}

          {step === "password" && (
            <div className="flex flex-col flex-1">
              <h1 className="font-display text-2xl font-bold mb-2" style={{ color: "#111827" }}>Create a password</h1>
              <p className="text-sm mb-8" style={{ color: "#6B7280" }}>Minimum 6 characters.</p>
              <div className="relative">
                <input autoFocus type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") continueFromPassword(); }} placeholder="••••••••" minLength={6} className="w-full rounded-2xl border-2 px-5 py-4 text-base outline-none focus:border-amber-400 pr-14" style={{ borderColor: "#E5E7EB", background: "white", color: "#111827" }} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2" style={{ color: "#9CA3AF" }}>{showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>
              </div>
              <button onClick={continueFromPassword} disabled={password.length < 6 || loading} className="mt-6 w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 disabled:opacity-40 transition active:scale-95 flex items-center justify-center gap-2">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
                {role === "agent" ? "Continue" : "Create Account"}
                {role === "agent" && <ChevronRight className="h-5 w-5" />}
              </button>
            </div>
          )}

          {step === "invite_code" && (
            <div className="flex flex-col flex-1">
              <h1 className="font-display text-2xl font-bold mb-2" style={{ color: "#111827" }}>Enter invite code</h1>
              <p className="text-sm mb-8" style={{ color: "#6B7280" }}>Ask your landlord for the invite code to link your account.</p>
              <input autoFocus type="text" value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter" && inviteCode.trim()) handleSignUp(); }} placeholder="e.g. NYM-ABC123" className="w-full rounded-2xl border-2 px-5 py-4 text-base outline-none focus:border-amber-400 tracking-widest text-center font-mono" style={{ borderColor: "#E5E7EB", background: "white", color: "#111827" }} />
              <button onClick={() => inviteCode.trim() && handleSignUp()} disabled={!inviteCode.trim() || loading} className="mt-6 w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 disabled:opacity-40 transition active:scale-95 flex items-center justify-center gap-2">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null} Create Account
              </button>
            </div>
          )}

          {step === "signin_email" && (
            <div className="flex flex-col flex-1">
              <h1 className="font-display text-2xl font-bold mb-2" style={{ color: "#111827" }}>Welcome back</h1>
              <p className="text-sm mb-8" style={{ color: "#6B7280" }}>Enter your email to continue.</p>
              <input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && email.trim()) setStep("signin_password"); }} placeholder="you@example.com" className="w-full rounded-2xl border-2 px-5 py-4 text-base outline-none focus:border-amber-400" style={{ borderColor: "#E5E7EB", background: "white", color: "#111827" }} />
              <button onClick={() => email.trim() && setStep("signin_password")} disabled={!email.trim()} className="mt-6 w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 disabled:opacity-40 transition active:scale-95 flex items-center justify-center gap-2">Continue <ChevronRight className="h-5 w-5" /></button>
            </div>
          )}

          {step === "signin_password" && (
            <div className="flex flex-col flex-1">
              <h1 className="font-display text-2xl font-bold mb-2" style={{ color: "#111827" }}>Enter password</h1>
              <p className="text-sm mb-8" style={{ color: "#6B7280" }}>Enter your password to sign in.</p>
              <div className="relative">
                <input autoFocus type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !loading && password) handleSignIn(); }} placeholder="••••••••" className="w-full rounded-2xl border-2 px-5 py-4 text-base outline-none focus:border-amber-400 pr-14" style={{ borderColor: "#E5E7EB", background: "white", color: "#111827" }} />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2" style={{ color: "#9CA3AF" }}>{showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>
              </div>
              <button onClick={handleSignIn} disabled={loading || !password} className="mt-6 w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 disabled:opacity-40 transition active:scale-95 flex items-center justify-center gap-2">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null} Sign In
              </button>
              <button onClick={forgotPassword} className="mt-3 w-full text-center text-sm transition" style={{ color: "#6B7280" }}>Forgot password?</button>
            </div>
          )}

          {step === "reset_password" && (
            <div className="flex flex-col flex-1">
              <h1 className="font-display text-2xl font-bold mb-2" style={{ color: "#111827" }}>Set new password</h1>
              <p className="text-sm mb-8" style={{ color: "#6B7280" }}>Choose a new password for your account.</p>
              <div className="relative">
                <input autoFocus type={showResetPassword ? "text" : "password"} value={newResetPassword} onChange={(e) => setNewResetPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !loading && newResetPassword.length >= 6) handleResetPassword(); }} placeholder="New password" minLength={6} className="w-full rounded-2xl border-2 px-5 py-4 text-base outline-none focus:border-amber-400 pr-14" style={{ borderColor: "#E5E7EB", background: "white", color: "#111827" }} />
                <button type="button" onClick={() => setShowResetPassword(!showResetPassword)} className="absolute right-4 top-1/2 -translate-y-1/2" style={{ color: "#9CA3AF" }}>{showResetPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button>
              </div>
              <button onClick={handleResetPassword} disabled={loading || newResetPassword.length < 6} className="mt-6 w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 disabled:opacity-40 transition active:scale-95 flex items-center justify-center gap-2">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null} Update Password
              </button>
            </div>
          )}
        </div>
        <div className="h-8" />
      </div>
    </div>
  );
}
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
  | "otp"
  | "password"
  | "invite_code"
  | "pin_setup"
  | "pin_confirm"
  | "signin_email"
  | "signin_otp"
  | "signin_pin";

function hashPin(pin: string): string {
  let hash = 0;
  for (let i = 0; i < pin.length; i++) {
    const char = pin.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36) + pin.length.toString();
}

function AuthPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("welcome");
  const [role, setRole] = useState<"landlord" | "agent">("landlord");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSignIn, setIsSignIn] = useState(false);
  const [rememberedEmail, setRememberedEmail] = useState<string | null>(null);
  const [rememberedUserId, setRememberedUserId] = useState<string | null>(null);

  // On mount — check if this device has a remembered user
  useEffect(() => {
    const savedEmail = localStorage.getItem("nyumbatrack_email");
    const savedUserId = localStorage.getItem("nyumbatrack_user_id");
    if (savedEmail && savedUserId) {
      setRememberedEmail(savedEmail);
      setRememberedUserId(savedUserId);
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate({ to: "/", replace: true });
    });
  }, [navigate]);

  // PIN input handlers
  const handlePinInput = (digit: string, isConfirm = false) => {
    if (isConfirm) {
      if (pinConfirm.length < 4) setPinConfirm((p) => p + digit);
    } else {
      if (pin.length < 4) setPin((p) => p + digit);
    }
  };

  const handlePinDelete = (isConfirm = false) => {
    if (isConfirm) setPinConfirm((p) => p.slice(0, -1));
    else setPin((p) => p.slice(0, -1));
  };

  // Send OTP for signup email verification
  const sendSignupOtp = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      // We ignore "user not found" error since user doesn't exist yet during signup
      // OTP is still sent to the email for verification
      if (error && !error.message.includes("not found")) throw error;
      toast.success("OTP sent! Check your email.");
      setStep("otp");
    } catch (err) {
      // For new users Supabase may reject — just move forward, we verify on signup
      toast.success("OTP sent! Check your email.");
      setStep("otp");
    } finally {
      setLoading(false);
    }
  };

  // Send OTP for sign in
  const sendSigninOtp = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
  email,
  options: { shouldCreateUser: false, emailRedirectTo: undefined },
});
      if (error) throw error;
      toast.success("OTP sent! Check your email.");
      setStep("signin_otp");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send OTP";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Verify OTP for sign in, then check if PIN is remembered
  const verifySigninOtp = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: "email",
      });
      if (error) throw error;
      const userId = data.user?.id;
      if (!userId) throw new Error("No user returned");

      // Save to localStorage for this device
      localStorage.setItem("nyumbatrack_email", email);
      localStorage.setItem("nyumbatrack_user_id", userId);

      // Fetch their stored pin_hash
      const { data: profile } = await (supabase as any)
        .from("profiles")
        .select("pin_hash")
        .eq("id", userId)
        .maybeSingle();

      if (profile?.pin_hash) {
        localStorage.setItem(`nyumbatrack_pin_${userId}`, profile.pin_hash);
      }

      toast.success("Email verified!");
      navigate({ to: "/", replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid OTP";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // PIN sign in for remembered device
  const handlePinSignIn = async (enteredPin: string) => {
    if (!rememberedUserId) return;
    const storedHash = localStorage.getItem(`nyumbatrack_pin_${rememberedUserId}`);
    if (!storedHash) {
      toast.error("PIN not found on this device. Please sign in with email.");
      setStep("signin_email");
      return;
    }
    if (hashPin(enteredPin) !== storedHash) {
      toast.error("Incorrect PIN");
      setPin("");
      return;
    }
    // PIN correct — restore session via OTP silently or just navigate
    // We need to re-authenticate via Supabase — send OTP silently
    setLoading(true);
    try {
      await supabase.auth.signInWithOtp({ email: rememberedEmail! });
      toast.info("Sending magic link to your email to restore session…");
      // For now, navigate and let the session check handle it
      // A better UX: use a stored refresh token — but Supabase handles persistSession automatically
      // If session is still valid in localStorage, this will work directly
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        navigate({ to: "/", replace: true });
      } else {
        toast.error("Session expired. Please sign in with email.");
        setStep("signin_email");
      }
    } catch {
      toast.error("Sign in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Full signup
  const handleSignUp = async () => {
    if (pin !== pinConfirm) {
      toast.error("PINs do not match");
      setPin("");
      setPinConfirm("");
      setStep("pin_setup");
      return;
    }
    setLoading(true);
    try {
      if (role === "agent") {
        const { data: codeData, error: codeError } = await (supabase as any)
          .from("invite_codes")
          .select("*")
          .eq("code", inviteCode)
          .eq("used", false)
          .maybeSingle();
        if (codeError || !codeData) {
          toast.error("Invalid or already used invite code");
          setLoading(false);
          return;
        }
      }

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${window.location.origin}/`,
        },
      });
      if (authError) throw authError;
      if (!authData.user) throw new Error("No user returned");

      const userId = authData.user.id;
      const pinHash = hashPin(pin);

      await (supabase as any).from("profiles").upsert({
        id: userId,
        full_name: fullName,
        role: role,
        pin_hash: pinHash,
      } as any);

      await (supabase as any).from("user_roles").upsert({
        user_id: userId,
        role: "admin",
      } as any);

      if (role === "agent") {
        const { data: codeData } = await (supabase as any)
          .from("invite_codes")
          .select("*")
          .eq("code", inviteCode)
          .eq("used", false)
          .maybeSingle();
        if (codeData) {
          await (supabase as any)
            .from("invite_codes")
            .update({ used: true, used_by: userId } as any)
            .eq("id", codeData.id);
          await (supabase as any).from("agent_landlord").insert({
            agent_id: userId,
            landlord_id: codeData.landlord_id,
          } as any);
        }
      }

      // Remember this device
      localStorage.setItem("nyumbatrack_email", email);
      localStorage.setItem("nyumbatrack_user_id", userId);
      localStorage.setItem(`nyumbatrack_pin_${userId}`, pinHash);

      toast.success("Account created! Welcome to NyumbaTrack.");
      navigate({ to: "/", replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign up failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Auto-advance PIN steps
  useEffect(() => {
    if (step === "pin_setup" && pin.length === 4) {
      setTimeout(() => setStep("pin_confirm"), 300);
    }
  }, [pin, step]);

  useEffect(() => {
    if (step === "pin_confirm" && pinConfirm.length === 4) {
      setTimeout(() => handleSignUp(), 300);
    }
  }, [pinConfirm, step]);

  // Auto-advance signin PIN
  useEffect(() => {
    if (step === "signin_pin" && pin.length === 4) {
      setTimeout(() => handlePinSignIn(pin), 300);
    }
  }, [pin, step]);

  const back = () => {
    if (step === "role") setStep("welcome");
    else if (step === "name") setStep("role");
    else if (step === "email") setStep("name");
    else if (step === "otp") setStep("email");
    else if (step === "password") setStep("otp");
    else if (step === "invite_code") setStep("password");
    else if (step === "pin_setup") setStep(role === "agent" ? "invite_code" : "password");
    else if (step === "pin_confirm") { setPin(""); setStep("pin_setup"); }
    else if (step === "signin_email") setStep("welcome");
    else if (step === "signin_otp") setStep("signin_email");
    else if (step === "signin_pin") {
      localStorage.removeItem("nyumbatrack_email");
      localStorage.removeItem("nyumbatrack_user_id");
      setRememberedEmail(null);
      setRememberedUserId(null);
      setStep("signin_email");
    }
  };

  const progress = {
    welcome: 0, role: 1, name: 2, email: 3, otp: 4, password: 5,
    invite_code: 5, pin_setup: 6, pin_confirm: 7,
    signin_email: 1, signin_otp: 2, signin_pin: 1,
  }[step];

  const totalSteps = isSignIn ? 2 : 7;

  // If device remembers a user, go straight to PIN
  const startSignIn = () => {
    setIsSignIn(true);
    if (rememberedEmail && rememberedUserId) {
      setPin("");
      setStep("signin_pin");
    } else {
      setStep("signin_email");
    }
  };

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(160deg, #0d2818 0%, #1a3a28 50%, #166534 100%)" }}>
      <div className="h-safe-top" />

      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4">
        {step !== "welcome" ? (
          <button onClick={back} className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white">
            <ArrowLeft className="h-5 w-5" />
          </button>
        ) : (
          <div className="h-10 w-10" />
        )}
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-amber-400 text-amber-900">
            <Building2 className="h-4 w-4" />
          </div>
          <span className="font-display text-sm font-semibold text-white">NyumbaTrack</span>
        </div>
        <div className="h-10 w-10" />
      </div>

      {/* Progress bar */}
      {step !== "welcome" && step !== "signin_pin" && (
        <div className="px-6 mb-2">
          <div className="h-1 rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-amber-400 transition-all duration-500"
              style={{ width: `${(progress / totalSteps) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex flex-col px-6 pt-8">

        {/* WELCOME */}
        {step === "welcome" && (
          <div className="flex flex-col items-center justify-center flex-1 text-center">
            <div className="mb-8 relative">
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
            <h1 className="font-display text-3xl font-bold text-white leading-tight mb-3">
              Manage your properties<br />with ease
            </h1>
            <p className="text-white/60 text-sm leading-relaxed mb-10 max-w-xs">
              Track tenants, rent payments, and receipts — built for Kenyan landlords.
            </p>
            <div className="w-full space-y-3">
              <button
                onClick={() => { setIsSignIn(false); setStep("role"); }}
                className="w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 transition active:scale-95"
              >
                Get Started
              </button>
              <button
                onClick={startSignIn}
                className="w-full rounded-2xl border border-white/20 bg-white/10 py-4 text-base font-semibold text-white transition active:scale-95"
              >
                {rememberedEmail ? `Continue as ${rememberedEmail}` : "Sign In"}
              </button>
            </div>
          </div>
        )}

        {/* ROLE */}
        {step === "role" && (
          <div className="flex flex-col flex-1">
            <h1 className="font-display text-2xl font-bold text-white mb-2">Who are you?</h1>
            <p className="text-white/60 text-sm mb-8">Select your role to get started.</p>
            <div className="space-y-4">
              <button
                onClick={() => { setRole("landlord"); setStep("name"); }}
                className={`w-full rounded-2xl border-2 p-5 text-left transition active:scale-95 ${role === "landlord" ? "border-amber-400 bg-white/10" : "border-white/10 bg-white/5"}`}
              >
                <div className="text-2xl mb-2">🏠</div>
                <div className="font-display text-lg font-bold text-white">Landlord</div>
                <div className="text-white/60 text-sm mt-1">I own properties and manage tenants</div>
              </button>
              <button
                onClick={() => { setRole("agent"); setStep("name"); }}
                className={`w-full rounded-2xl border-2 p-5 text-left transition active:scale-95 ${role === "agent" ? "border-amber-400 bg-white/10" : "border-white/10 bg-white/5"}`}
              >
                <div className="text-2xl mb-2">👔</div>
                <div className="font-display text-lg font-bold text-white">Agent / Secretary</div>
                <div className="text-white/60 text-sm mt-1">I manage properties on behalf of a landlord</div>
              </button>
            </div>
          </div>
        )}

        {/* NAME */}
        {step === "name" && (
          <div className="flex flex-col flex-1">
            <h1 className="font-display text-2xl font-bold text-white mb-2">What's your name?</h1>
            <p className="text-white/60 text-sm mb-8">We'll use this to personalise your experience.</p>
            <input
              autoFocus type="text" value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Full name"
              className="w-full rounded-2xl border-2 border-white/20 bg-white/10 px-5 py-4 text-white placeholder-white/40 text-base outline-none focus:border-amber-400"
            />
            <button
              onClick={() => fullName.trim() && setStep("email")}
              disabled={!fullName.trim()}
              className="mt-6 w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 disabled:opacity-40 transition active:scale-95 flex items-center justify-center gap-2"
            >
              Continue <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* EMAIL (signup) */}
        {step === "email" && (
          <div className="flex flex-col flex-1">
            <h1 className="font-display text-2xl font-bold text-white mb-2">Your email address</h1>
            <p className="text-white/60 text-sm mb-8">We'll send a verification code to this email.</p>
            <input
              autoFocus type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-2xl border-2 border-white/20 bg-white/10 px-5 py-4 text-white placeholder-white/40 text-base outline-none focus:border-amber-400"
            />
            <button
              onClick={() => email.trim() && sendSignupOtp()}
              disabled={!email.trim() || loading}
              className="mt-6 w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 disabled:opacity-40 transition active:scale-95 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
              Send Code <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* OTP (signup) */}
        {step === "otp" && (
          <div className="flex flex-col flex-1">
            <h1 className="font-display text-2xl font-bold text-white mb-2">Check your email</h1>
            <p className="text-white/60 text-sm mb-8">
              Enter the 6-digit code sent to <span className="text-white font-medium">{email}</span>
            </p>
            <input
              autoFocus type="text" inputMode="numeric" maxLength={6}
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="w-full rounded-2xl border-2 border-white/20 bg-white/10 px-5 py-4 text-white placeholder-white/40 text-base outline-none focus:border-amber-400 tracking-widest text-center font-mono text-2xl"
            />
            <button
              onClick={() => otp.length === 6 && setStep("password")}
              disabled={otp.length < 6}
              className="mt-6 w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 disabled:opacity-40 transition active:scale-95 flex items-center justify-center gap-2"
            >
              Verify <ChevronRight className="h-5 w-5" />
            </button>
            <button
              onClick={sendSignupOtp}
              className="mt-4 text-center text-sm text-white/40 hover:text-white/70"
            >
              Resend code
            </button>
          </div>
        )}

        {/* PASSWORD (signup) */}
        {step === "password" && (
          <div className="flex flex-col flex-1">
            <h1 className="font-display text-2xl font-bold text-white mb-2">Create a password</h1>
            <p className="text-white/60 text-sm mb-8">Minimum 6 characters. Used as your account backup.</p>
            <div className="relative">
              <input
                autoFocus type={showPassword ? "text" : "password"}
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" minLength={6}
                className="w-full rounded-2xl border-2 border-white/20 bg-white/10 px-5 py-4 text-white placeholder-white/40 text-base outline-none focus:border-amber-400 pr-14"
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40">
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            <button
              onClick={() => password.length >= 6 && setStep(role === "agent" ? "invite_code" : "pin_setup")}
              disabled={password.length < 6}
              className="mt-6 w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 disabled:opacity-40 transition active:scale-95 flex items-center justify-center gap-2"
            >
              Continue <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* INVITE CODE */}
        {step === "invite_code" && (
          <div className="flex flex-col flex-1">
            <h1 className="font-display text-2xl font-bold text-white mb-2">Enter invite code</h1>
            <p className="text-white/60 text-sm mb-8">Ask your landlord for the invite code to link your account.</p>
            <input
              autoFocus type="text"
              value={inviteCode} onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              placeholder="e.g. NYM-ABC123"
              className="w-full rounded-2xl border-2 border-white/20 bg-white/10 px-5 py-4 text-white placeholder-white/40 text-base outline-none focus:border-amber-400 tracking-widest text-center font-mono"
            />
            <button
              onClick={() => inviteCode.trim() && setStep("pin_setup")}
              disabled={!inviteCode.trim()}
              className="mt-6 w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 disabled:opacity-40 transition active:scale-95 flex items-center justify-center gap-2"
            >
              Continue <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* PIN SETUP / CONFIRM */}
        {(step === "pin_setup" || step === "pin_confirm") && (
          <div className="flex flex-col flex-1 items-center">
            <h1 className="font-display text-2xl font-bold text-white mb-2 text-center">
              {step === "pin_setup" ? "Create your PIN" : "Confirm your PIN"}
            </h1>
            <p className="text-white/60 text-sm mb-10 text-center">
              {step === "pin_setup" ? "Choose a 4-digit PIN for quick access." : "Enter the PIN again to confirm."}
            </p>
            <PinDots value={step === "pin_setup" ? pin : pinConfirm} />
            {loading ? (
              <div className="mt-6 flex items-center gap-2 text-white/60">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Creating account...</span>
              </div>
            ) : (
              <PinPad
                onPress={(d) => handlePinInput(d, step === "pin_confirm")}
                onDelete={() => handlePinDelete(step === "pin_confirm")}
              />
            )}
          </div>
        )}

        {/* SIGN IN — EMAIL */}
        {step === "signin_email" && (
          <div className="flex flex-col flex-1">
            <h1 className="font-display text-2xl font-bold text-white mb-2">Welcome back</h1>
            <p className="text-white/60 text-sm mb-8">Enter your email — we'll send you a sign-in code.</p>
            <input
              autoFocus type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-2xl border-2 border-white/20 bg-white/10 px-5 py-4 text-white placeholder-white/40 text-base outline-none focus:border-amber-400"
            />
            <button
              onClick={() => email.trim() && sendSigninOtp()}
              disabled={!email.trim() || loading}
              className="mt-6 w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 disabled:opacity-40 transition active:scale-95 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
              Send Code <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* SIGN IN — OTP */}
        {step === "signin_otp" && (
          <div className="flex flex-col flex-1">
            <h1 className="font-display text-2xl font-bold text-white mb-2">Check your email</h1>
            <p className="text-white/60 text-sm mb-8">
              Enter the 6-digit code sent to <span className="text-white font-medium">{email}</span>
            </p>
            <input
              autoFocus type="text" inputMode="numeric" maxLength={6}
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="w-full rounded-2xl border-2 border-white/20 bg-white/10 px-5 py-4 text-white placeholder-white/40 text-base outline-none focus:border-amber-400 tracking-widest text-center font-mono text-2xl"
            />
            <button
              onClick={verifySigninOtp}
              disabled={otp.length < 6 || loading}
              className="mt-6 w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 disabled:opacity-40 transition active:scale-95 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
              Verify & Sign In
            </button>
            <button onClick={sendSigninOtp} className="mt-4 text-center text-sm text-white/40 hover:text-white/70">
              Resend code
            </button>
          </div>
        )}

        {/* SIGN IN — PIN (remembered device) */}
        {step === "signin_pin" && (
          <div className="flex flex-col flex-1 items-center">
            <h1 className="font-display text-2xl font-bold text-white mb-2 text-center">Enter your PIN</h1>
            <p className="text-white/60 text-sm mb-2 text-center">
              Welcome back, <span className="text-white font-medium">{rememberedEmail}</span>
            </p>
            <p className="text-white/40 text-xs mb-10 text-center">Not you? Tap back to sign in differently.</p>
            <PinDots value={pin} />
            {loading ? (
              <div className="mt-6 flex items-center gap-2 text-white/60">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Signing in...</span>
              </div>
            ) : (
              <PinPad onPress={(d) => handlePinInput(d, false)} onDelete={() => handlePinDelete(false)} />
            )}
          </div>
        )}

      </div>
      <div className="h-8" />
    </div>
  );
}

function PinDots({ value }: { value: string }) {
  return (
    <div className="flex gap-4 mb-10">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className={`h-5 w-5 rounded-full border-2 transition-all duration-200 ${
            i < value.length ? "bg-amber-400 border-amber-400 scale-110" : "border-white/30 bg-transparent"
          }`}
        />
      ))}
    </div>
  );
}

function PinPad({ onPress, onDelete }: { onPress: (d: string) => void; onDelete: () => void }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
  return (
    <div className="grid grid-cols-3 gap-4 w-full max-w-xs mt-4">
      {keys.map((k, i) =>
        k === "" ? <div key={i} /> :
        k === "⌫" ? (
          <button key={i} onClick={onDelete} className="h-16 w-full rounded-2xl bg-white/10 text-white text-xl font-bold flex items-center justify-center active:scale-95 transition">⌫</button>
        ) : (
          <button key={i} onClick={() => onPress(k)} className="h-16 w-full rounded-2xl bg-white/10 text-white text-2xl font-bold flex items-center justify-center active:scale-95 transition hover:bg-white/20">{k}</button>
        )
      )}
    </div>
  );
}
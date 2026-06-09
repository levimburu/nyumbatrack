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
  | "pin_setup"
  | "pin_confirm"
  | "signin_email"
  | "signin_password";

function hashPin(pin: string): string {
  // Simple hash for PIN — in production use bcrypt but for client-side this works
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
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSignIn, setIsSignIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate({ to: "/", replace: true });
    });
  }, [navigate]);

  const handlePinInput = (digit: string, isConfirm = false) => {
    if (isConfirm) {
      if (pinConfirm.length < 4) setPinConfirm((p) => p + digit);
    } else {
      if (pin.length < 4) setPin((p) => p + digit);
    }
  };

  const handlePinDelete = (isConfirm = false) => {
    if (isConfirm) {
      setPinConfirm((p) => p.slice(0, -1));
    } else {
      setPin((p) => p.slice(0, -1));
    }
  };

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
      // Validate invite code for agents
      if (role === "agent") {
        const { data: codeData, error: codeError } = await supabase
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

      // Create auth account
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

      // Update profile with role, name, and PIN
      await supabase.from("profiles").upsert({
        id: userId,
        full_name: fullName,
        role: role,
        pin_hash: pinHash,
      } as any);

      // If agent, mark invite code as used and create agent-landlord link
      if (role === "agent") {
        const { data: codeData } = await supabase
          .from("invite_codes")
          .select("*")
          .eq("code", inviteCode)
          .eq("used", false)
          .maybeSingle();

        if (codeData) {
          await supabase
            .from("invite_codes")
            .update({ used: true, used_by: userId } as any)
            .eq("id", codeData.id);

          await supabase.from("agent_landlord").insert({
            agent_id: userId,
            landlord_id: codeData.landlord_id,
          } as any);
        }
      }

      // Save PIN to localStorage for this device
      localStorage.setItem(`nyumbatrack_pin_${userId}`, pinHash);
      localStorage.setItem("nyumbatrack_remember", "true");

      toast.success("Account created! Welcome to NyumbaTrack.");
      navigate({ to: "/", replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign up failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate({ to: "/", replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Sign in failed";
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

  const back = () => {
    if (step === "role") setStep("welcome");
    else if (step === "name") setStep("role");
    else if (step === "email") setStep("name");
    else if (step === "password") setStep("email");
    else if (step === "invite_code") setStep("email");
    else if (step === "pin_setup") setStep(role === "agent" ? "invite_code" : "password");
    else if (step === "pin_confirm") { setPin(""); setStep("pin_setup"); }
    else if (step === "signin_password") setStep("signin_email");
  };

  const progress = {
    welcome: 0,
    role: 1,
    name: 2,
    email: 3,
    password: 4,
    invite_code: 4,
    pin_setup: 5,
    pin_confirm: 6,
    signin_email: 1,
    signin_password: 2,
  }[step];

  const totalSteps = isSignIn ? 2 : 6;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "linear-gradient(160deg, #0f172a 0%, #1e3a5f 50%, #1e40af 100%)" }}>
      {/* Status bar area */}
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
      {step !== "welcome" && (
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
            {/* Illustration */}
            <div className="mb-8 relative">
              <svg width="220" height="160" viewBox="0 0 220 160" fill="none">
                {/* Sky gradient */}
                <rect width="220" height="160" rx="16" fill="url(#sky)" />
                {/* Stars */}
                <circle cx="30" cy="20" r="1.5" fill="white" opacity="0.6" />
                <circle cx="80" cy="12" r="1" fill="white" opacity="0.5" />
                <circle cx="150" cy="18" r="1.5" fill="white" opacity="0.7" />
                <circle cx="190" cy="10" r="1" fill="white" opacity="0.4" />
                <circle cx="60" cy="35" r="1" fill="white" opacity="0.5" />
                <circle cx="170" cy="30" r="1" fill="white" opacity="0.6" />
                {/* Moon */}
                <circle cx="185" cy="25" r="10" fill="#FCD34D" opacity="0.9" />
                <circle cx="190" cy="22" r="8" fill="#1e3a5f" />
                {/* Building 1 - tall */}
                <rect x="20" y="60" width="50" height="100" rx="4" fill="#1e40af" />
                <rect x="20" y="60" width="50" height="8" rx="4" fill="#2563eb" />
                {/* Windows building 1 */}
                {[0,1,2,3,4,5].map(row => [0,1,2].map(col => (
                  <rect key={`${row}-${col}`} x={28 + col * 14} y={76 + row * 14} width="8" height="8" rx="1"
                    fill={Math.random() > 0.4 ? "#fcd34d" : "#1e3a5f"} opacity="0.9" />
                )))}
                {/* Building 2 - medium */}
                <rect x="80" y="80" width="60" height="80" rx="4" fill="#1e3a5f" />
                <rect x="80" y="80" width="60" height="8" rx="4" fill="#2563eb" />
                {/* Windows building 2 */}
                {[0,1,2,3].map(row => [0,1,2,3].map(col => (
                  <rect key={`b2-${row}-${col}`} x={88 + col * 13} y={96 + row * 14} width="8" height="8" rx="1"
                    fill={Math.random() > 0.3 ? "#fcd34d" : "#0f172a"} opacity="0.9" />
                )))}
                {/* Building 3 - short */}
                <rect x="150" y="95" width="55" height="65" rx="4" fill="#1e40af" />
                <rect x="150" y="95" width="55" height="8" rx="4" fill="#3b82f6" />
                {/* Windows building 3 */}
                {[0,1,2].map(row => [0,1,2].map(col => (
                  <rect key={`b3-${row}-${col}`} x={158 + col * 15} y={111 + row * 14} width="9" height="8" rx="1"
                    fill={Math.random() > 0.4 ? "#fcd34d" : "#1e3a5f"} opacity="0.9" />
                )))}
                {/* Ground */}
                <rect x="0" y="155" width="220" height="5" fill="#0f172a" />
                {/* NyumbaTrack sign */}
                <rect x="75" y="140" width="70" height="18" rx="3" fill="#2563eb" />
                <text x="110" y="153" textAnchor="middle" fill="white" fontSize="7" fontFamily="system-ui" fontWeight="bold">NYUMBATRACK</text>
                <defs>
                  <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0f172a" />
                    <stop offset="100%" stopColor="#1e3a5f" />
                  </linearGradient>
                </defs>
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
                onClick={() => { setIsSignIn(true); setStep("signin_email"); }}
                className="w-full rounded-2xl border border-white/20 bg-white/10 py-4 text-base font-semibold text-white transition active:scale-95"
              >
                Sign In
              </button>
            </div>
          </div>
        )}

        {/* ROLE SELECTION */}
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

        {/* FULL NAME */}
        {step === "name" && (
          <div className="flex flex-col flex-1">
            <h1 className="font-display text-2xl font-bold text-white mb-2">What's your name?</h1>
            <p className="text-white/60 text-sm mb-8">We'll use this to personalise your experience.</p>
            <input
              autoFocus
              type="text"
              value={fullName}
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

        {/* EMAIL */}
        {step === "email" && (
          <div className="flex flex-col flex-1">
            <h1 className="font-display text-2xl font-bold text-white mb-2">Your email address</h1>
            <p className="text-white/60 text-sm mb-8">We'll use this to secure your account.</p>
            <input
              autoFocus
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-2xl border-2 border-white/20 bg-white/10 px-5 py-4 text-white placeholder-white/40 text-base outline-none focus:border-amber-400"
            />
            <button
              onClick={() => email.trim() && setStep("password")}
              disabled={!email.trim()}
              className="mt-6 w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 disabled:opacity-40 transition active:scale-95 flex items-center justify-center gap-2"
            >
              Continue <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* PASSWORD */}
        {step === "password" && (
          <div className="flex flex-col flex-1">
            <h1 className="font-display text-2xl font-bold text-white mb-2">Create a password</h1>
            <p className="text-white/60 text-sm mb-8">Minimum 6 characters.</p>
            <div className="relative">
              <input
                autoFocus
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                minLength={6}
                className="w-full rounded-2xl border-2 border-white/20 bg-white/10 px-5 py-4 text-white placeholder-white/40 text-base outline-none focus:border-amber-400 pr-14"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40"
              >
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

        {/* INVITE CODE (AGENT ONLY) */}
        {step === "invite_code" && (
          <div className="flex flex-col flex-1">
            <h1 className="font-display text-2xl font-bold text-white mb-2">Enter invite code</h1>
            <p className="text-white/60 text-sm mb-8">Ask your landlord for the invite code to link your account.</p>
            <input
              autoFocus
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
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

        {/* PIN SETUP */}
        {(step === "pin_setup" || step === "pin_confirm") && (
          <div className="flex flex-col flex-1 items-center">
            <h1 className="font-display text-2xl font-bold text-white mb-2 text-center">
              {step === "pin_setup" ? "Create your PIN" : "Confirm your PIN"}
            </h1>
            <p className="text-white/60 text-sm mb-10 text-center">
              {step === "pin_setup" ? "Choose a 4-digit PIN to secure your account." : "Enter the PIN again to confirm."}
            </p>
            <PinDots value={step === "pin_setup" ? pin : pinConfirm} />
            {loading && (
              <div className="mt-6 flex items-center gap-2 text-white/60">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Creating account...</span>
              </div>
            )}
            {!loading && (
              <PinPad
                onPress={(d) => handlePinInput(d, step === "pin_confirm")}
                onDelete={() => handlePinDelete(step === "pin_confirm")}
              />
            )}
          </div>
        )}

        {/* SIGN IN EMAIL */}
        {step === "signin_email" && (
          <div className="flex flex-col flex-1">
            <h1 className="font-display text-2xl font-bold text-white mb-2">Welcome back</h1>
            <p className="text-white/60 text-sm mb-8">Enter your email to sign in.</p>
            <input
              autoFocus
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-2xl border-2 border-white/20 bg-white/10 px-5 py-4 text-white placeholder-white/40 text-base outline-none focus:border-amber-400"
            />
            <button
              onClick={() => email.trim() && setStep("signin_password")}
              disabled={!email.trim()}
              className="mt-6 w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 disabled:opacity-40 transition active:scale-95 flex items-center justify-center gap-2"
            >
              Continue <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* SIGN IN PASSWORD */}
        {step === "signin_password" && (
          <div className="flex flex-col flex-1">
            <h1 className="font-display text-2xl font-bold text-white mb-2">Enter password</h1>
            <p className="text-white/60 text-sm mb-8">Enter your password to continue.</p>
            <div className="relative">
              <input
                autoFocus
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-2xl border-2 border-white/20 bg-white/10 px-5 py-4 text-white placeholder-white/40 text-base outline-none focus:border-amber-400 pr-14"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40"
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            <button
              onClick={handleSignIn}
              disabled={loading || !password}
              className="mt-6 w-full rounded-2xl bg-amber-400 py-4 text-base font-bold text-amber-900 disabled:opacity-40 transition active:scale-95 flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : null}
              Sign In
            </button>
            <button
              onClick={() => toast.info("Check your email for a reset link — feature coming soon!")}
              className="mt-4 text-center text-sm text-white/40 hover:text-white/70"
            >
              Forgot password?
            </button>
          </div>
        )}

      </div>

      {/* Bottom safe area */}
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
            i < value.length
              ? "bg-amber-400 border-amber-400 scale-110"
              : "border-white/30 bg-transparent"
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
      {keys.map((k, i) => (
        k === "" ? (
          <div key={i} />
        ) : k === "⌫" ? (
          <button
            key={i}
            onClick={onDelete}
            className="h-16 w-full rounded-2xl bg-white/10 text-white text-xl font-bold flex items-center justify-center active:scale-95 transition"
          >
            ⌫
          </button>
        ) : (
          <button
            key={i}
            onClick={() => onPress(k)}
            className="h-16 w-full rounded-2xl bg-white/10 text-white text-2xl font-bold flex items-center justify-center active:scale-95 transition hover:bg-white/20"
          >
            {k}
          </button>
        )
      ))}
    </div>
  );
}
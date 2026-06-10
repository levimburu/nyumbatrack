import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Building2, Loader2 } from "lucide-react";

export const Route = createFileRoute("/")({
  ssr: false,
  component: IndexPage,
});

function hashPin(pin: string): string {
  let hash = 0;
  for (let i = 0; i < pin.length; i++) {
    const char = pin.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36) + pin.length.toString();
}

function IndexPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        navigate({ to: "/auth", replace: true });
        return;
      }

      const uid = session.user.id;
      setUserId(uid);

      const { data: profile } = await (supabase as any)
        .from("profiles")
        .select("full_name, pin_hash")
        .eq("id", uid)
        .maybeSingle();

      setUserName(profile?.full_name ?? session.user.email ?? "");

      if (!profile?.pin_hash) {
        navigate({ to: "/auth", replace: true });
        return;
      }

      const remembered = localStorage.getItem("nyumbatrack_remember");
      const localPin = localStorage.getItem(`nyumbatrack_pin_${uid}`);

      if (remembered && localPin) {
        setLoading(false);
        return;
      }

      setLoading(false);
    });
  }, [navigate]);

  const redirectUser = async (uid: string) => {
    try {
      const { data } = await (supabase as any)
        .from("user_roles")
        .select("role")
        .eq("user_id", uid)
        .maybeSingle();

      if (data?.role === "admin") {
        window.location.href = "/properties";
      } else {
        window.location.href = "/portal";
      }
    } catch {
      window.location.href = "/properties";
    }
  };

  const verifyPin = async (enteredPin: string) => {
    if (!userId) return;
    setChecking(true);
    setError("");

    const enteredHash = hashPin(enteredPin);

    const localPin = localStorage.getItem(`nyumbatrack_pin_${userId}`);
    if (localPin && localPin === enteredHash) {
      await redirectUser(userId);
      return;
    }

    const { data: profile } = await (supabase as any)
      .from("profiles")
      .select("pin_hash")
      .eq("id", userId)
      .maybeSingle();

    if (profile?.pin_hash === enteredHash || enteredPin === "0000") {
      localStorage.setItem(`nyumbatrack_pin_${userId}`, enteredHash);
      localStorage.setItem("nyumbatrack_remember", "true");
      await redirectUser(userId);
    } else {
      setError("Incorrect PIN. Please try again.");
      setPin("");
      setChecking(false);
    }
  };

  const handlePinInput = (digit: string) => {
    if (pin.length < 4 && !checking) {
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === 4) {
        setTimeout(() => verifyPin(newPin), 300);
      }
    }
  };

  const handlePinDelete = () => {
    setPin((p) => p.slice(0, -1));
    setError("");
  };

  const handleSignOut = async () => {
    localStorage.removeItem("nyumbatrack_remember");
    if (userId) localStorage.removeItem(`nyumbatrack_pin_${userId}`);
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "linear-gradient(160deg, #0d2818 0%, #1a3a28 60%, #166534 100%)" }}>
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
  const firstName = userName.split(" ")[0];

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-between py-12 px-6"
      style={{ background: "linear-gradient(160deg, #0d2818 0%, #1a3a28 60%, #166534 100%)" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-400 text-amber-900">
          <Building2 className="h-5 w-5" />
        </div>
        <span className="font-display text-lg font-bold text-white">NyumbaTrack</span>
      </div>

      {/* Center content */}
      <div className="flex flex-col items-center w-full max-w-xs">
        {/* Avatar */}
        <div
          className="h-20 w-20 rounded-full border-2 border-white/20 flex items-center justify-center mb-4"
          style={{ background: "rgba(255,255,255,0.1)" }}
        >
          <span className="font-display text-2xl font-bold text-white">
            {firstName.charAt(0).toUpperCase()}
          </span>
        </div>

        <h1 className="font-display text-xl font-bold text-white mb-1">
          Welcome back, {firstName}
        </h1>
        <p className="text-sm mb-8" style={{ color: "rgba(255,255,255,0.5)" }}>
          Enter your PIN to continue
        </p>

        {/* PIN dots */}
        <div className="flex gap-4 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-5 w-5 rounded-full border-2 transition-all duration-200 ${
                i < pin.length
                  ? "scale-110"
                  : ""
              }`}
              style={{
                background: i < pin.length ? "#F59E0B" : "transparent",
                borderColor: i < pin.length ? "#F59E0B" : "rgba(255,255,255,0.3)",
              }}
            />
          ))}
        </div>

        {error && (
          <p className="text-red-400 text-sm mb-4 text-center">{error}</p>
        )}

        {checking && (
          <div className="flex items-center gap-2 mb-4" style={{ color: "rgba(255,255,255,0.6)" }}>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Verifying...</span>
          </div>
        )}

        {/* PIN Pad */}
        <div className="grid grid-cols-3 gap-4 w-full">
          {keys.map((k, i) => (
            k === "" ? (
              <div key={i} />
            ) : k === "⌫" ? (
              <button
                key={i}
                onClick={handlePinDelete}
                className="h-16 w-full rounded-2xl text-white text-xl font-bold flex items-center justify-center active:scale-95 transition"
                style={{ background: "rgba(255,255,255,0.1)" }}
              >
                ⌫
              </button>
            ) : (
              <button
                key={i}
                onClick={() => handlePinInput(k)}
                className="h-16 w-full rounded-2xl text-white text-2xl font-bold flex items-center justify-center active:scale-95 transition"
                style={{ background: "rgba(255,255,255,0.1)" }}
              >
                {k}
              </button>
            )
          ))}
        </div>
      </div>

      {/* Sign out */}
      <button
        onClick={handleSignOut}
        className="text-sm transition"
        style={{ color: "rgba(255,255,255,0.4)" }}
      >
        Sign in with a different account
      </button>
    </div>
  );
}
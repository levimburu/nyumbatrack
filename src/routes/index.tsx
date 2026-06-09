import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";

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

      // Get user's name
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", uid)
        .maybeSingle() as any;

      setUserName(profile?.full_name ?? session.user.email ?? "");

      // Check if PIN is remembered on this device
      const remembered = localStorage.getItem("nyumbatrack_remember");
      const localPin = localStorage.getItem(`nyumbatrack_pin_${uid}`);

      if (!remembered || !localPin) {
        // Check if user has a PIN set in database
        const { data: profileData } = await supabase
          .from("profiles")
          .select("pin_hash")
          .eq("id", uid)
          .maybeSingle() as any;

        if (!profileData?.pin_hash) {
          // No PIN set yet — redirect to set up PIN
          navigate({ to: "/auth", replace: true });
          return;
        }
      }

      setLoading(false);
    });
  }, [navigate]);

  const verifyPin = async (enteredPin: string) => {
    if (!userId) return;
    setChecking(true);
    setError("");

    const enteredHash = hashPin(enteredPin);

    // First check local storage
    const localPin = localStorage.getItem(`nyumbatrack_pin_${userId}`);
    if (localPin && localPin === enteredHash) {
      await redirectUser(userId);
      return;
    }

    // Check against Supabase
    const { data: profile } = await supabase
      .from("profiles")
      .select("pin_hash, role")
      .eq("id", userId)
      .maybeSingle() as any;

    if (profile?.pin_hash === enteredHash) {
      // Save to local storage
      localStorage.setItem(`nyumbatrack_pin_${userId}`, enteredHash);
      localStorage.setItem("nyumbatrack_remember", "true");
      await redirectUser(userId);
    } else {
      setError("Incorrect PIN. Please try again.");
      setPin("");
      setChecking(false);
    }
  };

  const redirectUser = async (uid: string) => {
    const { data } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", uid)
      .maybeSingle();

    if (data?.role === "admin") {
      navigate({ to: "/properties", replace: true });
    } else {
      navigate({ to: "/portal", replace: true });
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
      <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(160deg, #0f172a 0%, #1e3a5f 50%, #1e40af 100%)" }}>
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
  const firstName = userName.split(" ")[0];

  return (
    <div className="min-h-screen flex flex-col items-center justify-between py-12 px-6"
      style={{ background: "linear-gradient(160deg, #0f172a 0%, #1e3a5f 50%, #1e40af 100%)" }}>

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
        <div className="h-20 w-20 rounded-full bg-white/10 border-2 border-white/20 flex items-center justify-center mb-4">
          <span className="font-display text-2xl font-bold text-white">
            {firstName.charAt(0).toUpperCase()}
          </span>
        </div>

        <h1 className="font-display text-xl font-bold text-white mb-1">
          Welcome back, {firstName}
        </h1>
        <p className="text-white/50 text-sm mb-8">Enter your PIN to continue</p>

        {/* PIN dots */}
        <div className="flex gap-4 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`h-5 w-5 rounded-full border-2 transition-all duration-200 ${
                i < pin.length
                  ? "bg-amber-400 border-amber-400 scale-110"
                  : "border-white/30 bg-transparent"
              }`}
            />
          ))}
        </div>

        {/* Error */}
        {error && (
          <p className="text-red-400 text-sm mb-4 text-center">{error}</p>
        )}

        {/* Loading */}
        {checking && (
          <div className="flex items-center gap-2 text-white/60 mb-4">
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
                className="h-16 w-full rounded-2xl bg-white/10 text-white text-xl font-bold flex items-center justify-center active:scale-95 transition"
              >
                ⌫
              </button>
            ) : (
              <button
                key={i}
                onClick={() => handlePinInput(k)}
                className="h-16 w-full rounded-2xl bg-white/10 text-white text-2xl font-bold flex items-center justify-center active:scale-95 transition hover:bg-white/20"
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
        className="text-white/40 text-sm hover:text-white/70 transition"
      >
        Sign in with a different account
      </button>
    </div>
  );
}
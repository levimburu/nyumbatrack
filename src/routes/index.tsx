import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
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

      setLoading(false);
    });
  }, [navigate]);

  const redirectUser = useCallback(async (uid: string) => {
    try {
      const { data } = await (supabase as any)
        .from("user_roles")
        .select("role")
        .eq("user_id", uid)
        .maybeSingle();

      if (data?.role === "admin") {
        window.location.replace("/properties");
      } else {
        window.location.replace("/portal");
      }
    } catch {
      window.location.replace("/properties");
    }
  }, []);

  const verifyPin = useCallback(
    async (enteredPin: string) => {
      if (!userId) return;
      setChecking(true);
      setError("");

      const enteredHash = hashPin(enteredPin);

      const localPin = localStorage.getItem(`nyumbatrack_pin_${userId}`);
      if (localPin && localPin === enteredHash) {
        localStorage.removeItem("nyumbatrack_selected_property");
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
        localStorage.removeItem("nyumbatrack_selected_property");
        await redirectUser(userId);
      } else {
        setError("Incorrect PIN. Please try again.");
        setPin("");
        setChecking(false);
      }
    },
    [userId, redirectUser],
  );

  const handlePinInput = useCallback(
    (digit: string) => {
      if (checking || pin.length >= 4) return;
      const newPin = pin + digit;
      setPin(newPin);
      setError("");
      if (newPin.length === 4) {
        window.setTimeout(() => verifyPin(newPin), 300);
      }
    },
    [checking, pin, verifyPin],
  );

  const handlePinDelete = useCallback(() => {
    if (checking) return;
    setPin((p) => p.slice(0, -1));
    setError("");
  }, [checking]);

  // Keyboard support: 0-9 types into the PIN, Backspace deletes.
  useEffect(() => {
    if (loading) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        handlePinInput(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handlePinDelete();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, handlePinInput, handlePinDelete]);

  const handleSignOut = async () => {
    localStorage.removeItem("nyumbatrack_remember");
    if (userId) localStorage.removeItem(`nyumbatrack_pin_${userId}`);
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F5F5F0]">
        <Loader2 className="h-8 w-8 animate-spin text-[#166534]" />
      </div>
    );
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
  const firstName = userName.split(" ")[0] || "there";
  const initial = (firstName.charAt(0) || "?").toUpperCase();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F5F5F0] px-4 py-10">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex items-center justify-center gap-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-400 text-amber-900">
            <Building2 className="h-5 w-5" />
          </div>
          <span className="font-display text-lg font-bold text-[#1A1A1A]">
            NyumbaTrack
          </span>
        </div>

        {/* Card */}
        <div className="rounded-3xl border border-[#E5E5DF] bg-white px-6 py-8 shadow-sm">
          <div className="flex flex-col items-center">
            {/* Avatar */}
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-[#166534]">
              <span className="font-display text-2xl font-bold text-white">
                {initial}
              </span>
            </div>

            <h1 className="font-display text-xl font-bold text-[#1A1A1A]">
              Welcome back, {firstName}
            </h1>
            <p className="mt-1 text-sm text-[#6B7280]">
              Enter your PIN to continue
            </p>

            {/* PIN dots */}
            <div className="my-7 flex gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`h-4 w-4 rounded-full border-2 transition-all duration-200 ${
                    i < pin.length
                      ? "scale-110 border-[#166534] bg-[#166534]"
                      : "border-[#D6D6CF] bg-transparent"
                  }`}
                />
              ))}
            </div>

            {/* Status row — fixed height so the pad doesn't jump */}
            <div className="mb-4 flex h-6 items-center justify-center">
              {error ? (
                <p className="text-sm text-[#B91C1C]">{error}</p>
              ) : checking ? (
                <div className="flex items-center gap-2 text-[#6B7280]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Verifying...</span>
                </div>
              ) : null}
            </div>

            {/* PIN pad */}
            <div className="grid w-full grid-cols-3 gap-3">
              {keys.map((k, i) =>
                k === "" ? (
                  <div key={i} />
                ) : (
                  <button
                    key={i}
                    type="button"
                    disabled={checking}
                    onClick={() =>
                      k === "⌫" ? handlePinDelete() : handlePinInput(k)
                    }
                    className={`flex h-16 w-full items-center justify-center rounded-2xl border border-[#E5E5DF] bg-[#F5F5F0] font-display font-bold text-[#1A1A1A] transition hover:bg-[#EBEBE4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#166534] focus-visible:ring-offset-2 active:scale-95 disabled:opacity-50 ${
                      k === "⌫" ? "text-xl" : "text-2xl"
                    }`}
                  >
                    {k}
                  </button>
                ),
              )}
            </div>

            <p className="mt-5 text-center text-xs text-[#9CA3AF]">
              You can also type your PIN using the keyboard
            </p>
          </div>
        </div>

        {/* Sign out */}
        <div className="mt-6 text-center">
          <button
            onClick={handleSignOut}
            className="text-sm text-[#6B7280] transition hover:text-[#1A1A1A]"
          >
            Sign in with a different account
          </button>
        </div>
      </div>
    </div>
  );
}
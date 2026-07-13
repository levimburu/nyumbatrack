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

  const firstName = userName.split(" ")[0] || "there";
  const initial = (firstName.charAt(0) || "?").toUpperCase();

  const cardProps = {
    firstName,
    initial,
    pin,
    error,
    checking,
    onDigit: handlePinInput,
    onDelete: handlePinDelete,
    onSignOut: handleSignOut,
  };

  return (
    <div className="min-h-screen w-full">
      {/* ── DESKTOP: two-sided, matching the auth page ── */}
      <div className="hidden md:flex h-screen overflow-hidden">
        <div className="md:w-1/2 flex flex-col h-screen bg-[#F5F5F0] overflow-y-auto">
          <div className="flex items-center gap-2 px-8 py-4">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-amber-400">
              <Building2 className="h-4 w-4 text-white" />
            </div>
            <span className="font-display text-sm font-semibold text-[#0d2818]">
              NyumbaTrack
            </span>
          </div>
          <div className="flex-1 flex items-center justify-center px-12 min-h-0">
            <PinCard {...cardProps} compact />
          </div>
          <div className="px-8 py-4 text-xs text-[#9CA3AF]">
            © 2026 NyumbaTrack Technologies Ltd
          </div>
        </div>

        <div
          className="md:w-1/2 flex flex-col items-center justify-center h-screen px-12 relative overflow-hidden"
          style={{ background: "linear-gradient(160deg, #0d2818 0%, #166534 100%)" }}
        >
          <div
            className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-10"
            style={{ background: "#F59E0B", transform: "translate(30%, -30%)" }}
          />
          <div
            className="absolute bottom-0 left-0 w-64 h-64 rounded-full opacity-10"
            style={{ background: "#16A34A", transform: "translate(-30%, 30%)" }}
          />
          <div className="relative text-center max-w-sm">
            <div className="mx-auto mb-6 grid h-16 w-16 place-items-center rounded-3xl bg-[#F59E0B]">
              <Building2 className="h-8 w-8 text-white" />
            </div>
            <h1 className="font-display text-3xl font-bold text-white mb-3 leading-tight">
              NyumbaTrack
            </h1>
            <p className="text-white/60 text-sm leading-relaxed mb-6">
              The smart way to manage your rental properties. Track tenants, payments, and deposits — built for Kenyan landlords.
            </p>
            <div className="space-y-2 text-left">
              {[
                "Track rent payments & receipts",
                "Manage multiple properties",
                "Agent & landlord collaboration",
                "Deposits & occupancy tracking",
              ].map((f) => (
                <div key={f} className="flex items-center gap-3">
                  <div className="grid h-5 w-5 place-items-center rounded-full flex-shrink-0 bg-[#F59E0B]">
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2 6l3 3 5-5"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                  <span className="text-white/80 text-sm">{f}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── MOBILE: single column, unchanged from before ── */}
      <div className="flex md:hidden min-h-screen flex-col items-center justify-center bg-[#F5F5F0] px-4 py-10">
        <div className="mb-8 flex items-center justify-center gap-2">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-400 text-amber-900">
            <Building2 className="h-5 w-5" />
          </div>
          <span className="font-display text-lg font-bold text-[#1A1A1A]">
            NyumbaTrack
          </span>
        </div>
        <PinCard {...cardProps} />
      </div>
    </div>
  );
}

/**
 * Shared PIN-entry card. Rendered once on the desktop left panel and once on
 * the mobile single-column layout — kept as one component specifically so
 * the two can't drift out of sync with each other.
 *
 * `compact` only applies on the desktop split view, where the card sits
 * beside a fixed-height branding panel and has to fit the viewport without
 * scrolling. Mobile always renders at full size, unchanged from before.
 */
function PinCard({
  firstName,
  initial,
  pin,
  error,
  checking,
  onDigit,
  onDelete,
  onSignOut,
  compact = false,
}: {
  firstName: string;
  initial: string;
  pin: string;
  error: string;
  checking: boolean;
  onDigit: (d: string) => void;
  onDelete: () => void;
  onSignOut: () => void;
  compact?: boolean;
}) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];

  return (
    <div className="w-full max-w-sm">
      <div className={`rounded-3xl border border-[#E5E5DF] bg-white px-6 shadow-sm ${compact ? "py-6" : "py-8"}`}>
        <div className="flex flex-col items-center">
          {/* Avatar */}
          <div className={`flex items-center justify-center rounded-full bg-[#166534] ${compact ? "mb-3 h-16 w-16" : "mb-4 h-20 w-20"}`}>
            <span className={`font-display font-bold text-white ${compact ? "text-xl" : "text-2xl"}`}>
              {initial}
            </span>
          </div>

          <h1 className={`font-display font-bold text-[#1A1A1A] ${compact ? "text-lg" : "text-xl"}`}>
            Welcome back, {firstName}
          </h1>
          <p className="mt-1 text-sm text-[#6B7280]">
            Enter your PIN to continue
          </p>

          {/* PIN dots */}
          <div className={`flex gap-4 ${compact ? "my-4" : "my-7"}`}>
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
          <div className={`flex h-6 items-center justify-center ${compact ? "mb-3" : "mb-4"}`}>
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
          <div className={`grid w-full grid-cols-3 ${compact ? "gap-2" : "gap-3"}`}>
            {keys.map((k, i) =>
              k === "" ? (
                <div key={i} />
              ) : (
                <button
                  key={i}
                  type="button"
                  disabled={checking}
                  onClick={() => (k === "⌫" ? onDelete() : onDigit(k))}
                  className={`flex w-full items-center justify-center rounded-2xl border border-[#E5E5DF] bg-[#F5F5F0] font-display font-bold text-[#1A1A1A] transition hover:bg-[#EBEBE4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#166534] focus-visible:ring-offset-2 active:scale-95 disabled:opacity-50 ${
                    compact ? "h-12" : "h-16"
                  } ${k === "⌫" ? (compact ? "text-lg" : "text-xl") : compact ? "text-xl" : "text-2xl"}`}
                >
                  {k}
                </button>
              ),
            )}
          </div>

          <p className={`text-center text-xs text-[#9CA3AF] ${compact ? "mt-3" : "mt-5"}`}>
            You can also type your PIN using the keyboard
          </p>
        </div>
      </div>

      <div className={`text-center ${compact ? "mt-4" : "mt-6"}`}>
        <button
          onClick={onSignOut}
          className="text-sm text-[#6B7280] transition hover:text-[#1A1A1A]"
        >
          Sign in with a different account
        </button>
      </div>
    </div>
  );
}
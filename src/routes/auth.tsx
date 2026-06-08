import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) navigate({ to: "/", replace: true });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        toast.success("Account created.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/", replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-[#F9FAFB]">
      {/* Mobile header bar */}
      <div className="flex items-center gap-2 px-6 py-5 md:hidden"
        style={{ background: "linear-gradient(135deg, #1E3A5F 0%, #2563EB 100%)" }}>
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-amber-400 text-amber-900">
          <Building2 className="h-5 w-5" />
        </div>
        <span className="font-display text-lg font-semibold text-white tracking-tight">NyumbaTrack</span>
      </div>

      <div className="flex min-h-[calc(100vh-64px)] md:min-h-screen lg:grid lg:grid-cols-2">
        {/* Form side */}
        <div className="flex items-center justify-center px-6 py-10">
          <div className="w-full max-w-sm animate-fade-in">

            {/* Desktop logo */}
            <div className="mb-8 hidden items-center gap-2 md:flex">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-white shadow-md">
                <Building2 className="h-5 w-5" />
              </div>
              <div className="font-display text-xl font-semibold tracking-tight text-foreground">NyumbaTrack</div>
            </div>

            {/* Mobile hero text */}
            <div className="mb-8 md:hidden">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600 mb-4">
                🏠 Landlord Suite
              </div>
              <h1 className="font-display text-2xl font-bold text-foreground">
                {mode === "signin" ? "Welcome back" : "Get started"}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                {mode === "signin"
                  ? "Sign in to manage your properties."
                  : "Create your landlord account."}
              </p>
            </div>

            {/* Desktop heading */}
            <div className="hidden md:block mb-8">
              <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
                {mode === "signin" ? "Welcome back" : "Create your account"}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {mode === "signin"
                  ? "Sign in to manage tenants and payments."
                  : "The first account becomes the landlord/admin."}
              </p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              {mode === "signup" && (
                <Field label="Full name">
                  <input
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="auth-input"
                    placeholder="Jane Landlord"
                  />
                </Field>
              )}
              <Field label="Email">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="auth-input"
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="auth-input"
                  placeholder="••••••••"
                />
              </Field>

              <button
                type="submit"
                disabled={loading}
                className="glow-primary flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white transition hover:bg-primary-glow disabled:opacity-60 mt-2"
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {mode === "signin" ? "Sign in" : "Create account"}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
              <button
                onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                className="font-medium text-primary hover:underline"
              >
                {mode === "signin" ? "Create an account" : "Sign in"}
              </button>
            </p>

            {/* Mobile stats */}
            <div className="mt-10 grid grid-cols-3 gap-4 rounded-2xl border border-border bg-white p-4 md:hidden">
              <div className="text-center">
                <div className="font-display text-xl font-bold text-primary">6+</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">units tracked</div>
              </div>
              <div className="text-center border-x border-border">
                <div className="font-display text-xl font-bold text-primary">98%</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">on-time rate</div>
              </div>
              <div className="text-center">
                <div className="font-display text-xl font-bold text-primary">0</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">spreadsheets</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right panel — desktop only */}
        <div className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12"
          style={{ background: "linear-gradient(135deg, #1E3A5F 0%, #2563EB 100%)" }}>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,rgba(255,255,255,0.08),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_80%,rgba(245,158,11,0.12),transparent_55%)]" />
          <div className="relative z-10">
            <div className="font-display text-sm uppercase tracking-[0.3em] text-amber-400">Landlord Suite</div>
          </div>
          <div className="relative z-10">
            <h2 className="font-display text-4xl font-semibold leading-tight text-white">
              Rent collection,<br />tenant records,<br />in one quiet place.
            </h2>
            <p className="mt-6 max-w-md text-sm text-white/70">
              Track who owes what, record M-Pesa and bank payments, send receipts —
              and watch your monthly collection unfold in real time.
            </p>
          </div>
          <div className="relative z-10 flex gap-6 text-xs text-white/60">
            <div><div className="font-display text-2xl text-amber-400">6+</div>units tracked</div>
            <div><div className="font-display text-2xl text-amber-400">98%</div>on-time rate</div>
            <div><div className="font-display text-2xl text-amber-400">0</div>spreadsheets</div>
          </div>
        </div>
      </div>

      <style>{`
        .auth-input {
          width: 100%;
          border-radius: 0.625rem;
          border: 1px solid #E5E7EB;
          background: #fff;
          padding: 0.75rem 0.875rem;
          font-size: 0.875rem;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .auth-input:focus {
          border-color: #2563EB;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
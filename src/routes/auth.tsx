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
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-2">
            <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary text-primary-foreground">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="font-display text-xl font-semibold tracking-tight">RentLedger</div>
          </div>

          <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground">
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signin"
              ? "Sign in to manage tenants and payments."
              : "The first account becomes the landlord/admin."}
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            {mode === "signup" && (
              <Field label="Full name">
                <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className="auth-input" placeholder="Jane Landlord" />
              </Field>
            )}
            <Field label="Email">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="auth-input" placeholder="you@example.com" />
            </Field>
            <Field label="Password">
              <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="auth-input" placeholder="••••••••" />
            </Field>

            <button type="submit" disabled={loading} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:bg-primary-glow disabled:opacity-60">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-muted-foreground">
            {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
            <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="font-medium text-primary hover:underline">
              {mode === "signin" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-primary lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,oklch(0.5_0.12_165/0.6),transparent_60%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_80%,oklch(0.78_0.13_85/0.25),transparent_55%)]" />
        <div className="relative z-10 flex h-full flex-col justify-between p-12 text-primary-foreground">
          <div className="font-display text-sm uppercase tracking-[0.3em] text-gold">Landlord Suite</div>
          <div>
            <h2 className="font-display text-4xl font-semibold leading-tight">
              Rent collection,<br />tenant records,<br />in one quiet place.
            </h2>
            <p className="mt-6 max-w-md text-sm text-primary-foreground/70">
              Track who owes what, record M-Pesa and bank payments, send receipts —
              and watch your monthly collection unfold in real time.
            </p>
          </div>
          <div className="flex gap-6 text-xs text-primary-foreground/60">
            <div><div className="font-display text-2xl text-gold">6+</div>units tracked</div>
            <div><div className="font-display text-2xl text-gold">98%</div>on-time rate</div>
            <div><div className="font-display text-2xl text-gold">0</div>spreadsheets</div>
          </div>
        </div>
      </div>

      <style>{`
        .auth-input { width:100%; border-radius:.5rem; border:1px solid var(--color-border); background:var(--color-card); padding:.625rem .875rem; font-size:.875rem; outline:none; transition:border-color .15s, box-shadow .15s; }
        .auth-input:focus { border-color:var(--color-ring); box-shadow:0 0 0 3px oklch(0.45 0.1 165 / .15); }
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

import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "admin" | "tenant";

export interface AuthState {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  loading: boolean;
}

export function useAuth(): AuthState {
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_evt, s) => {
      if (!mounted) return;
      setSession(s);
      if (s?.user) {
        // Defer the secondary fetch to avoid deadlock
        setTimeout(async () => {
          const { data } = await supabase
            .from("user_roles")
            .select("role")
            .eq("user_id", s.user.id)
            .order("role", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (mounted) setRole((data?.role as AppRole) ?? "tenant");
        }, 0);
      } else {
        setRole(null);
      }
    });

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (!mounted) return;
      setSession(s);
      setLoading(false);
      if (s?.user) {
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", s.user.id)
          .order("role", { ascending: true })
          .limit(1)
          .maybeSingle()
          .then(({ data }) => mounted && setRole((data?.role as AppRole) ?? "tenant"));
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return { user: session?.user ?? null, session, role, loading };
}

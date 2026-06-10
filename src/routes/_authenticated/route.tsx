import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppLayout } from "@/components/AppLayout";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw redirect({ to: "/auth" });
  },
  component: AuthenticatedShell,
});

function AuthenticatedShell() {
  const { role, user, loading } = useAuth();
  const [profileName, setProfileName] = useState<string>("");

  useEffect(() => {
    if (user?.id) {
      (supabase as any)
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle()
        .then(({ data }: any) => {
          if (data?.full_name) setProfileName(data.full_name);
        });
    }
  }, [user?.id]);

  if (loading || !role) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <AppLayout role={role} email={user?.email ?? undefined} displayName={profileName}>
      <Outlet />
    </AppLayout>
  );
}
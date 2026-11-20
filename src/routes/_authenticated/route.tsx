import { createFileRoute, Outlet, redirect, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { AppLayout } from "@/components/AppLayout";
import { TenantShell } from "@/components/TenantShell";
import { useState, useEffect } from "react";
import { AppShellSkeleton } from "@/components/PageSkeletons";

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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
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
      <AppShellSkeleton />
    );
  }

  // the owner console has its own layout
  if (pathname === "/owner" || pathname.startsWith("/owner/")) return <Outlet />;

  if (role === "tenant") {
    return (
      <TenantShell email={user?.email ?? undefined}>
        <Outlet />
      </TenantShell>
    );
  }

  return (
    <AppLayout role={role} email={user?.email ?? undefined} displayName={profileName}>
      <Outlet />
    </AppLayout>
  );
}
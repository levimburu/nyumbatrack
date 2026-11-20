import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShellSkeleton } from "@/components/PageSkeletons";

export const Route = createFileRoute("/")({
  ssr: false,
  component: IndexPage,
});

function IndexPage() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        navigate({ to: "/auth", replace: true });
        return;
      }

      try {
        const { data } = await (supabase as any)
          .from("user_roles")
          .select("role")
          .eq("user_id", session.user.id)
          .maybeSingle();

        if (data?.role === "admin") {
          navigate({ to: "/portfolio", replace: true });
        } else {
          navigate({ to: "/portal", replace: true });
        }
      } catch {
        navigate({ to: "/portfolio", replace: true });
      }
    });
  }, [navigate]);

  return <AppShellSkeleton />;
}
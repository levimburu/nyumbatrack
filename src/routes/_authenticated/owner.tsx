import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyAccess } from "@/hooks/useCompanyAccess";

export const Route = createFileRoute("/_authenticated/owner")({
  component: OwnerLayout,
});

const tab = "rounded-lg px-3 py-1.5 text-sm font-medium text-white/70 hover:text-white";
const tabActive = { className: "rounded-lg px-3 py-1.5 text-sm font-semibold bg-white/15 text-white" };

function OwnerLayout() {
  const navigate = useNavigate();
  const { data: access, isLoading } = useCompanyAccess();

  if (isLoading) return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading…</div>;
  if (!access?.isPlatformAdmin) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <p className="text-sm text-muted-foreground">This area is only for the NyumbaTrack owner.</p>
          <Link to="/portfolio" className="mt-3 inline-block text-sm font-semibold text-green-800">Go to my account</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "#F5F5F0" }}>
      <header style={{ background: "#0d2818" }}>
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-4">
            <div className="font-display text-lg font-bold text-white">NyumbaTrack <span style={{ color: "#F59E0B" }}>Owner</span></div>
            <nav className="flex gap-1">
              <Link to="/owner" activeOptions={{ exact: true }} activeProps={tabActive} className={tab}>Overview</Link>
              <Link to="/owner/companies" activeProps={tabActive} className={tab}>Companies</Link>
              <Link to="/owner/support" activeProps={tabActive} className={tab}>Support</Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Link to="/portfolio" className="text-white/70 hover:text-white">My landlord account</Link>
            <button
              onClick={async () => { await supabase.auth.signOut(); navigate({ to: "/auth", replace: true }); }}
              className="inline-flex items-center gap-1 text-white/70 hover:text-white"
            ><LogOut className="h-4 w-4" /> Sign out</button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4 sm:p-6"><Outlet /></main>
    </div>
  );
}

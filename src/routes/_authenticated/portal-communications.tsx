import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Wrench } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useMyTenant } from "@/hooks/use-my-tenant";

export const Route = createFileRoute("/_authenticated/portal-communications")({
  component: TenantCommunications,
});

function TenantCommunications() {
  const { tenant } = useMyTenant();
  const [reportTitle, setReportTitle] = useState("");
  const [reportDescription, setReportDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmitReport = async () => {
    if (!reportTitle.trim()) {
      toast.error("Please describe what's wrong");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await (supabase as any).rpc("submit_maintenance_request", {
        p_title: reportTitle.trim(),
        p_description: reportDescription.trim() || null,
      });
      if (error) throw error;
      toast.success("Reported! Your landlord or property manager has been notified.");
      setReportTitle("");
      setReportDescription("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't submit your request");
    } finally {
      setSubmitting(false);
    }
  };

  // TenantShell already gates on "no linked tenant" before rendering any
  // page, so by the time we're here tenant is guaranteed to exist.
  if (!tenant) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-foreground">Communications</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Report a maintenance issue directly to your property manager.</p>
      </div>

      <div className="card-surface p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-xl" style={{ background: "#DCFCE7" }}>
            <Wrench className="h-5 w-5" style={{ color: "#166534" }} />
          </div>
          <div>
            <h2 className="font-display font-bold text-foreground">Report a Maintenance Issue</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Goes straight to whoever manages your property.</p>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">What's wrong?</label>
          <input
            type="text" value={reportTitle} onChange={(e) => setReportTitle(e.target.value)}
            placeholder="e.g. Leaking tap in the kitchen"
            className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none transition-colors"
            style={{ borderColor: "#E5E7EB" }}
            onFocus={(e) => (e.target.style.borderColor = "#166534")}
            onBlur={(e) => (e.target.style.borderColor = "#E5E7EB")}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1.5">More details (optional)</label>
          <textarea
            value={reportDescription} onChange={(e) => setReportDescription(e.target.value)}
            rows={4} placeholder="Anything that would help — when it started, how bad it is, etc."
            className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none resize-none transition-colors"
            style={{ borderColor: "#E5E7EB" }}
            onFocus={(e) => (e.target.style.borderColor = "#166534")}
            onBlur={(e) => (e.target.style.borderColor = "#E5E7EB")}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          This goes straight to your property manager if one's assigned to this property, otherwise your landlord.
        </p>
        <button
          onClick={handleSubmitReport} disabled={submitting}
          className="w-full rounded-2xl py-3.5 text-sm font-bold text-white disabled:opacity-60 flex items-center justify-center gap-2 transition-transform active:scale-[0.98]"
          style={{ background: "linear-gradient(135deg, #166534 0%, #15803d 100%)", boxShadow: "0 8px 20px -6px rgba(22,101,52,0.4)" }}
        >
          {submitting ? "Submitting…" : "Submit Report"}
        </button>
      </div>
    </div>
  );
}
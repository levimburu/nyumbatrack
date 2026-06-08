import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  tone?: "default" | "gold" | "success" | "warning";
}

const toneMap = {
  default: "bg-primary/10 text-primary",
  gold: "bg-gold/20 text-gold-foreground",
  success: "bg-success/15 text-success",
  warning: "bg-warning/20 text-warning-foreground",
};

export function StatCard({ label, value, icon: Icon, hint, tone = "default" }: Props) {
  return (
    <div className="card-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
          <div className="mt-2 font-display text-2xl font-semibold tracking-tight text-foreground">{value}</div>
          {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
        </div>
        <div className={cn("grid h-10 w-10 place-items-center rounded-lg", toneMap[tone])}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

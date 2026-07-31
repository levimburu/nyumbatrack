import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export interface MyTenant {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  unit: string;
  rent_amount: number;
  deposit: number | null;
  due_day: number | null;
  balance: number;
  next_due_date: string | null;
  move_in_date: string | null;
  property_id: string;
  properties: { name: string; location: string | null; total_units: number | null; description: string | null } | null;
}

export interface MyPayment {
  id: string;
  amount: number;
  paid_on: string;
  method: string;
  reference: string | null;
  payment_month: string | null;
}

/** The tenant record linked to the currently signed-in account, plus their
 * full payment history — shared across every tenant-portal page so each one
 * doesn't repeat the same lookup queries. Payments are included here (not
 * just on the Payments tab) because the real amount owed can only be
 * calculated correctly against actual payment history — tenants.balance
 * itself is set once at signup and never kept in sync, so nothing should
 * read it directly for a "how much do they actually owe" figure. */
export function useMyTenant() {
  const { user } = useAuth();

  const tenantQuery = useQuery({
    queryKey: ["my-tenant", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("*, properties(name, location, total_units, description)")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as MyTenant | null;
    },
  });

  const paymentsQuery = useQuery({
    queryKey: ["my-payments", tenantQuery.data?.id],
    enabled: !!tenantQuery.data?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payments")
        .select("*")
        .eq("tenant_id", tenantQuery.data!.id)
        .order("paid_on", { ascending: false });
      if (error) throw error;
      return data as MyPayment[];
    },
  });

  const profileQuery = useQuery({
    queryKey: ["my-avatar", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("profiles")
        .select("avatar_url")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data?.avatar_url as string | null;
    },
  });

  return {
    tenant: tenantQuery.data ?? null,
    payments: paymentsQuery.data ?? [],
    avatarUrl: profileQuery.data ?? null,
    isLoading: tenantQuery.isLoading,
    refetchAvatar: profileQuery.refetch,
  };
}
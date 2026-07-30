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
  properties: { name: string; location: string | null } | null;
}

/** The tenant record linked to the currently signed-in account — shared
 * across every tenant-portal page so each one doesn't repeat the same
 * lookup query. */
export function useMyTenant() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["my-tenant", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tenants")
        .select("*, properties(name, location)")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data as MyTenant | null;
    },
  });
}

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const db = supabase as any;

export interface CompanyMembership {
  company_id: string;
  role: "senior_officer" | "property_manager";
  company: { id: string; name: string; kind: "company" | "individual" } | null;
}

export interface CompanyAccess {
  userId: string | null;
  isPlatformAdmin: boolean;
  memberships: CompanyMembership[];
  /** Companies (not individual landlords) where this user is a Senior Officer. */
  officerCompanies: { id: string; name: string }[];
}

export function useCompanyAccess() {
  return useQuery<CompanyAccess>({
    queryKey: ["company-access"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { userId: null, isPlatformAdmin: false, memberships: [], officerCompanies: [] };
      const [admin, members] = await Promise.all([
        db.rpc("is_platform_admin"),
        db.from("company_members").select("company_id, role, company:companies(id, name, kind)").eq("user_id", user.id),
      ]);
      const memberships = ((members.data ?? []) as CompanyMembership[]);
      return {
        userId: user.id,
        isPlatformAdmin: admin.data === true,
        memberships,
        officerCompanies: memberships
          .filter((m) => m.role === "senior_officer" && m.company?.kind === "company")
          .map((m) => ({ id: m.company_id, name: m.company!.name })),
      };
    },
  });
}

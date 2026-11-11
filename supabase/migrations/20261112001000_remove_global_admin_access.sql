-- "admin" in user_roles only means "staff account, not a tenant". It must never grant access to other people's data.

drop policy if exists "Admin manage tenants" on public.tenants;
drop policy if exists "Admin manage payments" on public.payments;

create or replace function public.can_read_profile(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select _uid = auth.uid()
    or public.is_platform_admin()
    or exists (select 1 from company_members a join company_members b on a.company_id = b.company_id
               where a.user_id = auth.uid() and b.user_id = _uid)
    or exists (select 1 from agent_landlord al
               where (al.agent_id = auth.uid() and al.landlord_id = _uid)
                  or (al.landlord_id = auth.uid() and al.agent_id = _uid))
    or exists (select 1 from properties p where p.user_id = _uid and public.can_view_property(p.id))
    or exists (select 1 from tenants t join properties p on p.id = t.property_id
               where t.user_id = _uid and public.can_view_property(p.id));
$$;

drop policy if exists "Own profile read" on public.profiles;
create policy "Own profile read" on public.profiles for select to authenticated
  using (auth.uid() = id or public.can_read_profile(id));

drop policy if exists "Own profile update" on public.profiles;

drop policy if exists "Read own roles" on public.user_roles;
create policy "Read own roles" on public.user_roles for select to authenticated
  using (user_id = auth.uid());

create or replace function public.prevent_self_role_change()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_platform_admin() then
    raise exception 'Account role cannot be changed directly.';
  end if;
  return new;
end;
$function$;

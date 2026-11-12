-- 1) A suspended company loses access even through the old "own row" rules.
create or replace function public.property_visible_unsuspended(_pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from properties p where p.id = _pid and p.company_id is not null and not public.company_active(p.company_id));
$$;

drop policy if exists suspended_block on public.properties;
create policy suspended_block on public.properties as restrictive for all to authenticated
  using (company_id is null or public.company_active(company_id) or public.is_tenant_of_property(id))
  with check (company_id is null or public.company_active(company_id));

drop policy if exists suspended_block on public.units;
create policy suspended_block on public.units as restrictive for all to authenticated
  using (public.property_visible_unsuspended(property_id))
  with check (public.property_visible_unsuspended(property_id));

drop policy if exists suspended_block on public.tenants;
create policy suspended_block on public.tenants as restrictive for all to authenticated
  using (user_id = auth.uid() or public.property_visible_unsuspended(property_id))
  with check (public.property_visible_unsuspended(property_id));

drop policy if exists suspended_block on public.payments;
create policy suspended_block on public.payments as restrictive for all to authenticated
  using (
    exists (select 1 from tenants t where t.id = payments.tenant_id and (t.user_id = auth.uid() or public.property_visible_unsuspended(t.property_id)))
  )
  with check (
    exists (select 1 from tenants t where t.id = payments.tenant_id and public.property_visible_unsuspended(t.property_id))
  );

-- 2) Invite codes are no longer readable by everyone; sign-up checks a code through this function.
create or replace function public.check_invite_code(_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(x) from (
    select code_type, intended_email from invite_codes
    where code = upper(trim(_code)) and coalesce(used, false) = false limit 1
  ) x;
$$;
grant execute on function public.check_invite_code(text) to anon, authenticated;
drop policy if exists "Anyone can read invite codes for validation" on public.invite_codes;

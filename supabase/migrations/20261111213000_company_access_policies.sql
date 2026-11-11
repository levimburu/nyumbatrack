-- Phase 1b: let company staff reach their properties' data (additive policies, safe to re-run)

create or replace function public.can_view_tenant(_tid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tenants t where t.id = _tid and public.can_view_property(t.property_id));
$$;

-- properties: staff can read what they can view; only Senior Officers add/edit/delete
drop policy if exists company_access_select on public.properties;
create policy company_access_select on public.properties for select to authenticated
  using (public.can_view_property(id));
drop policy if exists company_access_insert on public.properties;
create policy company_access_insert on public.properties for insert to authenticated
  with check (company_id is not null and public.is_senior_officer(company_id));
drop policy if exists company_access_update on public.properties;
create policy company_access_update on public.properties for update to authenticated
  using (company_id is not null and public.is_senior_officer(company_id))
  with check (company_id is not null and public.is_senior_officer(company_id));
drop policy if exists company_access_delete on public.properties;
create policy company_access_delete on public.properties for delete to authenticated
  using (company_id is not null and public.is_senior_officer(company_id));

-- every other table with property_id or tenant_id
do $$
declare r record;
begin
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.column_name in ('property_id','tenant_id')
      and c.table_name not in ('property_assignments','properties','agent_landlord','invite_codes')
  loop
    execute format('drop policy if exists company_access on public.%I', r.table_name);
    if r.column_name = 'property_id' then
      execute format('create policy company_access on public.%I for all to authenticated using (public.can_view_property(property_id)) with check (public.can_view_property(property_id))', r.table_name);
    else
      execute format('create policy company_access on public.%I for all to authenticated using (public.can_view_tenant(tenant_id)) with check (public.can_view_tenant(tenant_id))', r.table_name);
    end if;
    raise notice 'policy added on % (%)', r.table_name, r.column_name;
  end loop;
end $$;

-- check: companies, members, properties with a company
select (select count(*) from companies) as companies,
       (select count(*) from company_members) as members,
       (select count(*) from properties where company_id is not null) as properties_linked,
       (select count(*) from properties where company_id is null) as properties_unlinked;

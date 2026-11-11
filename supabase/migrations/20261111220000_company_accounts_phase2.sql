-- Phase 2: company creation, invite codes, staff

-- 1. invite_codes: columns the app already expects (intended_email) + company fields
alter table public.invite_codes
  add column if not exists intended_email text,
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists company_role text check (company_role in ('senior_officer','property_manager'));

-- 2. Platform admin (you). Only these users can create companies.
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.platform_admins enable row level security;

insert into public.platform_admins (user_id)
select id from public.profiles where email = 'leviweru9@gmail.com'
on conflict do nothing;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create or replace function public.is_member_of_company(_cid uuid, _uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from company_members where company_id = _cid and user_id = _uid);
$$;

-- platform admin can see every company and its members
drop policy if exists companies_platform_select on public.companies;
create policy companies_platform_select on public.companies for select to authenticated
  using (public.is_platform_admin());
drop policy if exists company_members_platform_select on public.company_members;
create policy company_members_platform_select on public.company_members for select to authenticated
  using (public.is_platform_admin());

-- staff can only be assigned to properties if they belong to that property's company
drop policy if exists assignments_insert on public.property_assignments;
create policy assignments_insert on public.property_assignments for insert to authenticated
  with check (
    public.is_senior_officer(public.property_company(property_id))
    and public.is_member_of_company(public.property_company(property_id), user_id)
  );

-- 3. Create a company (platform admin only)
create or replace function public.create_company(_name text, _registration_no text default null, _earb_no text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  if coalesce(trim(_name),'') = '' then raise exception 'Company name is required'; end if;
  insert into companies (name, kind, registration_no, earb_no, created_by)
  values (trim(_name), 'company', nullif(trim(_registration_no),''), nullif(trim(_earb_no),''), auth.uid())
  returning id into cid;
  return cid;
end $$;

-- 4. Create an invite code for a company (platform admin, or that company's Senior Officer)
create or replace function public.create_company_invite(_company uuid, _role text, _email text default null)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not (public.is_platform_admin() or public.is_senior_officer(_company)) then
    raise exception 'Not allowed';
  end if;
  if _role not in ('senior_officer','property_manager') then raise exception 'Invalid role'; end if;
  c := 'CO-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
  insert into invite_codes (code, code_type, company_id, company_role, intended_email, landlord_id)
  values (c, case when _role = 'senior_officer' then 'company_senior_officer' else 'company_staff' end,
          _company, _role, nullif(lower(trim(_email)),''), auth.uid());
  return c;
end $$;

-- 5. Unused company invites for a company (so a Senior Officer can see pending codes)
create or replace function public.company_pending_invites(_company uuid)
returns table (code text, company_role text, intended_email text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select i.code, i.company_role, i.intended_email, i.created_at
  from invite_codes i
  where i.company_id = _company and coalesce(i.used,false) = false
    and (public.is_platform_admin() or public.is_senior_officer(_company))
  order by i.created_at desc;
$$;

-- 6. Sign-up trigger: same as before, plus company codes and email-locked codes
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  supplied_code text := new.raw_user_meta_data->>'invite_code';
  code_row invite_codes;
  resolved_role text := 'tenant';
  is_company boolean := false;
begin
  if supplied_code is not null and supplied_code <> '' then
    select * into code_row from invite_codes where code = supplied_code and used = false for update;
    if code_row.id is null then
      raise exception 'Invalid or already-used invite code.';
    end if;
    if code_row.intended_email is not null and lower(code_row.intended_email) <> lower(new.email) then
      raise exception 'This invite code was issued for a different email address.';
    end if;

    update invite_codes set used = true, used_by = new.id where id = code_row.id;

    if code_row.code_type in ('company_senior_officer','company_staff') then
      is_company := true;
      resolved_role := case when code_row.code_type = 'company_staff' then 'agent' else 'landlord' end;
      insert into company_members (company_id, user_id, role)
      values (code_row.company_id, new.id, code_row.company_role)
      on conflict do nothing;
    else
      resolved_role := case when code_row.code_type = 'agent_invite' then 'agent' else 'landlord' end;
      if code_row.code_type = 'agent_invite' then
        insert into agent_landlord (agent_id, landlord_id, property_id)
        values (new.id, code_row.landlord_id, code_row.property_id);
      end if;
    end if;
  end if;

  insert into public.profiles (id, full_name, email, role)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.email, resolved_role)
  on conflict (id) do nothing;

  if is_company then
    insert into public.user_roles (user_id, role) values (new.id, 'admin') on conflict do nothing;
  else
    insert into public.user_roles (user_id, role) values (new.id, 'tenant') on conflict do nothing;
  end if;

  return new;
end;
$function$;

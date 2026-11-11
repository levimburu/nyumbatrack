-- Owner console: suspend companies, billing, usage numbers, support tools, owner activity log.
-- Nothing here returns landlord ID / KRA / payout / title / documents, or tenant and payment rows.

alter table public.companies
  add column if not exists status text not null default 'active' check (status in ('active','suspended')),
  add column if not exists plan text,
  add column if not exists price_kes numeric,
  add column if not exists paid_until date,
  add column if not exists billing_notes text;

create table if not exists public.owner_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  action text not null,
  company_id uuid,
  detail text,
  created_at timestamptz not null default now()
);
alter table public.owner_actions enable row level security;
drop policy if exists owner_actions_select on public.owner_actions;
create policy owner_actions_select on public.owner_actions for select to authenticated
  using (public.is_platform_admin());

-- ---------- suspended companies lose access everywhere ----------
create or replace function public.company_active(_cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from companies where id = _cid and status = 'active');
$$;

create or replace function public.is_company_member_raw(_cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from company_members where company_id = _cid and user_id = auth.uid());
$$;

create or replace function public.is_company_member(_cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from company_members where company_id = _cid and user_id = auth.uid())
     and public.company_active(_cid);
$$;

create or replace function public.is_senior_officer(_cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from company_members
                 where company_id = _cid and user_id = auth.uid() and role = 'senior_officer')
     and public.company_active(_cid);
$$;

create or replace function public.can_view_property(_pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from properties p
    where p.id = _pid
      and (p.company_id is null or public.company_active(p.company_id))
      and (
        p.user_id = auth.uid()
        or (p.company_id is not null and public.is_senior_officer(p.company_id))
        or exists (select 1 from property_assignments pa where pa.property_id = p.id and pa.user_id = auth.uid())
        or exists (select 1 from agent_landlord a where a.agent_id = auth.uid() and a.landlord_id = p.user_id)
      )
  );
$$;

-- members must still be able to read their own company row (to see "suspended")
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
  using (public.is_company_member_raw(id));

-- ---------- owner functions ----------
create or replace function public.owner_company_stats()
returns table (
  id uuid, name text, kind text, status text, created_at timestamptz,
  plan text, price_kes numeric, paid_until date, billing_notes text,
  members int, properties int, units int, tenants int,
  last_active timestamptz, officer_email text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  return query
  select c.id, c.name, c.kind, c.status, c.created_at, c.plan, c.price_kes, c.paid_until, c.billing_notes,
    (select count(*) from company_members m where m.company_id = c.id)::int,
    (select count(*) from properties p where p.company_id = c.id)::int,
    (select count(*) from units u join properties p on p.id = u.property_id where p.company_id = c.id)::int,
    (select count(*) from tenants t join properties p on p.id = t.property_id where p.company_id = c.id)::int,
    (select max(au.last_sign_in_at) from company_members m join auth.users au on au.id = m.user_id where m.company_id = c.id),
    (select au.email::text from company_members m join auth.users au on au.id = m.user_id
       where m.company_id = c.id and m.role = 'senior_officer' order by m.created_at limit 1)
  from companies c order by c.created_at desc;
end $$;

create or replace function public.owner_totals()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'companies', (select count(*) from companies where kind = 'company'),
    'individuals', (select count(*) from companies where kind = 'individual'),
    'staff_users', (select count(*) from profiles where role <> 'tenant'),
    'tenant_users', (select count(*) from profiles where role = 'tenant'),
    'properties', (select count(*) from properties),
    'units', (select count(*) from units),
    'tenant_records', (select count(*) from tenants)
  );
end $$;

create or replace function public.owner_set_company_status(_company uuid, _status text)
returns void language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  if _status not in ('active','suspended') then raise exception 'Invalid status'; end if;
  update companies set status = _status where id = _company returning name into nm;
  if nm is null then raise exception 'Company not found'; end if;
  insert into owner_actions (user_id, action, company_id, detail) values (auth.uid(), _status, _company, nm);
end $$;

create or replace function public.owner_update_billing(_company uuid, _plan text, _price numeric, _paid_until date, _notes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  update companies set plan = nullif(trim(_plan), ''), price_kes = _price, paid_until = _paid_until,
    billing_notes = nullif(trim(_notes), '') where id = _company;
  insert into owner_actions (user_id, action, company_id, detail)
  values (auth.uid(), 'billing_updated', _company, concat_ws(' · ', nullif(trim(_plan), ''), 'paid until ' || coalesce(_paid_until::text, '—')));
end $$;

create or replace function public.owner_find_user(_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u record; res jsonb;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  insert into owner_actions (user_id, action, detail) values (auth.uid(), 'search_user', lower(trim(_email)));
  select au.id, au.email::text as email, au.created_at, au.last_sign_in_at, au.email_confirmed_at, p.full_name, p.role
    into u from auth.users au left join profiles p on p.id = au.id
    where lower(au.email) = lower(trim(_email));
  res := jsonb_build_object(
    'user', case when u.id is null then null else jsonb_build_object(
      'email', u.email, 'full_name', u.full_name, 'role', u.role, 'created_at', u.created_at,
      'last_sign_in_at', u.last_sign_in_at, 'email_confirmed', u.email_confirmed_at is not null) end,
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('company', c.name, 'role', m.role, 'status', c.status))
      from company_members m join companies c on c.id = m.company_id where m.user_id = u.id), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('code', i.code, 'type', i.code_type, 'used', coalesce(i.used, false),
        'company', (select name from companies where id = i.company_id), 'created_at', i.created_at) order by i.created_at desc)
      from invite_codes i where lower(i.intended_email) = lower(trim(_email))), '[]'::jsonb)
  );
  return res;
end $$;

create or replace function public.owner_pending_invites()
returns table (code text, code_type text, company_name text, intended_email text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  return query
  select i.code, i.code_type, c.name, i.intended_email, i.created_at
  from invite_codes i left join companies c on c.id = i.company_id
  where coalesce(i.used, false) = false and i.code_type in ('company_senior_officer','company_staff')
  order by i.created_at desc;
end $$;

create or replace function public.owner_revoke_invite(_code text)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid; n int;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  delete from invite_codes where code = _code and coalesce(used, false) = false
    and code_type in ('company_senior_officer','company_staff') returning company_id into cid;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Code not found or already used'; end if;
  insert into owner_actions (user_id, action, company_id, detail) values (auth.uid(), 'revoke_invite', cid, _code);
end $$;

create or replace function public.owner_recent_actions(_limit int default 30)
returns table (created_at timestamptz, action text, company_name text, detail text, who text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  return query
  select a.created_at, a.action, c.name, a.detail, p.email::text
  from owner_actions a left join companies c on c.id = a.company_id left join profiles p on p.id = a.user_id
  order by a.created_at desc limit least(coalesce(_limit, 30), 200);
end $$;

-- log creating companies and invites too
create or replace function public.create_company(_name text, _registration_no text default null, _earb_no text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  if coalesce(trim(_name),'') = '' then raise exception 'Company name is required'; end if;
  insert into companies (name, kind, registration_no, earb_no, created_by)
  values (trim(_name), 'company', nullif(trim(_registration_no),''), nullif(trim(_earb_no),''), auth.uid())
  returning id into cid;
  insert into owner_actions (user_id, action, company_id, detail) values (auth.uid(), 'create_company', cid, trim(_name));
  return cid;
end $$;

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
  if public.is_platform_admin() then
    insert into owner_actions (user_id, action, company_id, detail) values (auth.uid(), 'create_invite', _company, _role || ' ' || c);
  end if;
  return c;
end $$;

grant execute on function public.owner_company_stats() to authenticated;
grant execute on function public.owner_totals() to authenticated;
grant execute on function public.owner_set_company_status(uuid, text) to authenticated;
grant execute on function public.owner_update_billing(uuid, text, numeric, date, text) to authenticated;
grant execute on function public.owner_find_user(text) to authenticated;
grant execute on function public.owner_pending_invites() to authenticated;
grant execute on function public.owner_revoke_invite(text) to authenticated;
grant execute on function public.owner_recent_actions(int) to authenticated;

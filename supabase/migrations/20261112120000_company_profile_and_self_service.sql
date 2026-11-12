-- Company profile details, self-service role changes, last-Senior-Officer guard,
-- invite cancelling by the company, EARB licence expiry reminders.
alter table public.companies
  add column if not exists trading_name text,
  add column if not exists registered_on date,
  add column if not exists kra_pin text,
  add column if not exists earb_expiry date,
  add column if not exists address text,
  add column if not exists town text,
  add column if not exists county text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists contact_name text,
  add column if not exists contact_phone text,
  add column if not exists contact_email text,
  add column if not exists billing_contact text,
  add column if not exists agreement_signed_on date,
  add column if not exists expected_properties int,
  add column if not exists expected_units int,
  add column if not exists odpc_reg_no text;

create or replace function public._apply_company_profile(_company uuid, _d jsonb, _owner boolean)
returns void language plpgsql security definer set search_path = public as $$
declare pin text; em text;
begin
  if _d ? 'kra_pin' and nullif(trim(_d->>'kra_pin'),'') is not null then
    pin := upper(trim(_d->>'kra_pin'));
    if pin !~ '^[AP][0-9]{9}[A-Z]$' then raise exception 'KRA PIN looks wrong. It should be like A123456789B.'; end if;
  end if;
  foreach em in array array[coalesce(_d->>'email',''), coalesce(_d->>'contact_email','')] loop
    if trim(em) <> '' and trim(em) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'An email address looks wrong.'; end if;
  end loop;

  update companies c set
    trading_name = case when _d ? 'trading_name' then nullif(trim(_d->>'trading_name'),'') else c.trading_name end,
    address = case when _d ? 'address' then nullif(trim(_d->>'address'),'') else c.address end,
    town = case when _d ? 'town' then nullif(trim(_d->>'town'),'') else c.town end,
    county = case when _d ? 'county' then nullif(trim(_d->>'county'),'') else c.county end,
    phone = case when _d ? 'phone' then nullif(trim(_d->>'phone'),'') else c.phone end,
    email = case when _d ? 'email' then nullif(lower(trim(_d->>'email')),'') else c.email end,
    contact_name = case when _d ? 'contact_name' then nullif(trim(_d->>'contact_name'),'') else c.contact_name end,
    contact_phone = case when _d ? 'contact_phone' then nullif(trim(_d->>'contact_phone'),'') else c.contact_phone end,
    contact_email = case when _d ? 'contact_email' then nullif(lower(trim(_d->>'contact_email')),'') else c.contact_email end,
    billing_contact = case when _d ? 'billing_contact' then nullif(trim(_d->>'billing_contact'),'') else c.billing_contact end,
    earb_no = case when _d ? 'earb_no' then nullif(trim(_d->>'earb_no'),'') else c.earb_no end,
    earb_expiry = case when _d ? 'earb_expiry' then nullif(trim(_d->>'earb_expiry'),'')::date else c.earb_expiry end,
    expected_properties = case when _d ? 'expected_properties' then nullif(trim(_d->>'expected_properties'),'')::int else c.expected_properties end,
    expected_units = case when _d ? 'expected_units' then nullif(trim(_d->>'expected_units'),'')::int else c.expected_units end,
    odpc_reg_no = case when _d ? 'odpc_reg_no' then nullif(trim(_d->>'odpc_reg_no'),'') else c.odpc_reg_no end,
    name = case when _owner and _d ? 'name' and nullif(trim(_d->>'name'),'') is not null then trim(_d->>'name') else c.name end,
    registration_no = case when _owner and _d ? 'registration_no' then nullif(trim(_d->>'registration_no'),'') else c.registration_no end,
    registered_on = case when _owner and _d ? 'registered_on' then nullif(trim(_d->>'registered_on'),'')::date else c.registered_on end,
    kra_pin = case when _owner and _d ? 'kra_pin' then nullif(upper(trim(_d->>'kra_pin')),'') else c.kra_pin end,
    agreement_signed_on = case when _owner and _d ? 'agreement_signed_on' then nullif(trim(_d->>'agreement_signed_on'),'')::date else c.agreement_signed_on end
  where c.id = _company;
end $$;
revoke all on function public._apply_company_profile(uuid, jsonb, boolean) from public, anon, authenticated;

create or replace function public.create_company_full(_d jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; f text;
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  foreach f in array array['name','registration_no','kra_pin','phone','email','contact_name','contact_phone'] loop
    if coalesce(trim(_d->>f),'') = '' then raise exception 'Missing required detail: %', replace(f,'_',' '); end if;
  end loop;
  insert into companies (name, kind, created_by) values (trim(_d->>'name'), 'company', auth.uid()) returning id into cid;
  perform public._apply_company_profile(cid, _d, true);
  insert into owner_actions (user_id, action, company_id, detail) values (auth.uid(), 'create_company', cid, trim(_d->>'name'));
  return cid;
end $$;

create or replace function public.owner_company_profile(_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  return (select to_jsonb(x) from (select name, trading_name, registration_no, registered_on, kra_pin, earb_no, earb_expiry,
    address, town, county, phone, email, contact_name, contact_phone, contact_email, billing_contact,
    agreement_signed_on, expected_properties, expected_units, odpc_reg_no from companies where id = _company) x);
end $$;

create or replace function public.owner_update_company_profile(_company uuid, _d jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then raise exception 'Not allowed'; end if;
  perform public._apply_company_profile(_company, _d, true);
  insert into owner_actions (user_id, action, company_id, detail) values (auth.uid(), 'profile_updated', _company, null);
end $$;

create or replace function public.update_company_profile(_company uuid, _d jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_senior_officer(_company) then raise exception 'Only a Senior Officer can change company details'; end if;
  perform public._apply_company_profile(_company, _d, false);
end $$;

create or replace function public.set_member_role(_company uuid, _user uuid, _role text)
returns void language plpgsql security definer set search_path = public as $$
declare cur text; officers int;
begin
  if not public.is_senior_officer(_company) then raise exception 'Only a Senior Officer can change roles'; end if;
  if _role not in ('senior_officer','property_manager') then raise exception 'Invalid role'; end if;
  select role into cur from company_members where company_id = _company and user_id = _user;
  if cur is null then raise exception 'That person is not in this company'; end if;
  if cur = _role then return; end if;
  if cur = 'senior_officer' then
    select count(*) into officers from company_members where company_id = _company and role = 'senior_officer';
    if officers <= 1 then raise exception 'A company must keep at least one Senior Officer'; end if;
  end if;
  update company_members set role = _role where company_id = _company and user_id = _user;
  if _role = 'senior_officer' then
    delete from property_assignments where user_id = _user and property_id in (select id from properties where company_id = _company);
  end if;
end $$;

create or replace function public.guard_last_senior_officer()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_platform_admin() then return coalesce(new, old); end if;
  if old.role = 'senior_officer' and (tg_op = 'DELETE' or new.role <> 'senior_officer')
     and exists (select 1 from companies where id = old.company_id)
     and not exists (select 1 from company_members m where m.company_id = old.company_id and m.role = 'senior_officer' and m.user_id <> old.user_id) then
    raise exception 'A company must keep at least one Senior Officer';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists guard_last_senior_officer on public.company_members;
create trigger guard_last_senior_officer before update or delete on public.company_members
  for each row execute function public.guard_last_senior_officer();

create or replace function public.revoke_company_invite(_code text)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select company_id into cid from invite_codes where code = _code and coalesce(used,false) = false
    and code_type in ('company_senior_officer','company_staff');
  if cid is null then raise exception 'Code not found or already used'; end if;
  if not (public.is_senior_officer(cid) or public.is_platform_admin()) then raise exception 'Not allowed'; end if;
  delete from invite_codes where code = _code;
end $$;

create table if not exists public.company_reminders_sent (
  company_id uuid not null references public.companies(id) on delete cascade,
  expiry_date date not null,
  stage text not null,
  primary key (company_id, expiry_date, stage)
);
alter table public.company_reminders_sent enable row level security;

create or replace function public.run_company_licence_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare r record; today date := (now() at time zone 'Africa/Nairobi')::date; days int; stg text; uid uuid; n int := 0; msg text;
begin
  for r in select id, name, earb_expiry from companies where kind = 'company' and status = 'active' and earb_expiry is not null loop
    days := r.earb_expiry - today;
    stg := case when days < 0 then 'expired' when days <= 1 then 'd1' when days <= 7 then 'd7' when days <= 30 then 'd30' else null end;
    continue when stg is null or (stg = 'expired' and days < -30);
    continue when exists (select 1 from company_reminders_sent s where s.company_id = r.id and s.expiry_date = r.earb_expiry and s.stage = stg);
    insert into company_reminders_sent values (r.id, r.earb_expiry, stg);
    msg := 'The EARB licence for ' || r.name || case when days < 0 then ' expired on ' else ' expires on ' end || to_char(r.earb_expiry,'DD Mon YYYY') || '.';
    for uid in select user_id from company_members where company_id = r.id and role = 'senior_officer' loop
      perform create_notification(uid, case when days < 0 then 'EARB Licence Expired' else 'EARB Licence Expiring' end, msg, case when stg in ('expired','d1') then 'overdue' else 'info' end);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.run_company_licence_reminders() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'company-licence-reminders';
select cron.schedule('company-licence-reminders', '5 3 * * *', 'select public.run_company_licence_reminders()');

grant execute on function public.create_company_full(jsonb) to authenticated;
grant execute on function public.owner_company_profile(uuid) to authenticated;
grant execute on function public.owner_update_company_profile(uuid, jsonb) to authenticated;
grant execute on function public.update_company_profile(uuid, jsonb) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.revoke_company_invite(text) to authenticated;

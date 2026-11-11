-- Phase 3 + 4: landlords, ownership proof, caretakers, encrypted sensitive details,
-- access requests (12-hour approvals) and the audit log.

-- ---------- encryption key (Supabase Vault) and helpers ----------
create extension if not exists pgcrypto with schema extensions;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'landlord_data_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'landlord_data_key', 'Encrypts landlord sensitive data');
  end if;
end $$;

create or replace function public.data_key() returns text language sql stable security definer
set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'landlord_data_key';
$$;

create or replace function public.app_encrypt(_t text) returns bytea language sql security definer
set search_path = public, extensions as $$
  select case when _t is null or _t = '' then null else extensions.pgp_sym_encrypt(_t, public.data_key()) end;
$$;

create or replace function public.app_decrypt(_b bytea) returns text language sql security definer
set search_path = public, extensions as $$
  select case when _b is null then null else extensions.pgp_sym_decrypt(_b, public.data_key()) end;
$$;

revoke all on function public.data_key() from public, anon, authenticated;
revoke all on function public.app_encrypt(text) from public, anon, authenticated;
revoke all on function public.app_decrypt(bytea) from public, anon, authenticated;

-- ---------- tables ----------
create table if not exists public.landlords (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  full_name text not null,
  phone text,
  email text,
  consent_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- encrypted; no policies at all, so the app can never read it directly
create table if not exists public.landlord_sensitive (
  landlord_id uuid primary key references public.landlords(id) on delete cascade,
  id_number_enc bytea, id_last4 text, kra_pin_enc bytea, payout_enc bytea,
  updated_at timestamptz not null default now()
);

create table if not exists public.property_owners (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  landlord_id uuid not null references public.landlords(id) on delete restrict,
  ownership_type text not null check (ownership_type in ('sole','joint','company','trust','other')),
  share_percent numeric not null default 100 check (share_percent > 0 and share_percent <= 100),
  agreement_start date not null,
  agreement_end date,
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (property_id, landlord_id)
);

create table if not exists public.property_owner_sensitive (
  property_owner_id uuid primary key references public.property_owners(id) on delete cascade,
  title_enc bytea not null,
  document_path text not null
);

create table if not exists public.caretakers (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  full_name text not null,
  phone text not null,
  start_date date,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  landlord_id uuid not null references public.landlords(id) on delete cascade,
  requested_by uuid not null,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','denied')),
  decided_by uuid,
  decided_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.access_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  landlord_id uuid,
  landlord_name text,
  user_id uuid not null,
  field text not null,
  via text not null check (via in ('senior_officer','approval')),
  accessed_at timestamptz not null default now()
);

create index if not exists landlords_company_idx on public.landlords(company_id);
create index if not exists property_owners_property_idx on public.property_owners(property_id);
create index if not exists property_owners_landlord_idx on public.property_owners(landlord_id);
create index if not exists caretakers_property_idx on public.caretakers(property_id);
create index if not exists access_requests_company_idx on public.access_requests(company_id, status);
create index if not exists access_log_company_idx on public.access_log(company_id, accessed_at desc);

alter table public.landlords enable row level security;
alter table public.landlord_sensitive enable row level security;
alter table public.property_owners enable row level security;
alter table public.property_owner_sensitive enable row level security;
alter table public.caretakers enable row level security;
alter table public.access_requests enable row level security;
alter table public.access_log enable row level security;

-- ---------- helper checks ----------
create or replace function public.can_view_landlord(_lid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from landlords l where l.id = _lid and (
      public.is_senior_officer(l.company_id)
      or exists (select 1 from property_owners po
                 where po.landlord_id = l.id and public.can_view_property(po.property_id))
    )
  );
$$;

-- Senior Officer of the landlord's company, or holder of an approval that has not expired
create or replace function public.can_reveal(_lid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from landlords l where l.id = _lid and public.is_senior_officer(l.company_id))
      or exists (select 1 from access_requests r
                 where r.landlord_id = _lid and r.requested_by = auth.uid()
                   and r.status = 'approved' and r.expires_at > now()
                   and public.can_view_landlord(_lid));
$$;

-- ---------- policies ----------
drop policy if exists landlords_select on public.landlords;
create policy landlords_select on public.landlords for select to authenticated using (public.can_view_landlord(id));
drop policy if exists landlords_update on public.landlords;
create policy landlords_update on public.landlords for update to authenticated
  using (public.is_senior_officer(company_id)) with check (public.is_senior_officer(company_id));
drop policy if exists landlords_delete on public.landlords;
create policy landlords_delete on public.landlords for delete to authenticated using (public.is_senior_officer(company_id));

drop policy if exists owners_select on public.property_owners;
create policy owners_select on public.property_owners for select to authenticated using (public.can_view_property(property_id));
drop policy if exists owners_update on public.property_owners;
create policy owners_update on public.property_owners for update to authenticated
  using (public.is_senior_officer(public.property_company(property_id)))
  with check (public.is_senior_officer(public.property_company(property_id)));

drop policy if exists caretakers_select on public.caretakers;
create policy caretakers_select on public.caretakers for select to authenticated using (public.can_view_property(property_id));
drop policy if exists caretakers_insert on public.caretakers;
create policy caretakers_insert on public.caretakers for insert to authenticated
  with check (public.is_senior_officer(public.property_company(property_id)));
drop policy if exists caretakers_update on public.caretakers;
create policy caretakers_update on public.caretakers for update to authenticated
  using (public.is_senior_officer(public.property_company(property_id)))
  with check (public.is_senior_officer(public.property_company(property_id)));
drop policy if exists caretakers_delete on public.caretakers;
create policy caretakers_delete on public.caretakers for delete to authenticated
  using (public.is_senior_officer(public.property_company(property_id)));

drop policy if exists requests_select on public.access_requests;
create policy requests_select on public.access_requests for select to authenticated
  using (requested_by = auth.uid() or public.is_senior_officer(company_id));

drop policy if exists log_select on public.access_log;
create policy log_select on public.access_log for select to authenticated using (public.is_senior_officer(company_id));

-- private bucket for ownership documents; first folder = company id; Senior Officers only
insert into storage.buckets (id, name, public) values ('ownership-docs', 'ownership-docs', false) on conflict (id) do nothing;
drop policy if exists ownership_docs_select on storage.objects;
create policy ownership_docs_select on storage.objects for select to authenticated
  using (bucket_id = 'ownership-docs' and public.is_senior_officer(((storage.foldername(name))[1])::uuid));
drop policy if exists ownership_docs_insert on storage.objects;
create policy ownership_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'ownership-docs' and public.is_senior_officer(((storage.foldername(name))[1])::uuid));
drop policy if exists ownership_docs_delete on storage.objects;
create policy ownership_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'ownership-docs' and public.is_senior_officer(((storage.foldername(name))[1])::uuid));

-- properties: individuals join their company-of-one automatically; nobody else can
-- put a property into a company except a Senior Officer of it (via register_property)
create or replace function public.set_property_company() returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.company_id is null then
      select id into new.company_id from companies where legacy_landlord_id = new.user_id;
    elsif auth.uid() is not null
      and not public.is_senior_officer(new.company_id)
      and not exists (select 1 from companies c where c.id = new.company_id and c.legacy_landlord_id = auth.uid()) then
      raise exception 'Only a Senior Officer can add a property to this company';
    end if;
  elsif new.company_id is distinct from old.company_id and auth.uid() is not null then
    raise exception 'A property cannot be moved to another company';
  end if;
  return new;
end $$;
drop trigger if exists properties_set_company on public.properties;
create trigger properties_set_company before insert or update on public.properties
  for each row execute function public.set_property_company();

-- ---------- writing sensitive details ----------
create or replace function public._store_landlord_sensitive(_lid uuid, _id text, _kra text, _payout text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into landlord_sensitive (landlord_id) values (_lid) on conflict do nothing;
  if _id is not null then
    update landlord_sensitive set id_number_enc = app_encrypt(trim(_id)),
      id_last4 = case when trim(_id) = '' then null else right(trim(_id), 4) end, updated_at = now()
    where landlord_id = _lid;
  end if;
  if _kra is not null then
    update landlord_sensitive set kra_pin_enc = app_encrypt(upper(trim(_kra))), updated_at = now() where landlord_id = _lid;
  end if;
  if _payout is not null then
    update landlord_sensitive set payout_enc = app_encrypt(trim(_payout)), updated_at = now() where landlord_id = _lid;
  end if;
end $$;
revoke all on function public._store_landlord_sensitive(uuid, text, text, text) from public, anon, authenticated;

-- null = leave unchanged, '' = clear
create or replace function public.set_landlord_sensitive(_lid uuid, _id text, _kra text, _payout text)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select company_id into cid from landlords where id = _lid;
  if cid is null or not public.is_senior_officer(cid) then raise exception 'Not allowed'; end if;
  perform public._store_landlord_sensitive(_lid, _id, _kra, _payout);
end $$;

-- ---------- registering a property (atomic) ----------
create or replace function public.register_property(
  _company uuid, _prop jsonb, _landlord_id uuid, _new_landlord jsonb, _owner jsonb, _caretaker jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  lid uuid; pid uuid; poid uuid; cols text;
  v jsonb := coalesce(_prop, '{}'::jsonb) - 'id' - 'user_id' - 'company_id' - 'created_at';
begin
  if not public.is_senior_officer(_company) then raise exception 'Only a Senior Officer can register a property'; end if;
  if coalesce(trim(v->>'name'), '') = '' then raise exception 'Property name is required'; end if;
  if coalesce(trim(_owner->>'title_number'), '') = '' then raise exception 'Title / LR number is required'; end if;
  if coalesce(_owner->>'document_path', '') = '' then raise exception 'Upload the ownership document'; end if;
  if coalesce(_owner->>'agreement_start', '') = '' then raise exception 'Agreement start date is required'; end if;
  if coalesce(_owner->>'ownership_type', '') = '' then raise exception 'Ownership type is required'; end if;
  if coalesce(trim(_caretaker->>'full_name'), '') = '' or coalesce(trim(_caretaker->>'phone'), '') = '' then
    raise exception 'Caretaker name and phone are required';
  end if;

  if _landlord_id is not null then
    select id into lid from landlords where id = _landlord_id and company_id = _company;
    if lid is null then raise exception 'Landlord not found in this company'; end if;
  else
    if coalesce(trim(_new_landlord->>'full_name'), '') = '' or coalesce(trim(_new_landlord->>'phone'), '') = '' then
      raise exception 'Landlord name and phone are required';
    end if;
    if coalesce((_new_landlord->>'consent')::boolean, false) is not true then
      raise exception 'Landlord consent to store their details is required';
    end if;
    insert into landlords (company_id, full_name, phone, email, consent_at, created_by)
    values (_company, trim(_new_landlord->>'full_name'), trim(_new_landlord->>'phone'),
            nullif(trim(_new_landlord->>'email'), ''), now(), auth.uid())
    returning id into lid;
    perform public._store_landlord_sensitive(lid, _new_landlord->>'id_number', _new_landlord->>'kra_pin', _new_landlord->>'payout_details');
  end if;

  select string_agg(quote_ident(c.column_name), ',') into cols
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'properties'
    and c.column_name in (select jsonb_object_keys(v));
  cols := coalesce(cols || ',', '') || 'user_id,company_id';
  execute format(
    'insert into public.properties (%s) select %s from jsonb_populate_record(null::public.properties, $1) returning id',
    cols, replace(replace(cols, 'user_id', '$2::uuid'), 'company_id', '$3::uuid')
  ) into pid using (v || jsonb_build_object('user_id', auth.uid(), 'company_id', _company)), auth.uid(), _company;

  insert into property_owners (property_id, landlord_id, ownership_type, share_percent, agreement_start, agreement_end, verified_by, verified_at)
  values (pid, lid, _owner->>'ownership_type', coalesce(nullif(_owner->>'share_percent','')::numeric, 100),
          (_owner->>'agreement_start')::date, nullif(_owner->>'agreement_end','')::date, auth.uid(), now())
  returning id into poid;
  insert into property_owner_sensitive (property_owner_id, title_enc, document_path)
  values (poid, app_encrypt(trim(_owner->>'title_number')), _owner->>'document_path');

  insert into caretakers (property_id, full_name, phone, start_date, notes)
  values (pid, trim(_caretaker->>'full_name'), trim(_caretaker->>'phone'),
          nullif(_caretaker->>'start_date','')::date, nullif(trim(_caretaker->>'notes'),''));
  return pid;
end $$;

-- ---------- reading what is safe to show ----------
create or replace function public.landlord_masks(_lid uuid)
returns table (has_id boolean, id_last4 text, has_kra boolean, has_payout boolean)
language sql stable security definer set search_path = public as $$
  select s.id_number_enc is not null, s.id_last4, s.kra_pin_enc is not null, s.payout_enc is not null
  from landlord_sensitive s where s.landlord_id = _lid and public.can_view_landlord(_lid);
$$;

-- name, phone and ownership summary for a property (visible to everyone who can see the property)
create or replace function public.property_owner_summaries(_property uuid)
returns table (owner_id uuid, landlord_id uuid, full_name text, phone text, email text, ownership_type text,
               share_percent numeric, agreement_start date, agreement_end date, verified_at timestamptz)
language sql stable security definer set search_path = public as $$
  select po.id, l.id, l.full_name, l.phone, l.email, po.ownership_type, po.share_percent,
         po.agreement_start, po.agreement_end, po.verified_at
  from property_owners po join landlords l on l.id = po.landlord_id
  where po.property_id = _property and public.can_view_property(_property);
$$;

-- ---------- viewing sensitive details (always logged) ----------
create or replace function public.get_landlord_sensitive(_lid uuid, _field text)
returns text language plpgsql security definer set search_path = public as $$
declare cid uuid; nm text; val text; officer boolean;
begin
  if _field not in ('id_number','kra_pin','payout_details') then raise exception 'Unknown field'; end if;
  if not public.can_reveal(_lid) then raise exception 'You need approval to view this'; end if;
  select company_id, full_name into cid, nm from landlords where id = _lid;
  if _field = 'id_number' then
    select app_decrypt(id_number_enc) into val from landlord_sensitive where landlord_id = _lid;
  elsif _field = 'kra_pin' then
    select app_decrypt(kra_pin_enc) into val from landlord_sensitive where landlord_id = _lid;
  else
    select app_decrypt(payout_enc) into val from landlord_sensitive where landlord_id = _lid;
  end if;
  officer := public.is_senior_officer(cid);
  insert into access_log (company_id, landlord_id, landlord_name, user_id, field, via)
  values (cid, _lid, nm, auth.uid(), _field, case when officer then 'senior_officer' else 'approval' end);
  return val;
end $$;

create or replace function public.get_ownership_details(_owner uuid)
returns table (title_number text, document_path text)
language plpgsql security definer set search_path = public as $$
declare lid uuid; cid uuid; nm text;
begin
  select po.landlord_id into lid from property_owners po where po.id = _owner;
  if lid is null or not public.can_reveal(lid) then raise exception 'You need approval to view this'; end if;
  select l.company_id, l.full_name into cid, nm from landlords l where l.id = lid;
  insert into access_log (company_id, landlord_id, landlord_name, user_id, field, via)
  values (cid, lid, nm, auth.uid(), 'title_deed', case when public.is_senior_officer(cid) then 'senior_officer' else 'approval' end);
  return query select app_decrypt(s.title_enc), s.document_path from property_owner_sensitive s where s.property_owner_id = _owner;
end $$;

-- ---------- requests and approvals ----------
create or replace function public.request_sensitive_access(_lid uuid, _reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; rid uuid;
begin
  select company_id into cid from landlords where id = _lid;
  if cid is null or not public.is_company_member(cid) or not public.can_view_landlord(_lid) then raise exception 'Not allowed'; end if;
  if public.is_senior_officer(cid) then raise exception 'Senior Officers can view this directly'; end if;
  if exists (select 1 from access_requests where landlord_id = _lid and requested_by = auth.uid()
             and (status = 'pending' or (status = 'approved' and expires_at > now()))) then
    raise exception 'You already have an open request for this landlord';
  end if;
  insert into access_requests (company_id, landlord_id, requested_by, reason)
  values (cid, _lid, auth.uid(), nullif(trim(_reason), '')) returning id into rid;
  return rid;
end $$;

create or replace function public.decide_access_request(_id uuid, _approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  select company_id into cid from access_requests where id = _id and status = 'pending';
  if cid is null then raise exception 'Request not found or already decided'; end if;
  if not public.is_senior_officer(cid) then raise exception 'Not allowed'; end if;
  update access_requests set status = case when _approve then 'approved' else 'denied' end,
    decided_by = auth.uid(), decided_at = now(),
    expires_at = case when _approve then now() + interval '12 hours' else null end
  where id = _id;
end $$;

create or replace function public.my_access_status(_lid uuid)
returns table (status text, expires_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.status, r.expires_at, r.created_at from access_requests r
  where r.landlord_id = _lid and r.requested_by = auth.uid()
  order by r.created_at desc limit 1;
$$;

grant execute on function public.set_landlord_sensitive(uuid, text, text, text) to authenticated;
grant execute on function public.register_property(uuid, jsonb, uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.landlord_masks(uuid) to authenticated;
grant execute on function public.property_owner_summaries(uuid) to authenticated;
grant execute on function public.get_landlord_sensitive(uuid, text) to authenticated;
grant execute on function public.get_ownership_details(uuid) to authenticated;
grant execute on function public.request_sensitive_access(uuid, text) to authenticated;
grant execute on function public.decide_access_request(uuid, boolean) to authenticated;
grant execute on function public.my_access_status(uuid) to authenticated;

-- Phase 1: company accounts foundation (additive, safe to re-run)

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'company' check (kind in ('company','individual')),
  registration_no text,
  earb_no text,
  legacy_landlord_id uuid unique,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('senior_officer','property_manager')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table if not exists public.property_assignments (
  property_id uuid not null references public.properties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (property_id, user_id)
);

alter table public.properties add column if not exists company_id uuid references public.companies(id);
create index if not exists properties_company_id_idx on public.properties(company_id);
create index if not exists company_members_user_idx on public.company_members(user_id);

-- Helper functions (SECURITY DEFINER avoids RLS recursion)
create or replace function public.is_company_member(_cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from company_members where company_id = _cid and user_id = auth.uid());
$$;

create or replace function public.is_senior_officer(_cid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from company_members
                 where company_id = _cid and user_id = auth.uid() and role = 'senior_officer');
$$;

create or replace function public.property_company(_pid uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select company_id from properties where id = _pid;
$$;

-- The one shared "properties I can manage" rule.
-- Senior Officers: all company properties. Property Managers: assigned ones only.
-- Legacy clauses keep today's landlords and agents working during the transition.
create or replace function public.can_view_property(_pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from properties p
    where p.id = _pid and (
      p.user_id = auth.uid()
      or (p.company_id is not null and is_senior_officer(p.company_id))
      or exists (select 1 from property_assignments pa
                 where pa.property_id = p.id and pa.user_id = auth.uid())
      or exists (select 1 from agent_landlord a
                 where a.agent_id = auth.uid() and a.landlord_id = p.user_id)
    )
  );
$$;

-- Row-level security on the new tables
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.property_assignments enable row level security;

drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies for select to authenticated
  using (public.is_company_member(id));

drop policy if exists company_members_select on public.company_members;
create policy company_members_select on public.company_members for select to authenticated
  using (user_id = auth.uid() or public.is_senior_officer(company_id));

drop policy if exists company_members_delete on public.company_members;
create policy company_members_delete on public.company_members for delete to authenticated
  using (public.is_senior_officer(company_id) and user_id <> auth.uid());

drop policy if exists assignments_select on public.property_assignments;
create policy assignments_select on public.property_assignments for select to authenticated
  using (user_id = auth.uid() or public.is_senior_officer(public.property_company(property_id)));

drop policy if exists assignments_insert on public.property_assignments;
create policy assignments_insert on public.property_assignments for insert to authenticated
  with check (public.is_senior_officer(public.property_company(property_id)));

drop policy if exists assignments_delete on public.property_assignments;
create policy assignments_delete on public.property_assignments for delete to authenticated
  using (public.is_senior_officer(public.property_company(property_id)));

-- Move existing landlords into a "company of one"
insert into public.companies (name, kind, legacy_landlord_id, created_by)
select coalesce(nullif(u.raw_user_meta_data->>'full_name',''), u.email, 'Landlord') || ' (Individual)',
       'individual', u.id, u.id
from auth.users u
where u.id in (select distinct user_id from public.properties where user_id is not null)
on conflict (legacy_landlord_id) do nothing;

insert into public.company_members (company_id, user_id, role)
select c.id, c.legacy_landlord_id, 'senior_officer'
from public.companies c where c.legacy_landlord_id is not null
on conflict do nothing;

-- Existing agents become property managers of their landlord's company
insert into public.company_members (company_id, user_id, role)
select c.id, a.agent_id, 'property_manager'
from public.agent_landlord a
join public.companies c on c.legacy_landlord_id = a.landlord_id
on conflict do nothing;

update public.properties p set company_id = c.id
from public.companies c
where c.legacy_landlord_id = p.user_id and p.company_id is null;

-- Keep agents seeing what they see today
insert into public.property_assignments (property_id, user_id)
select p.id, a.agent_id
from public.agent_landlord a
join public.properties p on p.user_id = a.landlord_id
on conflict do nothing;

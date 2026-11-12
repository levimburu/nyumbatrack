-- Daily reminders before compliance documents expire (30 days, 7 days, 1 day, and once when expired).
create table if not exists public.compliance_reminders_sent (
  record_id uuid not null references public.compliance_records(id) on delete cascade,
  expiry_date date not null,
  stage text not null check (stage in ('d30','d7','d1','expired')),
  sent_at timestamptz not null default now(),
  primary key (record_id, expiry_date, stage)
);
alter table public.compliance_reminders_sent enable row level security;

create or replace function public.run_compliance_reminders()
returns int language plpgsql security definer set search_path = public as $$
declare
  r record; today date := (now() at time zone 'Africa/Nairobi')::date;
  days int; stg text; uid uuid; n int := 0; ttl text; msg text; typ text;
begin
  for r in
    select cr.id, cr.property_id, cr.type, cr.expiry_date, p.name pname, p.user_id owner_id, p.company_id
    from compliance_records cr join properties p on p.id = cr.property_id
  loop
    days := r.expiry_date - today;
    stg := case when days < 0 then 'expired' when days <= 1 then 'd1' when days <= 7 then 'd7' when days <= 30 then 'd30' else null end;
    continue when stg is null;
    continue when r.company_id is not null and not company_active(r.company_id);
    continue when stg = 'expired' and days < -30;
    continue when exists (select 1 from compliance_reminders_sent s where s.record_id = r.id and s.expiry_date = r.expiry_date and s.stage = stg);
    insert into compliance_reminders_sent (record_id, expiry_date, stage) values (r.id, r.expiry_date, stg);

    ttl := case stg when 'expired' then 'Compliance Document Expired' else 'Compliance Document Expiring' end;
    msg := r.type || ' for ' || r.pname ||
      case when days < 0 then ' expired on ' || to_char(r.expiry_date, 'DD Mon YYYY') || '.'
           when days = 0 then ' expires today.'
           when days = 1 then ' expires tomorrow.'
           else ' expires in ' || days || ' days (' || to_char(r.expiry_date, 'DD Mon YYYY') || ').' end;
    typ := case when stg in ('expired','d1') then 'overdue' else 'info' end;

    for uid in
      select r.owner_id where r.company_id is null
      union
      select m.user_id from company_members m where m.company_id = r.company_id and m.role = 'senior_officer'
      union
      select pa.user_id from property_assignments pa where pa.property_id = r.property_id
      union
      select a.agent_id from agent_landlord a where a.property_id = r.property_id
      union
      select r.owner_id where r.company_id is not null and exists
        (select 1 from companies c where c.id = r.company_id and c.kind = 'individual')
    loop
      continue when uid is null;
      perform create_notification(uid, ttl, msg, typ);
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.run_compliance_reminders() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'compliance-reminders';
-- 06:00 Nairobi time = 03:00 UTC
select cron.schedule('compliance-reminders', '0 3 * * *', 'select public.run_compliance_reminders()');

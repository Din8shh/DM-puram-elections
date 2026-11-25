-- Pre-poll canvassing features: voter slips, follow-ups, hamlet targets, worker progress.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.

alter table public.voters add column if not exists slip_delivered    boolean not null default false;
alter table public.voters add column if not exists slip_delivered_at timestamptz;
alter table public.voters add column if not exists follow_up_on      date;
create index if not exists voters_follow_up_idx on public.voters (follow_up_on) where follow_up_on is not null;

alter table public.hamlets add column if not exists target_votes int;  -- how many votes we aim to get here

-- Update trigger: also stamp slip delivery and log the new fields.
create or replace function public.voters_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  changes jsonb := '{}';
  col text;
begin
  select * into me from public.profiles where id = auth.uid();

  if me.id is not null and me.role <> 'admin' then
    new.serial := old.serial; new.ward := old.ward; new.hamlet_id := old.hamlet_id;
    new.part_ref := old.part_ref; new.name := old.name; new.name_en := old.name_en;
    new.relation_type := old.relation_type; new.relation_name := old.relation_name;
    new.relation_name_en := old.relation_name_en; new.age := old.age; new.gender := old.gender;
    new.house_no := old.house_no; new.epic := old.epic; new.photo_path := old.photo_path;
    new.needs_review := old.needs_review; new.search_key := old.search_key;
    if me.role = 'worker' then new.assigned_to := old.assigned_to; end if;
  end if;

  if new.voted and not old.voted then
    new.voted_at := now(); new.voted_by := auth.uid();
  elsif not new.voted then
    new.voted_at := null; new.voted_by := null;
  end if;
  if new.contacted and not old.contacted then new.contacted_at := now(); end if;
  if not new.contacted then new.contacted_at := null; end if;
  if new.slip_delivered and not old.slip_delivered then new.slip_delivered_at := now(); end if;
  if not new.slip_delivered then new.slip_delivered_at := null; end if;

  new.updated_at := now();
  new.updated_by := auth.uid();

  foreach col in array array['leaning','contacted','voted','phone','notes','needs_transport','away',
                             'assigned_to','slip_delivered','follow_up_on',
                             'name','age','gender','house_no','epic','relation_name'] loop
    if (to_jsonb(new) -> col) is distinct from (to_jsonb(old) -> col) then
      changes := changes || jsonb_build_object(col, to_jsonb(new) -> col);
    end if;
  end loop;
  if changes <> '{}' then
    insert into public.activity (voter_serial, user_id, action, detail)
    values (new.serial, auth.uid(),
            case when changes ? 'voted' then case when new.voted then 'voted' else 'unvoted' end else 'update' end,
            changes);
  end if;
  return new;
end $$;

-- Dashboard numbers, now with slips and follow-ups.
drop function if exists public.hamlet_stats();
create function public.hamlet_stats()
returns table (
  hamlet_id int, total bigint, male bigint, female bigint, contacted bigint,
  strong bigint, leaning bigint, undecided bigint, opposed bigint, unknown bigint,
  voted bigint, ours_voted bigint, ours_total bigint, transport bigint, away bigint,
  slips bigint, follow_ups_due bigint
) language sql stable security invoker set search_path = public as $$
  select v.hamlet_id,
    count(*),
    count(*) filter (where gender = 'M'),
    count(*) filter (where gender = 'F'),
    count(*) filter (where contacted),
    count(*) filter (where v.leaning = 'strong'),
    count(*) filter (where v.leaning = 'leaning'),
    count(*) filter (where v.leaning = 'undecided'),
    count(*) filter (where v.leaning = 'opposed'),
    count(*) filter (where v.leaning = 'unknown'),
    count(*) filter (where voted),
    count(*) filter (where voted and v.leaning in ('strong', 'leaning')),
    count(*) filter (where v.leaning in ('strong', 'leaning')),
    count(*) filter (where needs_transport),
    count(*) filter (where v.away),
    count(*) filter (where slip_delivered),
    count(*) filter (where follow_up_on <= (now() at time zone 'Asia/Kolkata')::date)
  from public.voters v
  group by v.hamlet_id
  order by v.hamlet_id
$$;

-- Progress per assigned worker (admins and in-charges see the people whose voters they can see).
create or replace function public.assignment_stats()
returns table (user_id uuid, full_name text, assigned bigint, contacted bigint, ours bigint,
               slips bigint, follow_ups_due bigint, voted bigint)
language sql stable security invoker set search_path = public as $$
  select v.assigned_to, p.full_name,
    count(*),
    count(*) filter (where v.contacted),
    count(*) filter (where v.leaning in ('strong', 'leaning')),
    count(*) filter (where v.slip_delivered),
    count(*) filter (where v.follow_up_on <= (now() at time zone 'Asia/Kolkata')::date),
    count(*) filter (where v.voted)
  from public.voters v join public.profiles p on p.id = v.assigned_to
  group by v.assigned_to, p.full_name
  order by p.full_name
$$;

grant execute on function public.hamlet_stats(), public.assignment_stats() to authenticated;

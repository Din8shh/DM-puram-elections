-- Five-step support scale: adds "unlikely" between undecided (50-50) and opposed (against).
-- Run once after 004_transport.sql (SQL Editor > New query > paste > Run). Safe to re-run.

alter table public.voters drop constraint if exists voters_leaning_check;
alter table public.voters add constraint voters_leaning_check
  check (leaning in ('unknown', 'strong', 'leaning', 'undecided', 'unlikely', 'opposed'));

-- Dashboard numbers, now with an "unlikely" count (added as the last column).
drop function if exists public.hamlet_stats();
create function public.hamlet_stats()
returns table (
  hamlet_id int, total bigint, male bigint, female bigint, contacted bigint,
  strong bigint, leaning bigint, undecided bigint, opposed bigint, unknown bigint,
  voted bigint, ours_voted bigint, ours_total bigint, transport bigint, away bigint,
  slips bigint, follow_ups_due bigint, unlikely bigint
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
    count(*) filter (where follow_up_on <= (now() at time zone 'Asia/Kolkata')::date),
    count(*) filter (where v.leaning = 'unlikely')
  from public.voters v
  group by v.hamlet_id
  order by v.hamlet_id
$$;
grant execute on function public.hamlet_stats() to authenticated;

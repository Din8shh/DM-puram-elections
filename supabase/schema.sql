-- DM Puram election tool: database schema
-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Safe to re-run: it only creates what is missing and replaces functions/policies.

-- ───────────────────────── Tables ─────────────────────────

create table if not exists public.hamlets (
  id          int primary key,
  name_te     text not null,
  name_en     text,
  serial_from int not null,
  serial_to   int not null
);

create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text unique not null,
  full_name  text not null default '',
  phone      text,
  role       text not null default 'worker' check (role in ('admin', 'incharge', 'worker')),
  hamlet_ids int[] not null default '{}',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.voters (
  serial          int primary key,            -- serial no. in the panchayat roll (గ్రా.పం.ఓ.జా.వ.సం)
  ward            int,
  hamlet_id       int references public.hamlets (id),
  part_ref        text,                        -- assembly roll ref, e.g. 171-109-5
  name            text not null default '',    -- Telugu, as printed
  name_en         text,                        -- rough English spelling for search
  relation_type   text check (relation_type in ('father', 'husband', 'mother', 'other')),
  relation_name   text,
  relation_name_en text,
  age             int,
  gender          text check (gender in ('M', 'F', 'O')),
  house_no        text,
  epic            text,                        -- voter ID card no.
  photo_path      text,
  needs_review    boolean not null default false, -- OCR was unsure; please check against the printed list
  search_key      text,                        -- forgiving English spelling key (see web/js/translit.js)

  -- campaign fields
  phone           text,
  leaning         text not null default 'unknown'
                  check (leaning in ('unknown', 'strong', 'leaning', 'undecided', 'opposed')),
  contacted       boolean not null default false,
  contacted_at    timestamptz,
  notes           text,
  needs_transport boolean not null default false,
  away            boolean not null default false,  -- lives outside the village
  assigned_to     uuid references public.profiles (id) on delete set null,

  -- poll day
  voted           boolean not null default false,
  voted_at        timestamptz,
  voted_by        uuid references public.profiles (id) on delete set null,

  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles (id) on delete set null
);

create index if not exists voters_hamlet_idx   on public.voters (hamlet_id);
create index if not exists voters_house_idx    on public.voters (hamlet_id, house_no);
create index if not exists voters_assigned_idx on public.voters (assigned_to);

create table if not exists public.activity (
  id           bigserial primary key,
  voter_serial int references public.voters (serial) on delete cascade,
  user_id      uuid references public.profiles (id) on delete set null,
  action       text not null,
  detail       jsonb,
  at           timestamptz not null default now()
);
create index if not exists activity_voter_idx on public.activity (voter_serial, at desc);
create index if not exists activity_at_idx on public.activity (at desc);

-- ───────────────────────── Helpers ─────────────────────────
-- security definer so policies can read the caller's profile without recursion.

create or replace function public.my_profile()
returns public.profiles language sql stable security definer set search_path = public as $$
  select * from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin')
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active)
$$;

create or replace function public.can_see_voter(v_hamlet int, v_assigned uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and (p.role = 'admin' or v_hamlet = any (p.hamlet_ids) or v_assigned = p.id)
  )
$$;

-- ───────────────────────── Row level security ─────────────────────────

alter table public.hamlets  enable row level security;
alter table public.profiles enable row level security;
alter table public.voters   enable row level security;
alter table public.activity enable row level security;

drop policy if exists hamlets_read on public.hamlets;
create policy hamlets_read on public.hamlets for select to authenticated using (public.is_active_user());
drop policy if exists hamlets_admin on public.hamlets;
create policy hamlets_admin on public.hamlets for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Everyone on the team can see the team list (names, roles) so voters can be assigned.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());
drop policy if exists profiles_admin on public.profiles;
create policy profiles_admin on public.profiles for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists voters_read on public.voters;
create policy voters_read on public.voters for select to authenticated
  using (public.can_see_voter(hamlet_id, assigned_to));
drop policy if exists voters_update on public.voters;
create policy voters_update on public.voters for update to authenticated
  using (public.can_see_voter(hamlet_id, assigned_to))
  with check (public.is_active_user());
drop policy if exists voters_admin_insert on public.voters;
create policy voters_admin_insert on public.voters for insert to authenticated with check (public.is_admin());
drop policy if exists voters_admin_delete on public.voters;
create policy voters_admin_delete on public.voters for delete to authenticated using (public.is_admin());

drop policy if exists activity_read on public.activity;
create policy activity_read on public.activity for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.voters v where v.serial = voter_serial
  ));
-- activity rows are only written by the trigger below (security definer)

-- ───────────────────────── Update trigger ─────────────────────────
-- Non-admins can only change campaign / poll-day fields; the printed roll details stay as they are.
-- Every change is stamped and logged.

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
    -- workers cannot reassign voters; in-charges and admins can
    if me.role = 'worker' then new.assigned_to := old.assigned_to; end if;
  end if;

  if new.voted and not old.voted then
    new.voted_at := now(); new.voted_by := auth.uid();
  elsif not new.voted then
    new.voted_at := null; new.voted_by := null;
  end if;
  if new.contacted and not old.contacted then new.contacted_at := now(); end if;
  if not new.contacted then new.contacted_at := null; end if;

  new.updated_at := now();
  new.updated_by := auth.uid();

  foreach col in array array['leaning','contacted','voted','phone','notes','needs_transport','away',
                             'assigned_to','name','age','gender','house_no','epic','relation_name'] loop
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

drop trigger if exists voters_before_update on public.voters;
create trigger voters_before_update before update on public.voters
  for each row execute function public.voters_before_update();

-- ───────────────────────── Dashboard numbers ─────────────────────────
-- security invoker: each user only counts the voters they are allowed to see.

create or replace function public.hamlet_stats()
returns table (
  hamlet_id int, total bigint, male bigint, female bigint, contacted bigint,
  strong bigint, leaning bigint, undecided bigint, opposed bigint, unknown bigint,
  voted bigint, ours_voted bigint, ours_total bigint, transport bigint, away bigint
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
    count(*) filter (where v.away)
  from public.voters v
  group by v.hamlet_id
  order by v.hamlet_id
$$;

create or replace function public.worker_stats()
returns table (user_id uuid, full_name text, updates bigint, voted_marks bigint, last_at timestamptz)
language sql stable security invoker set search_path = public as $$
  select a.user_id, p.full_name,
         count(*) filter (where a.action = 'update'),
         count(*) filter (where a.action = 'voted'),
         max(a.at)
  from public.activity a join public.profiles p on p.id = a.user_id
  where public.is_admin()
  group by a.user_id, p.full_name
  order by 3 desc
$$;

-- ───────────────────────── Grants ─────────────────────────

grant usage on schema public to authenticated;
grant select on public.hamlets, public.profiles, public.activity to authenticated;
grant insert, update, delete on public.hamlets, public.profiles to authenticated;
grant select, insert, update, delete on public.voters to authenticated;
grant execute on function public.hamlet_stats(), public.worker_stats(), public.my_profile(),
  public.is_admin(), public.is_active_user(), public.can_see_voter(int, uuid) to authenticated;
revoke all on public.voters, public.profiles, public.hamlets, public.activity from anon;

-- ───────────────────────── Photos (private storage bucket) ─────────────────────────

insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do update set public = false;

drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_active_user());

-- ───────────────────────── Live updates on poll day ─────────────────────────
do $$ begin
  alter publication supabase_realtime add table public.voters;
exception when others then null; end $$;

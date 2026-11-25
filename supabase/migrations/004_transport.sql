-- Outstation voters and poll-day transport.
-- Run once after 003_super_admin.sql (SQL Editor > New query > paste > Run). Safe to re-run.

-- Vehicles for poll day. Admins and area in-charges manage them; everyone signed in can see them.
create table if not exists public.vehicles (
  id           serial primary key,
  label        text not null,              -- e.g. "Auto 1", "Tata Sumo"
  driver_name  text,
  driver_phone text,
  capacity     int,
  hamlet_id    int references public.hamlets(id),
  notes        text,
  created_at   timestamptz not null default now()
);
alter table public.vehicles enable row level security;

create or replace function public.can_manage_transport()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role in ('superadmin', 'admin', 'incharge'))
$$;
grant execute on function public.can_manage_transport() to authenticated;

drop policy if exists vehicles_read on public.vehicles;
create policy vehicles_read on public.vehicles for select to authenticated using (public.is_active_user());
drop policy if exists vehicles_manage on public.vehicles;
create policy vehicles_manage on public.vehicles for all to authenticated
  using (public.can_manage_transport()) with check (public.can_manage_transport());
grant select, insert, update, delete on public.vehicles to authenticated;
grant usage, select on sequence public.vehicles_id_seq to authenticated;

-- Outstation details and the vehicle a voter is booked on.
alter table public.voters add column if not exists away_place  text;     -- town/city they live in now
alter table public.voters add column if not exists travel_plan text not null default 'unknown';
alter table public.voters drop constraint if exists voters_travel_plan_check;
alter table public.voters add constraint voters_travel_plan_check
  check (travel_plan in ('unknown', 'coming', 'needs_help', 'not_coming'));
alter table public.voters add column if not exists vehicle_id int references public.vehicles(id) on delete set null;
create index if not exists voters_vehicle_idx on public.voters (vehicle_id);

-- Same trigger as 003, now also logging the new fields.
create or replace function public.voters_before_update()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  changes jsonb := '{}';
  col text;
begin
  select * into me from public.profiles where id = auth.uid();

  -- me.id is null only for the import script (service key), which may write everything.
  if me.id is not null and me.role <> 'superadmin' then
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
                             'assigned_to','slip_delivered','follow_up_on','away_place','travel_plan','vehicle_id',
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

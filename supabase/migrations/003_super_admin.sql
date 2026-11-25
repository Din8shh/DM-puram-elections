-- Four roles: superadmin (the candidate's owner), admin, incharge, worker.
-- Super admin only: manage admins, correct printed roll details, set hamlet targets, export.
-- Run once after 002_canvassing.sql (SQL Editor > New query > paste > Run). Safe to re-run.

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('superadmin', 'admin', 'incharge', 'worker'));

-- The login created by the import ("dinesh") becomes the super admin.
update public.profiles set role = 'superadmin' where username = 'dinesh';

-- Admin-level reads (all hamlets) now cover both admin and super admin.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role in ('admin', 'superadmin'))
$$;

create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'superadmin')
$$;
grant execute on function public.is_superadmin() to authenticated;

create or replace function public.can_see_voter(v_hamlet int, v_assigned uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and (p.role in ('admin', 'superadmin') or v_hamlet = any (p.hamlet_ids) or v_assigned = p.id)
  )
$$;

-- Hamlet targets: super admin only.
drop policy if exists hamlets_admin on public.hamlets;
create policy hamlets_admin on public.hamlets for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

-- Team: admins manage in-charges and workers; only the super admin manages admins.
drop policy if exists profiles_admin on public.profiles;
create policy profiles_admin on public.profiles for all to authenticated
  using (public.is_superadmin() or (public.is_admin() and role in ('incharge', 'worker')))
  with check (public.is_superadmin() or (public.is_admin() and role in ('incharge', 'worker')));

-- Voters: only the super admin may change printed roll details or delete/insert voters.
drop policy if exists voters_admin_insert on public.voters;
create policy voters_admin_insert on public.voters for insert to authenticated with check (public.is_superadmin());
drop policy if exists voters_admin_delete on public.voters;
create policy voters_admin_delete on public.voters for delete to authenticated using (public.is_superadmin());

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

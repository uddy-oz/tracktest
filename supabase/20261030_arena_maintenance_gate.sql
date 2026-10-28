begin;

-- The lock is installed closed. Only a database owner can toggle this row;
-- it is deliberately not exposed through PostgREST or an application RPC.
-- Open after deployment checks: UPDATE arena_private.runtime_controls
--   SET enabled = false, updated_at = clock_timestamp()
--   WHERE control_name = 'multiplayer_maintenance';
-- Re-lock on failure by running the same UPDATE with enabled = true.
-- Use pg_advisory_xact_lock(246013579, 8731) in the same transaction when
-- toggling the gate, matching the existing production maintenance guard.
create table if not exists arena_private.runtime_controls (
  control_name text primary key check (control_name = 'multiplayer_maintenance'),
  enabled boolean not null,
  message text not null default 'StanZer multiplayer is temporarily unavailable for maintenance.',
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

-- Production already has this table, including a required message without a
-- default. Keep that schema and its custom message; also support older local
-- rehearsals which installed the control table without a message column.
alter table arena_private.runtime_controls
  add column if not exists message text not null
  default 'StanZer multiplayer is temporarily unavailable for maintenance.';

insert into arena_private.runtime_controls (control_name, enabled, message)
values ('multiplayer_maintenance', true,
  'StanZer multiplayer is temporarily unavailable for maintenance.')
on conflict (control_name) do update
set enabled = true,
    updated_at = pg_catalog.clock_timestamp();

alter table arena_private.runtime_controls enable row level security;
revoke all on table arena_private.runtime_controls
  from public, anon, authenticated, service_role;

create or replace function arena_private.enforce_arena_maintenance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  maintenance_enabled boolean;
  maintenance_message text;
begin
  perform pg_catalog.pg_advisory_xact_lock(246013579, 8731);
  select control.enabled, control.message
  into maintenance_enabled, maintenance_message
  from arena_private.runtime_controls control
  where control.control_name = 'multiplayer_maintenance';

  maintenance_enabled := coalesce(maintenance_enabled, true);
  maintenance_message := coalesce(nullif(pg_catalog.btrim(maintenance_message), ''),
    'StanZer multiplayer is temporarily unavailable for maintenance.');

  if not maintenance_enabled then
    return new;
  end if;

  if tg_table_name = 'arena_rooms' then
    if tg_op = 'INSERT' then
      raise exception using
        errcode = '55000',
        message = maintenance_message;
    end if;

    if old.status is distinct from new.status
       and new.status in ('starting', 'active') then
      raise exception using
        errcode = '55000',
        message = maintenance_message;
    end if;
  elsif tg_table_name = 'arena_room_players' then
    if tg_op = 'INSERT'
       or (old.left_at is not null and new.left_at is null)
       or (coalesce(old.result_status, 'active') in ('cancelled', 'left', 'forfeit')
           and new.result_status = 'active') then
      raise exception using
        errcode = '55000',
        message = maintenance_message;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function arena_private.enforce_arena_maintenance()
  from public, anon, authenticated, service_role;

drop trigger if exists enforce_arena_maintenance_room_insert on public.arena_rooms;
drop trigger if exists a00_maintenance_room_insert on public.arena_rooms;
create trigger a00_maintenance_room_insert
before insert on public.arena_rooms
for each row execute function arena_private.enforce_arena_maintenance();

drop trigger if exists enforce_arena_maintenance_room_start on public.arena_rooms;
drop trigger if exists a00_maintenance_room_start on public.arena_rooms;
create trigger a00_maintenance_room_start
before update of status on public.arena_rooms
for each row execute function arena_private.enforce_arena_maintenance();

drop trigger if exists enforce_arena_maintenance_player_insert on public.arena_room_players;
drop trigger if exists a00_maintenance_player_insert on public.arena_room_players;
create trigger a00_maintenance_player_insert
before insert on public.arena_room_players
for each row execute function arena_private.enforce_arena_maintenance();

drop trigger if exists enforce_arena_maintenance_player_rejoin on public.arena_room_players;
drop trigger if exists a00_maintenance_player_rejoin on public.arena_room_players;
create trigger a00_maintenance_player_rejoin
before update of left_at, result_status on public.arena_room_players
for each row execute function arena_private.enforce_arena_maintenance();

commit;

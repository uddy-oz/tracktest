alter table public.arena_rooms
  add column if not exists expires_at timestamptz;

alter table public.arena_room_players
  add column if not exists current_score integer not null default 0,
  add column if not exists current_correct_answers integer not null default 0,
  add column if not exists current_question_index integer not null default 0,
  add column if not exists current_streak integer not null default 0,
  add column if not exists left_at timestamptz;

update public.arena_rooms
set expires_at = created_at + interval '2 hours'
where expires_at is null
  and mode = 'duel'
  and status = 'waiting';

create index if not exists arena_rooms_duel_active_status_idx
  on public.arena_rooms (mode, status, created_at desc)
  where mode = 'duel'
    and status in ('waiting', 'starting', 'active');

create index if not exists arena_room_players_user_room_idx
  on public.arena_room_players (user_id, room_id)
  where left_at is null;

create or replace function public.prepare_duel_room_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.mode = 'duel' then
    if new.expires_at is null then
      new.expires_at := now() + interval '2 hours';
    end if;

    if exists (
      select 1
      from public.arena_rooms existing_room
      where existing_room.host_user_id = new.host_user_id
        and existing_room.mode = 'duel'
        and existing_room.status in ('waiting', 'starting', 'active')
    ) then
      raise exception 'Host already has an active Duel room.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists arena_rooms_prepare_duel_insert on public.arena_rooms;

create trigger arena_rooms_prepare_duel_insert
  before insert on public.arena_rooms
  for each row
  execute function public.prepare_duel_room_insert();

create or replace function public.prevent_multiple_active_duel_rooms()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.arena_room_players existing_player
    join public.arena_rooms existing_room
      on existing_room.id = existing_player.room_id
    where existing_player.user_id = new.user_id
      and existing_player.left_at is null
      and existing_room.mode = 'duel'
      and existing_room.status in ('waiting', 'starting', 'active')
      and existing_room.id <> new.room_id
  ) then
    raise exception 'User is already in an active Duel room.';
  end if;

  return new;
end;
$$;

drop trigger if exists arena_room_players_one_active_duel on public.arena_room_players;

create trigger arena_room_players_one_active_duel
  before insert on public.arena_room_players
  for each row
  execute function public.prevent_multiple_active_duel_rooms();

create or replace function public.cancel_stale_duel_rooms()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cancelled_count integer;
begin
  update public.arena_rooms
  set
    status = 'cancelled',
    finished_at = coalesce(finished_at, now())
  where mode = 'duel'
    and status = 'waiting'
    and coalesce(expires_at, created_at + interval '2 hours') < now();

  get diagnostics cancelled_count = row_count;
  return cancelled_count;
end;
$$;

drop policy if exists "Room players can update joined arena rooms" on public.arena_rooms;

create or replace function public.finish_duel_room_if_complete(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  is_complete boolean;
begin
  if not public.is_arena_room_player(target_room_id, auth.uid()) then
    raise exception 'Only Duel room players can finish the room.';
  end if;

  select
    count(*) >= 2
    and bool_and(finished_at is not null)
  into is_complete
  from public.arena_room_players
  where room_id = target_room_id
    and left_at is null;

  if is_complete then
    update public.arena_rooms
    set
      status = 'finished',
      finished_at = coalesce(finished_at, now())
    where id = target_room_id
      and mode = 'duel'
      and status <> 'finished';
  end if;

  return coalesce(is_complete, false);
end;
$$;

grant execute on function public.prepare_duel_room_insert() to authenticated;
grant execute on function public.prevent_multiple_active_duel_rooms() to authenticated;
grant execute on function public.cancel_stale_duel_rooms() to authenticated;
grant execute on function public.finish_duel_room_if_complete(uuid) to authenticated;

alter table public.arena_rooms
  add column if not exists expires_at timestamptz;

alter table public.arena_room_players
  add column if not exists current_score integer not null default 0,
  add column if not exists current_correct_answers integer not null default 0,
  add column if not exists current_question_index integer not null default 0,
  add column if not exists current_streak integer not null default 0,
  add column if not exists left_at timestamptz,
  add column if not exists forfeited_at timestamptz,
  add column if not exists result_status text not null default 'active';

create index if not exists arena_rooms_active_modes_status_idx
  on public.arena_rooms (mode, status, created_at desc)
  where mode in ('duel', 'group_lobby')
    and status in ('waiting', 'starting', 'active');

create or replace function public.prepare_duel_room_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.mode in ('duel', 'group_lobby') then
    if new.expires_at is null then
      new.expires_at := now() + interval '2 hours';
    end if;

    if exists (
      select 1
      from public.arena_rooms existing_room
      where existing_room.host_user_id = new.host_user_id
        and existing_room.mode in ('duel', 'group_lobby')
        and existing_room.status in ('waiting', 'starting', 'active')
    ) then
      raise exception 'Host already has an active Arena room.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.prevent_multiple_active_duel_rooms()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_mode text;
begin
  select mode
  into target_mode
  from public.arena_rooms
  where id = new.room_id;

  if target_mode not in ('duel', 'group_lobby') then
    return new;
  end if;

  if exists (
    select 1
    from public.arena_room_players existing_player
    join public.arena_rooms existing_room
      on existing_room.id = existing_player.room_id
    where existing_player.user_id = new.user_id
      and existing_player.left_at is null
      and existing_player.finished_at is null
      and existing_room.mode in ('duel', 'group_lobby')
      and existing_room.status in ('waiting', 'starting', 'active')
      and existing_room.id <> new.room_id
  ) then
    raise exception 'User is already in an active Arena room.';
  end if;

  return new;
end;
$$;

create or replace function public.cancel_stale_arena_rooms()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cancelled_count integer;
  active_cancelled_count integer;
begin
  update public.arena_rooms
  set
    status = 'cancelled',
    finished_at = coalesce(finished_at, now())
  where mode in ('duel', 'group_lobby')
    and status = 'waiting'
    and coalesce(expires_at, created_at + interval '2 hours') < now();

  get diagnostics cancelled_count = row_count;

  update public.arena_rooms
  set
    status = 'cancelled',
    finished_at = coalesce(finished_at, now())
  where mode in ('duel', 'group_lobby')
    and status = 'active'
    and coalesce(started_at, created_at) < now() - interval '90 minutes';

  get diagnostics active_cancelled_count = row_count;
  cancelled_count := cancelled_count + active_cancelled_count;

  return cancelled_count;
end;
$$;

create or replace function public.close_arena_room(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.arena_rooms
  set
    status = 'cancelled',
    finished_at = coalesce(finished_at, now())
  where id = target_room_id
    and mode in ('duel', 'group_lobby')
    and status in ('waiting', 'starting')
    and host_user_id = auth.uid();

  if not found then
    raise exception 'Only the host can close a waiting Arena lobby.';
  end if;

  update public.arena_room_players
  set
    left_at = coalesce(left_at, now()),
    result_status = 'cancelled'
  where room_id = target_room_id
    and left_at is null;

  return true;
end;
$$;

create or replace function public.leave_waiting_arena_room(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.arena_rooms
    where id = target_room_id
      and mode in ('duel', 'group_lobby')
      and status in ('waiting', 'starting')
  ) then
    raise exception 'This Arena lobby is not waiting.';
  end if;

  update public.arena_room_players
  set
    left_at = coalesce(left_at, now()),
    result_status = 'left'
  where room_id = target_room_id
    and user_id = auth.uid()
    and left_at is null;

  if not found then
    raise exception 'You are not in this Arena lobby.';
  end if;

  return true;
end;
$$;

create or replace function public.forfeit_arena_room(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  question_total integer;
  remaining_active_count integer;
begin
  select coalesce(jsonb_array_length(quiz_questions), 0)
  into question_total
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby')
    and status = 'active';

  if question_total is null then
    raise exception 'This Arena game is not active.';
  end if;

  update public.arena_room_players
  set
    final_score = greatest(final_score, current_score),
    correct_answers = greatest(correct_answers, current_correct_answers),
    total_questions = greatest(total_questions, question_total),
    finished_at = coalesce(finished_at, now()),
    forfeited_at = coalesce(forfeited_at, now()),
    left_at = coalesce(left_at, now()),
    result_status = 'forfeit'
  where room_id = target_room_id
    and user_id = auth.uid();

  if not found then
    raise exception 'You are not in this Arena game.';
  end if;

  select count(*)
  into remaining_active_count
  from public.arena_room_players
  where room_id = target_room_id
    and left_at is null
    and finished_at is null;

  if remaining_active_count <= 1 then
    update public.arena_room_players
    set
      final_score = greatest(final_score, current_score),
      correct_answers = greatest(correct_answers, current_correct_answers),
      total_questions = greatest(total_questions, question_total),
      finished_at = coalesce(finished_at, now()),
      result_status = 'win_by_forfeit'
    where room_id = target_room_id
      and user_id <> auth.uid()
      and left_at is null
      and finished_at is null;

    update public.arena_rooms
    set
      status = 'finished',
      finished_at = coalesce(finished_at, now())
    where id = target_room_id
      and mode in ('duel', 'group_lobby');
  end if;

  return true;
end;
$$;

create or replace function public.finish_arena_room_if_complete(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  is_complete boolean;
  required_players integer;
begin
  if not public.is_arena_room_player(target_room_id, auth.uid()) then
    raise exception 'Only Arena room players can finish the room.';
  end if;

  select case when mode = 'group_lobby' then 3 else 2 end
  into required_players
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby');

  if required_players is null then
    return false;
  end if;

  select
    count(*) >= required_players
    and bool_and(finished_at is not null)
  into is_complete
  from public.arena_room_players
  where room_id = target_room_id
    and result_status not in ('cancelled', 'left');

  if is_complete then
    update public.arena_rooms
    set
      status = 'finished',
      finished_at = coalesce(finished_at, now())
    where id = target_room_id
      and mode in ('duel', 'group_lobby')
      and status <> 'finished';
  end if;

  return coalesce(is_complete, false);
end;
$$;

grant execute on function public.prepare_duel_room_insert() to authenticated;
grant execute on function public.prevent_multiple_active_duel_rooms() to authenticated;
grant execute on function public.cancel_stale_arena_rooms() to authenticated;
grant execute on function public.close_arena_room(uuid) to authenticated;
grant execute on function public.leave_waiting_arena_room(uuid) to authenticated;
grant execute on function public.forfeit_arena_room(uuid) to authenticated;
grant execute on function public.finish_arena_room_if_complete(uuid) to authenticated;

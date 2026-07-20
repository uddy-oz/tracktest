-- Make leaving an Arena room a real, idempotent membership exit.
-- Run after 20260720_party_mode_username_and_round_reliability.sql.

create or replace function public.leave_arena_room(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  target_room public.arena_rooms%rowtype;
  current_player public.arena_room_players%rowtype;
  next_host_id uuid;
  remaining_player_count integer;
  remaining_active_count integer;
  question_total integer;
begin
  if caller_id is null then
    raise exception 'Authentication is required.';
  end if;

  select *
  into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby', 'party_mode')
  for update;

  -- Treat a repeated leave for a missing or inaccessible room as complete.
  if target_room.id is null then
    return true;
  end if;

  select *
  into current_player
  from public.arena_room_players
  where room_id = target_room_id
    and user_id = caller_id
  for update;

  -- Idempotent: the player already left or was never a member.
  if current_player.id is null or current_player.left_at is not null then
    return true;
  end if;

  question_total := coalesce(jsonb_array_length(target_room.quiz_questions), 0);

  if target_room.status = 'active' then
    update public.arena_room_players
    set
      final_score = greatest(final_score, current_score),
      correct_answers = greatest(correct_answers, current_correct_answers),
      total_questions = greatest(total_questions, question_total),
      finished_at = coalesce(finished_at, now()),
      forfeited_at = coalesce(forfeited_at, now()),
      left_at = coalesce(left_at, now()),
      is_ready = false,
      result_status = 'forfeit'
    where id = current_player.id;

    if target_room.mode = 'duel' then
      update public.arena_room_players
      set
        final_score = greatest(final_score, current_score),
        correct_answers = greatest(correct_answers, current_correct_answers),
        total_questions = greatest(total_questions, question_total),
        finished_at = coalesce(finished_at, now()),
        result_status = case
          when result_status = 'completed' then result_status
          else 'win_by_forfeit'
        end
      where room_id = target_room_id
        and user_id <> caller_id
        and left_at is null;

      update public.arena_rooms
      set
        status = 'finished',
        finished_at = coalesce(finished_at, now()),
        rematch_requested_by = null,
        rematch_requested_at = null
      where id = target_room_id;

      return true;
    end if;

    if target_room.host_user_id = caller_id then
      select user_id
      into next_host_id
      from public.arena_room_players
      where room_id = target_room_id
        and user_id <> caller_id
        and left_at is null
        and coalesce(result_status, 'active') not in ('cancelled', 'left')
      order by joined_at asc
      limit 1;

      if next_host_id is not null then
        update public.arena_rooms
        set host_user_id = next_host_id
        where id = target_room_id;
      end if;
    end if;

    select
      count(*)::integer,
      count(*) filter (where finished_at is null)::integer
    into remaining_player_count, remaining_active_count
    from public.arena_room_players
    where room_id = target_room_id
      and left_at is null
      and coalesce(result_status, 'active') not in ('cancelled', 'left');

    if remaining_player_count = 0 or remaining_active_count = 0 then
      update public.arena_rooms
      set
        status = 'finished',
        finished_at = coalesce(finished_at, now()),
        rematch_requested_by = null,
        rematch_requested_at = null
      where id = target_room_id;
    end if;

    return true;
  end if;

  update public.arena_room_players
  set
    left_at = coalesce(left_at, now()),
    is_ready = false,
    result_status = case
      when result_status in ('completed', 'forfeit', 'win_by_forfeit')
        then result_status
      else 'left'
    end
  where id = current_player.id;

  update public.arena_rooms
  set
    rematch_requested_by = null,
    rematch_requested_at = null
  where id = target_room_id;

  if target_room.host_user_id = caller_id then
    if target_room.mode in ('group_lobby', 'party_mode') then
      select user_id
      into next_host_id
      from public.arena_room_players
      where room_id = target_room_id
        and left_at is null
        and coalesce(result_status, 'active') not in ('cancelled', 'left')
      order by joined_at asc
      limit 1;

      if next_host_id is not null then
        update public.arena_rooms
        set host_user_id = next_host_id
        where id = target_room_id;
      else
        update public.arena_rooms
        set
          status = 'cancelled',
          finished_at = coalesce(finished_at, now())
        where id = target_room_id;
      end if;
    else
      update public.arena_rooms
      set
        status = 'cancelled',
        finished_at = coalesce(finished_at, now())
      where id = target_room_id;

      update public.arena_room_players
      set
        left_at = coalesce(left_at, now()),
        is_ready = false,
        result_status = case
          when result_status in ('completed', 'forfeit', 'win_by_forfeit')
            then result_status
          else 'cancelled'
        end
      where room_id = target_room_id
        and left_at is null;
    end if;
  end if;

  return true;
end;
$$;

grant execute on function public.leave_arena_room(uuid) to authenticated;

create or replace function public.close_arena_room(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.arena_rooms%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select *
  into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby', 'party_mode')
    and host_user_id = auth.uid()
  for update;

  if target_room.id is null then
    raise exception 'Only the host can close a waiting Arena lobby.';
  end if;

  if target_room.status in ('cancelled', 'finished') then
    return true;
  end if;

  if target_room.status not in ('waiting', 'starting') then
    raise exception 'Only a waiting Arena lobby can be closed.';
  end if;

  update public.arena_rooms
  set
    status = 'cancelled',
    finished_at = coalesce(finished_at, now()),
    rematch_requested_by = null,
    rematch_requested_at = null
  where id = target_room_id;

  update public.arena_room_players
  set
    left_at = coalesce(left_at, now()),
    is_ready = false,
    result_status = 'cancelled'
  where room_id = target_room_id
    and left_at is null;

  return true;
end;
$$;

create or replace function public.request_arena_rematch(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from public.arena_room_players arp
    where arp.room_id = target_room_id
      and arp.user_id = auth.uid()
      and arp.left_at is null
      and coalesce(arp.result_status, 'active') not in ('cancelled', 'left')
  ) then
    raise exception 'Only current room players can request a rematch.';
  end if;

  update public.arena_rooms
  set
    rematch_requested_by = auth.uid(),
    rematch_requested_at = now()
  where id = target_room_id
    and mode in ('duel', 'group_lobby', 'party_mode')
    and status = 'finished';

  if not found then
    raise exception 'This Arena room is not ready for a rematch.';
  end if;

  return true;
end;
$$;

create or replace function public.reset_arena_room_for_rematch(
  target_room_id uuid,
  new_album_id text default null,
  new_album_name text default null,
  new_artist_name text default null,
  new_artwork_url text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from public.arena_room_players arp
    where arp.room_id = target_room_id
      and arp.user_id = auth.uid()
      and arp.left_at is null
      and coalesce(arp.result_status, 'active') not in ('cancelled', 'left')
  ) then
    raise exception 'Only the current host can start a rematch.';
  end if;

  update public.arena_rooms
  set
    status = 'waiting',
    album_id = coalesce(nullif(new_album_id, ''), album_id),
    album_name = coalesce(nullif(new_album_name, ''), album_name),
    artist_name = coalesce(nullif(new_artist_name, ''), artist_name),
    artwork_url = coalesce(nullif(new_artwork_url, ''), artwork_url),
    started_at = null,
    finished_at = null,
    expires_at = now() + interval '2 hours',
    quiz_questions = '[]'::jsonb,
    round_number = coalesce(round_number, 1) + 1,
    rematch_requested_by = null,
    rematch_requested_at = null
  where id = target_room_id
    and mode in ('duel', 'group_lobby', 'party_mode')
    and status in ('finished', 'cancelled')
    and host_user_id = auth.uid();

  if not found then
    raise exception 'Only the host can start a rematch.';
  end if;

  update public.arena_room_players
  set
    final_score = 0,
    correct_answers = 0,
    total_questions = 0,
    average_answer_time = 0,
    current_score = 0,
    current_correct_answers = 0,
    current_question_index = 0,
    current_streak = 0,
    is_ready = false,
    finished_at = null,
    forfeited_at = null,
    result_status = 'active'
  where room_id = target_room_id
    and left_at is null
    and coalesce(result_status, 'active') not in ('cancelled', 'left');

  return true;
end;
$$;

grant execute on function public.request_arena_rematch(uuid) to authenticated;
grant execute on function public.reset_arena_room_for_rematch(uuid, text, text, text, text) to authenticated;
grant execute on function public.close_arena_room(uuid) to authenticated;

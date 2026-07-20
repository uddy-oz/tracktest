-- Build Week multiplayer hardening: Party Mode, username uniqueness, and safer round lifecycle.

alter table public.arena_rooms
  drop constraint if exists arena_rooms_mode_check;

alter table public.arena_rooms
  add constraint arena_rooms_mode_check
  check (mode in ('duel', 'group_lobby', 'party_mode', 'championship'));

create unique index if not exists profiles_username_lower_unique_idx
  on public.profiles (lower(username))
  where username is not null and username <> '';

create index if not exists arena_rooms_mode_status_round_idx
  on public.arena_rooms (mode, status, round_number, created_at desc)
  where mode in ('duel', 'group_lobby', 'party_mode');

create index if not exists arena_room_players_room_result_idx
  on public.arena_room_players (room_id, result_status, finished_at, left_at);

create or replace function public.prepare_duel_room_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.mode in ('duel', 'group_lobby', 'party_mode') then
    if new.expires_at is null then
      new.expires_at := now() + interval '2 hours';
    end if;

    if exists (
      select 1
      from public.arena_rooms existing_room
      where existing_room.host_user_id = new.host_user_id
        and existing_room.mode in ('duel', 'group_lobby', 'party_mode')
        and (
          existing_room.status in ('waiting', 'starting', 'active')
          or (
            existing_room.status = 'finished'
            and existing_room.rematch_requested_by is not null
          )
        )
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

  if target_mode not in ('duel', 'group_lobby', 'party_mode') then
    return new;
  end if;

  if exists (
    select 1
    from public.arena_room_players existing_player
    join public.arena_rooms existing_room
      on existing_room.id = existing_player.room_id
    where existing_player.user_id = new.user_id
      and existing_player.left_at is null
      and coalesce(existing_player.result_status, 'active') not in ('cancelled', 'left')
      and existing_room.mode in ('duel', 'group_lobby', 'party_mode')
      and (
        existing_room.status in ('waiting', 'starting', 'active')
        or (
          existing_room.status = 'finished'
          and existing_room.rematch_requested_by is not null
        )
      )
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
    finished_at = coalesce(finished_at, now()),
    rematch_requested_by = null,
    rematch_requested_at = null
  where mode in ('duel', 'group_lobby', 'party_mode')
    and status = 'waiting'
    and coalesce(expires_at, created_at + interval '2 hours') < now();

  get diagnostics cancelled_count = row_count;

  update public.arena_rooms
  set
    status = 'cancelled',
    finished_at = coalesce(finished_at, now()),
    rematch_requested_by = null,
    rematch_requested_at = null
  where mode in ('duel', 'group_lobby', 'party_mode')
    and status = 'active'
    and coalesce(started_at, created_at) < now() - interval '90 minutes';

  get diagnostics active_cancelled_count = row_count;
  cancelled_count := cancelled_count + active_cancelled_count;

  return cancelled_count;
end;
$$;

create or replace function public.join_arena_room_by_invite(
  target_invite_code text,
  player_display_name text,
  player_username text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.arena_rooms%rowtype;
  present_count integer;
begin
  perform public.cancel_stale_arena_rooms();

  select *
  into target_room
  from public.arena_rooms
  where lower(invite_code) = lower(trim(target_invite_code))
  for update;

  if target_room.id is null then
    raise exception 'Invite not found.';
  end if;

  if target_room.status = 'cancelled' then
    raise exception 'This room was closed by the host.';
  end if;

  if target_room.status = 'finished' then
    raise exception 'The game has already finished.';
  end if;

  if target_room.status <> 'waiting' then
    raise exception 'This Arena room is no longer waiting.';
  end if;

  if coalesce(target_room.expires_at, target_room.created_at + interval '2 hours') <= now() then
    raise exception 'This Arena invite has expired.';
  end if;

  if target_room.host_user_id = auth.uid() then
    return target_room.id;
  end if;

  if exists (
    select 1
    from public.arena_room_players arp
    where arp.room_id = target_room.id
      and arp.user_id = auth.uid()
      and arp.left_at is null
      and coalesce(arp.result_status, 'active') not in ('cancelled', 'left')
  ) then
    return target_room.id;
  end if;

  if exists (
    select 1
    from public.arena_room_players existing_player
    join public.arena_rooms existing_room
      on existing_room.id = existing_player.room_id
    where existing_player.user_id = auth.uid()
      and existing_player.left_at is null
      and coalesce(existing_player.result_status, 'active') not in ('cancelled', 'left')
      and existing_room.mode in ('duel', 'group_lobby', 'party_mode')
      and (
        existing_room.status in ('waiting', 'starting', 'active')
        or (
          existing_room.status = 'finished'
          and existing_room.rematch_requested_by is not null
        )
      )
      and existing_room.id <> target_room.id
  ) then
    raise exception 'You are already in another active Arena room.';
  end if;

  select count(distinct arp.user_id)::integer
  into present_count
  from public.arena_room_players arp
  where arp.room_id = target_room.id
    and arp.left_at is null
    and coalesce(arp.result_status, 'active') not in ('cancelled', 'left', 'forfeit');

  if present_count >= target_room.max_players then
    raise exception 'This Arena room is already full.';
  end if;

  update public.arena_room_players
  set
    display_name = coalesce(nullif(player_display_name, ''), nullif(player_username, ''), 'Arena Player'),
    username = nullif(player_username, ''),
    left_at = null,
    forfeited_at = null,
    result_status = 'active'
  where room_id = target_room.id
    and user_id = auth.uid();

  if not found then
    insert into public.arena_room_players (
      room_id,
      user_id,
      display_name,
      username,
      left_at,
      result_status
    )
    values (
      target_room.id,
      auth.uid(),
      coalesce(nullif(player_display_name, ''), nullif(player_username, ''), 'Arena Player'),
      nullif(player_username, ''),
      null,
      'active'
    );
  end if;

  return target_room.id;
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
    left_at = null,
    result_status = 'active'
  where room_id = target_room_id
    and result_status not in ('cancelled', 'left');

  return true;
end;
$$;

create or replace function public.end_arena_room(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.arena_rooms
  set
    status = 'cancelled',
    finished_at = coalesce(finished_at, now()),
    rematch_requested_by = null,
    rematch_requested_at = null
  where id = target_room_id
    and mode in ('duel', 'group_lobby', 'party_mode')
    and host_user_id = auth.uid()
    and status in ('waiting', 'starting', 'active', 'finished');

  if not found then
    raise exception 'Only the host can end this Arena room.';
  end if;

  update public.arena_room_players
  set
    left_at = coalesce(left_at, now()),
    result_status = case
      when result_status in ('completed', 'forfeit', 'win_by_forfeit') then result_status
      else 'cancelled'
    end
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
declare
  target_room public.arena_rooms%rowtype;
  next_host uuid;
begin
  select *
  into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby', 'party_mode')
    and status in ('waiting', 'starting', 'finished');

  if target_room.id is null then
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

  if target_room.host_user_id = auth.uid() then
    if target_room.mode in ('group_lobby', 'party_mode') then
      select user_id
      into next_host
      from public.arena_room_players
      where room_id = target_room_id
        and left_at is null
      order by joined_at asc
      limit 1;

      if next_host is not null then
        update public.arena_rooms
        set host_user_id = next_host
        where id = target_room_id;
      else
        update public.arena_rooms
        set
          status = 'cancelled',
          finished_at = coalesce(finished_at, now()),
          rematch_requested_by = null,
          rematch_requested_at = null
        where id = target_room_id;
      end if;
    else
      update public.arena_rooms
      set
        status = 'cancelled',
        finished_at = coalesce(finished_at, now()),
        rematch_requested_by = null,
        rematch_requested_at = null
      where id = target_room_id;
    end if;
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
  target_mode text;
begin
  select coalesce(jsonb_array_length(quiz_questions), 0), mode
  into question_total, target_mode
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby', 'party_mode')
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
    result_status = 'forfeit'
  where room_id = target_room_id
    and user_id = auth.uid()
    and left_at is null;

  if not found then
    raise exception 'You are not in this Arena game.';
  end if;

  if target_mode = 'duel' then
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
    where id = target_room_id;

    return true;
  end if;

  select count(*)::integer
  into remaining_active_count
  from public.arena_room_players
  where room_id = target_room_id
    and left_at is null
    and finished_at is null;

  if remaining_active_count = 0 then
    update public.arena_rooms
    set
      status = 'finished',
      finished_at = coalesce(finished_at, now())
    where id = target_room_id;
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
begin
  if not public.is_arena_room_player(target_room_id, auth.uid()) then
    raise exception 'Only Arena room players can finish the room.';
  end if;

  select
    count(*) > 0
    and bool_and(finished_at is not null)
  into is_complete
  from public.arena_room_players
  where room_id = target_room_id
    and left_at is null
    and result_status not in ('cancelled', 'left');

  if is_complete then
    update public.arena_rooms
    set
      status = 'finished',
      finished_at = coalesce(finished_at, now())
    where id = target_room_id
      and mode in ('duel', 'group_lobby', 'party_mode')
      and status <> 'finished';
  end if;

  return coalesce(is_complete, false);
end;
$$;

grant execute on function public.prepare_duel_room_insert() to authenticated;
grant execute on function public.prevent_multiple_active_duel_rooms() to authenticated;
grant execute on function public.cancel_stale_arena_rooms() to authenticated;
grant execute on function public.join_arena_room_by_invite(text, text, text) to authenticated;
grant execute on function public.reset_arena_room_for_rematch(uuid, text, text, text, text) to authenticated;
grant execute on function public.end_arena_room(uuid) to authenticated;
grant execute on function public.leave_waiting_arena_room(uuid) to authenticated;
grant execute on function public.forfeit_arena_room(uuid) to authenticated;
grant execute on function public.finish_arena_room_if_complete(uuid) to authenticated;

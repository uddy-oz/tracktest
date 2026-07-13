alter table public.arena_rooms
  add column if not exists is_private boolean not null default false,
  add column if not exists invite_code text,
  add column if not exists round_number integer not null default 1,
  add column if not exists rematch_requested_by uuid references auth.users(id) on delete set null,
  add column if not exists rematch_requested_at timestamptz;

create unique index if not exists arena_rooms_invite_code_unique_idx
  on public.arena_rooms (invite_code)
  where invite_code is not null;

create index if not exists arena_rooms_public_waiting_idx
  on public.arena_rooms (mode, status, created_at desc)
  where status = 'waiting'
    and is_private = false;

create or replace function public.is_arena_room_waiting(target_room_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.arena_rooms ar
    where ar.id = target_room_id
      and ar.status = 'waiting'
      and coalesce(ar.is_private, false) = false
      and coalesce(ar.expires_at, ar.created_at + interval '2 hours') > now()
  );
$$;

drop policy if exists "Authenticated users can read waiting arena rooms" on public.arena_rooms;
drop policy if exists "Authenticated users can read public waiting arena rooms" on public.arena_rooms;

create policy "Authenticated users can read public waiting arena rooms"
  on public.arena_rooms
  for select
  to authenticated
  using (
    status = 'waiting'
    and coalesce(is_private, false) = false
    and coalesce(expires_at, created_at + interval '2 hours') > now()
  );

create or replace function public.get_arena_invite(target_invite_code text)
returns table (
  room_id uuid,
  mode text,
  status text,
  album_id text,
  album_name text,
  artist_name text,
  artwork_url text,
  max_players integer,
  is_private boolean,
  invite_code text,
  host_user_id uuid,
  host_display_name text,
  host_username text,
  player_count integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.cancel_stale_arena_rooms();

  return query
    select
      ar.id,
      ar.mode,
      ar.status,
      coalesce(ar.album_id, ''),
      coalesce(ar.album_name, 'Unknown album'),
      coalesce(ar.artist_name, 'Unknown artist'),
      coalesce(ar.artwork_url, ''),
      ar.max_players,
      coalesce(ar.is_private, false),
      coalesce(ar.invite_code, ''),
      ar.host_user_id,
      coalesce(nullif(p.display_name, ''), nullif(p.username, ''), 'Arena Host'),
      p.username,
      (
        select count(*)::integer
        from public.arena_room_players arp
        where arp.room_id = ar.id
          and arp.left_at is null
      ) as player_count,
      ar.expires_at
    from public.arena_rooms ar
    left join public.profiles p
      on p.id = ar.host_user_id
    where lower(ar.invite_code) = lower(trim(target_invite_code))
    limit 1;
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

  if target_room.status <> 'waiting' then
    raise exception 'This Arena room is no longer waiting.';
  end if;

  if coalesce(target_room.expires_at, target_room.created_at + interval '2 hours') <= now() then
    raise exception 'This Arena invite has expired.';
  end if;

  if exists (
    select 1
    from public.arena_room_players arp
    where arp.room_id = target_room.id
      and arp.user_id = auth.uid()
      and arp.left_at is null
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
      and existing_player.finished_at is null
      and existing_room.mode in ('duel', 'group_lobby')
      and existing_room.status in ('waiting', 'starting', 'active')
      and existing_room.id <> target_room.id
  ) then
    raise exception 'You are already in another active Arena room.';
  end if;

  select count(*)::integer
  into present_count
  from public.arena_room_players arp
  where arp.room_id = target_room.id
    and arp.left_at is null;

  if present_count >= target_room.max_players then
    raise exception 'This Arena room is already full.';
  end if;

  insert into public.arena_room_players (
    room_id,
    user_id,
    display_name,
    username
  )
  values (
    target_room.id,
    auth.uid(),
    coalesce(nullif(player_display_name, ''), nullif(player_username, ''), 'Arena Player'),
    nullif(player_username, '')
  );

  return target_room.id;
end;
$$;

create or replace function public.request_arena_rematch(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_arena_room_player(target_room_id, auth.uid()) then
    raise exception 'Only room players can request a rematch.';
  end if;

  update public.arena_rooms
  set
    rematch_requested_by = auth.uid(),
    rematch_requested_at = now()
  where id = target_room_id
    and mode in ('duel', 'group_lobby')
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
    and mode in ('duel', 'group_lobby')
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
    and mode in ('duel', 'group_lobby')
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
    and mode in ('duel', 'group_lobby')
    and status in ('waiting', 'starting');

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
    if target_room.mode = 'group_lobby' then
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
          finished_at = coalesce(finished_at, now())
        where id = target_room_id;
      end if;
    else
      update public.arena_rooms
      set
        status = 'cancelled',
        finished_at = coalesce(finished_at, now())
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
  target_host uuid;
  next_host uuid;
begin
  select coalesce(jsonb_array_length(quiz_questions), 0), mode, host_user_id
  into question_total, target_mode, target_host
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

  if target_mode = 'group_lobby' and target_host = auth.uid() then
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
    end if;
  end if;

  select count(*)::integer
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
      and mode in ('duel', 'group_lobby')
      and status <> 'finished';
  end if;

  return coalesce(is_complete, false);
end;
$$;

grant execute on function public.get_arena_invite(text) to authenticated;
grant execute on function public.get_arena_invite(text) to anon;
grant execute on function public.join_arena_room_by_invite(text, text, text) to authenticated;
grant execute on function public.request_arena_rematch(uuid) to authenticated;
grant execute on function public.reset_arena_room_for_rematch(uuid, text, text, text, text) to authenticated;
grant execute on function public.end_arena_room(uuid) to authenticated;
grant execute on function public.leave_waiting_arena_room(uuid) to authenticated;
grant execute on function public.forfeit_arena_room(uuid) to authenticated;
grant execute on function public.finish_arena_room_if_complete(uuid) to authenticated;

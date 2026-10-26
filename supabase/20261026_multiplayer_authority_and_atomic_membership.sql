begin;

-- Keep legacy SECURITY DEFINER routines that use public in their search path
-- from resolving attacker-created objects. Preserve schema USAGE for clients.
revoke create on schema public from public, anon, authenticated;

-- Clients may read room state, but all room and player mutations must pass
-- through the existing SECURITY DEFINER lifecycle/gameplay RPCs or the narrow
-- creation/join/identity RPCs below.
revoke insert, update, delete, truncate on table public.arena_rooms
  from public, anon, authenticated;
revoke insert, update, delete, truncate on table public.arena_room_players
  from public, anon, authenticated;

-- Also remove any historical column-level DML grants. REVOKE at table level
-- does not cancel grants made on individual columns.
do $$
declare
  target_table regclass;
  target_column record;
begin
  foreach target_table in array array[
    'public.arena_rooms'::regclass,
    'public.arena_room_players'::regclass
  ] loop
    for target_column in
      select a.attname
      from pg_catalog.pg_attribute a
      where a.attrelid = target_table
        and a.attnum > 0
        and not a.attisdropped
    loop
      execute pg_catalog.format(
        'revoke all (%I) on table %s from public, anon, authenticated',
        target_column.attname,
        target_table
      );
    end loop;
  end loop;
end;
$$;

drop policy if exists "Authenticated users can create arena rooms"
  on public.arena_rooms;
drop policy if exists "Room hosts can update their arena rooms"
  on public.arena_rooms;
drop policy if exists "Room players can update joined arena rooms"
  on public.arena_rooms;
drop policy if exists "Authenticated users can join arena rooms"
  on public.arena_room_players;
drop policy if exists "Players can update their arena room player rows"
  on public.arena_room_players;

-- Explicit SELECT grants preserve the existing RLS-governed room discovery and
-- member views even if project default privileges were broader than expected.
grant select on table public.arena_rooms, public.arena_room_players
  to authenticated;

create or replace function public.create_arena_room(
  room_mode text,
  selected_album_id text,
  selected_album_name text,
  selected_artist_name text,
  selected_artwork_url text,
  requested_max_players integer,
  room_is_private boolean,
  player_display_name text,
  player_username text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  new_room_id uuid;
  new_invite_code text;
  clean_display_name text := nullif(btrim(player_display_name), '');
  clean_username text := nullif(btrim(player_username), '');
begin
  if caller_id is null then
    raise exception 'Authentication is required.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 731942)
  );
  perform public.cancel_stale_arena_rooms();

  if room_mode not in ('duel', 'group_lobby', 'party_mode') then
    raise exception 'Unsupported Arena room mode.';
  end if;
  if selected_album_id is null or btrim(selected_album_id) = ''
     or selected_album_name is null or btrim(selected_album_name) = '' then
    raise exception 'Choose an album before creating a room.';
  end if;
  if clean_display_name is null or length(clean_display_name) > 48
     or coalesce(length(clean_username), 0) > 64 then
    raise exception 'Player identity is invalid.';
  end if;
  if (room_mode = 'duel' and requested_max_players <> 2)
     or (room_mode = 'group_lobby' and requested_max_players not between 3 and 10)
     or (room_mode = 'party_mode' and requested_max_players not between 3 and 30) then
    raise exception 'Player capacity is invalid for this mode.';
  end if;

  if exists (
    select 1
    from public.arena_room_players p
    join public.arena_rooms r on r.id = p.room_id
    where p.user_id = caller_id
      and p.left_at is null
      and coalesce(p.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
      and r.mode in ('duel', 'group_lobby', 'party_mode')
      and (
        r.status in ('waiting', 'starting', 'active')
        or (r.status = 'finished' and r.rematch_requested_by is not null)
      )
  ) then
    raise exception 'You already have an active Arena room.';
  end if;

  if coalesce(room_is_private, false) then
    loop
      new_invite_code := upper(substr(
        replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8
      ));
      exit when not exists (
        select 1 from public.arena_rooms r where r.invite_code = new_invite_code
      );
    end loop;
  end if;

  insert into public.arena_rooms (
    host_user_id, mode, status, album_id, album_name, artist_name,
    artwork_url, max_players, is_private, invite_code
  ) values (
    caller_id, room_mode, 'waiting', btrim(selected_album_id),
    btrim(selected_album_name), nullif(btrim(selected_artist_name), ''),
    nullif(btrim(selected_artwork_url), ''), requested_max_players,
    coalesce(room_is_private, false), new_invite_code
  ) returning id into new_room_id;

  insert into public.arena_room_players (
    room_id, user_id, display_name, username, presence_status,
    presence_updated_at, result_status
  ) values (
    new_room_id, caller_id, clean_display_name, clean_username,
    'connected', pg_catalog.clock_timestamp(), 'active'
  );

  return new_room_id;
end;
$$;

-- The shared helper serializes a user's joins across public and private rooms,
-- then locks the target room so concurrent joins cannot exceed capacity.
create or replace function public.join_arena_room_internal(
  target_room_id uuid,
  player_display_name text,
  player_username text,
  expected_invite_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_room public.arena_rooms%rowtype;
  clean_display_name text := nullif(btrim(player_display_name), '');
  clean_username text := nullif(btrim(player_username), '');
  active_count integer;
begin
  if caller_id is null then
    raise exception 'Authentication is required.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller_id::text, 731942)
  );

  select * into target_room
  from public.arena_rooms
  where id = target_room_id
  for update;

  if target_room.id is null then raise exception 'Arena room not found.'; end if;
  if target_room.mode not in ('duel', 'group_lobby', 'party_mode') then
    raise exception 'Unsupported Arena room mode.';
  end if;
  if target_room.is_private then
    if expected_invite_code is null
       or lower(target_room.invite_code) <> lower(btrim(expected_invite_code)) then
      raise exception 'This is a private room. Use its invite link.';
    end if;
  elsif expected_invite_code is not null then
    raise exception 'Invite not found.';
  end if;
  if target_room.status <> 'waiting' then
    raise exception 'This Arena room is no longer waiting.';
  end if;
  if coalesce(target_room.expires_at, target_room.created_at + interval '2 hours')
       <= pg_catalog.now() then
    raise exception 'This Arena room has expired.';
  end if;
  if clean_display_name is null or length(clean_display_name) > 48
     or coalesce(length(clean_username), 0) > 64 then
    raise exception 'Player identity is invalid.';
  end if;

  if exists (
    select 1 from public.arena_room_players p
    where p.room_id = target_room_id
      and p.user_id = caller_id
      and p.left_at is null
      and coalesce(p.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
  ) then
    return target_room.id;
  end if;

  if exists (
    select 1
    from public.arena_room_players p
    join public.arena_rooms r on r.id = p.room_id
    where p.user_id = caller_id
      and p.left_at is null
      and coalesce(p.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
      and r.mode in ('duel', 'group_lobby', 'party_mode')
      and (
        r.status in ('waiting', 'starting', 'active')
        or (r.status = 'finished' and r.rematch_requested_by is not null)
      )
      and r.id <> target_room_id
  ) then
    raise exception 'You are already in another active Arena room.';
  end if;

  select count(distinct p.user_id)::integer into active_count
  from public.arena_room_players p
  where p.room_id = target_room_id
    and p.left_at is null
    and coalesce(p.result_status, 'active') not in ('cancelled', 'left', 'forfeit');

  if active_count >= target_room.max_players then
    raise exception 'This Arena room is already full.';
  end if;

  update public.arena_room_players
  set display_name = clean_display_name,
      username = clean_username,
      left_at = null,
      finished_at = null,
      forfeited_at = null,
      lobby_ready = false,
      is_ready = false,
      presence_status = 'connected',
      presence_updated_at = pg_catalog.clock_timestamp(),
      result_status = 'active'
  where room_id = target_room_id and user_id = caller_id;

  if not found then
    insert into public.arena_room_players (
      room_id, user_id, display_name, username, presence_status,
      presence_updated_at, result_status
    ) values (
      target_room_id, caller_id, clean_display_name, clean_username,
      'connected', pg_catalog.clock_timestamp(), 'active'
    );
  end if;

  return target_room.id;
end;
$$;

create or replace function public.join_public_arena_room(
  target_room_id uuid,
  player_display_name text,
  player_username text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select public.join_arena_room_internal(
    target_room_id, player_display_name, player_username, null
  );
$$;

create or replace function public.join_arena_room_by_invite(
  target_invite_code text,
  player_display_name text,
  player_username text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_room_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  select id into found_room_id
  from public.arena_rooms
  where lower(invite_code) = lower(btrim(target_invite_code))
  limit 1;
  if found_room_id is null then raise exception 'Invite not found.'; end if;
  return public.join_arena_room_internal(
    found_room_id, player_display_name, player_username, target_invite_code
  );
end;
$$;

create or replace function public.set_arena_guest_display_name(
  target_room_id uuid,
  player_display_name text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  clean_display_name text := nullif(btrim(player_display_name), '');
  caller_is_anonymous boolean;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select coalesce(u.is_anonymous, false) into caller_is_anonymous
  from auth.users u where u.id = caller_id;
  if not coalesce(caller_is_anonymous, false) then
    raise exception 'This operation is limited to temporary guest accounts.';
  end if;
  if clean_display_name is null or length(clean_display_name) > 48 then
    raise exception 'Player identity is invalid.';
  end if;

  perform 1 from public.arena_rooms
  where id = target_room_id and status = 'waiting'
  for update;
  if not found then raise exception 'Arena room is no longer waiting.'; end if;

  update public.arena_room_players
  set display_name = clean_display_name
  where room_id = target_room_id
    and user_id = caller_id
    and left_at is null
    and coalesce(result_status, 'active') = 'active';
  if not found then raise exception 'Active room membership is required.'; end if;
  return true;
end;
$$;

revoke all on function public.create_arena_room(text, text, text, text, text, integer, boolean, text, text)
  from public, anon;
grant execute on function public.create_arena_room(text, text, text, text, text, integer, boolean, text, text)
  to authenticated;
revoke all on function public.join_arena_room_internal(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.join_public_arena_room(uuid, text, text)
  from public, anon;
grant execute on function public.join_public_arena_room(uuid, text, text)
  to authenticated;
revoke all on function public.join_arena_room_by_invite(text, text, text)
  from public, anon;
grant execute on function public.join_arena_room_by_invite(text, text, text)
  to authenticated;
revoke all on function public.set_arena_guest_display_name(uuid, text)
  from public, anon;
grant execute on function public.set_arena_guest_display_name(uuid, text)
  to authenticated;

-- Solo result inserts remain client-submitted, but Arena results must only be
-- inserted for a finished room and a real participant. The preceding
-- derive_competitive_progression trigger replaces submitted scoring fields
-- with the authoritative arena_room_players snapshot for valid participants.
create or replace function public.guard_arena_quiz_result_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
begin
  if new.game_mode = 'single_player' and new.arena_room_id is null then
    return new;
  end if;

  if new.game_mode = 'single_player' or new.arena_room_id is null then
    raise exception 'Arena results must reference their completed room.';
  end if;

  select * into target_room
  from public.arena_rooms
  where id = new.arena_room_id;

  if target_room.id is null or target_room.status <> 'finished' then
    raise exception 'Arena results are only available after the room is finished.';
  end if;

  if not exists (
    select 1
    from public.arena_room_players player
    where player.room_id = target_room.id
      and player.user_id = new.user_id
      and coalesce(player.result_status, 'active') not in ('cancelled', 'left')
  ) then
    raise exception 'Arena result player is not a member of the completed room.';
  end if;

  if new.game_mode <> target_room.mode then
    raise exception 'Arena result mode does not match the completed room.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_arena_quiz_result_source()
  from public, anon, authenticated;
drop trigger if exists guard_arena_quiz_result_source
  on public.quiz_results;
create trigger guard_arena_quiz_result_source
  before insert on public.quiz_results
  for each row
  execute function public.guard_arena_quiz_result_source();

commit;

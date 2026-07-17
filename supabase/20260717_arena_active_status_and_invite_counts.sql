-- Tighten Arena active-room recovery and private invite counts.
-- Active recovery/blocking is intentionally limited to waiting, starting, and active rooms.

create index if not exists arena_rooms_active_recovery_idx
  on public.arena_rooms (mode, status, created_at desc)
  where status in ('waiting', 'starting', 'active');

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
      and coalesce(arp.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
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
      and coalesce(existing_player.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
      and existing_room.mode in ('duel', 'group_lobby')
      and existing_room.status in ('waiting', 'starting', 'active')
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

  if not exists (
    select 1
    from public.arena_room_players host_player
    where host_player.room_id = target_room.id
      and host_player.user_id = target_room.host_user_id
      and host_player.left_at is null
      and coalesce(host_player.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
  ) then
    present_count := present_count + 1;
  end if;

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
      and coalesce(existing_player.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
      and existing_room.mode in ('duel', 'group_lobby')
      and existing_room.status in ('waiting', 'starting', 'active')
      and existing_room.id <> new.room_id
  ) then
    raise exception 'User is already in an active Arena room.';
  end if;

  return new;
end;
$$;

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
    with invite_room as (
      select *
      from public.arena_rooms ar
      where lower(ar.invite_code) = lower(trim(target_invite_code))
      limit 1
    ),
    present_counts as (
      select
        ir.id as room_id,
        count(distinct arp.user_id)::integer as current_members,
        bool_or(arp.user_id = ir.host_user_id)::boolean as has_host_member
      from invite_room ir
      left join public.arena_room_players arp
        on arp.room_id = ir.id
       and arp.left_at is null
       and coalesce(arp.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
      group by ir.id
    )
    select
      ir.id,
      ir.mode,
      ir.status,
      coalesce(ir.album_id, ''),
      coalesce(ir.album_name, 'Unknown album'),
      coalesce(ir.artist_name, 'Unknown artist'),
      coalesce(ir.artwork_url, ''),
      ir.max_players,
      coalesce(ir.is_private, false),
      coalesce(ir.invite_code, ''),
      ir.host_user_id,
      coalesce(nullif(p.display_name, ''), nullif(p.username, ''), 'Arena Host'),
      p.username,
      case
        when ir.status in ('waiting', 'starting', 'active')
          and not coalesce(pc.has_host_member, false)
          then coalesce(pc.current_members, 0) + 1
        else coalesce(pc.current_members, 0)
      end as player_count,
      ir.expires_at
    from invite_room ir
    left join present_counts pc
      on pc.room_id = ir.id
    left join public.profiles p
      on p.id = ir.host_user_id;
end;
$$;

grant execute on function public.join_arena_room_by_invite(text, text, text) to authenticated;
grant execute on function public.prevent_multiple_active_duel_rooms() to authenticated;
grant execute on function public.get_arena_invite(text) to authenticated;
grant execute on function public.get_arena_invite(text) to anon;

-- Multiplayer recovery and invite hardening.
-- This migration is additive/idempotent and keeps private rooms out of public room lists.

alter table public.arena_rooms
  add column if not exists is_private boolean not null default false,
  add column if not exists invite_code text,
  add column if not exists round_number integer not null default 1,
  add column if not exists rematch_requested_by uuid references auth.users(id) on delete set null,
  add column if not exists rematch_requested_at timestamptz;

alter table public.arena_room_players
  add column if not exists left_at timestamptz,
  add column if not exists forfeited_at timestamptz,
  add column if not exists result_status text not null default 'active',
  add column if not exists current_score integer not null default 0,
  add column if not exists current_correct_answers integer not null default 0,
  add column if not exists current_question_index integer not null default 0,
  add column if not exists current_streak integer not null default 0;

with ranked_active_memberships as (
  select
    id,
    row_number() over (
      partition by room_id, user_id
      order by joined_at asc, id asc
    ) as membership_rank
  from public.arena_room_players
  where left_at is null
)
update public.arena_room_players arp
set
  left_at = coalesce(arp.left_at, now()),
  result_status = case
    when arp.result_status in ('completed', 'forfeit', 'win_by_forfeit') then arp.result_status
    else 'left'
  end
from ranked_active_memberships ranked
where arp.id = ranked.id
  and ranked.membership_rank > 1;

create unique index if not exists arena_room_players_active_room_user_unique_idx
  on public.arena_room_players (room_id, user_id)
  where left_at is null;

create unique index if not exists arena_rooms_invite_code_unique_idx
  on public.arena_rooms (invite_code)
  where invite_code is not null;

create index if not exists arena_room_players_recovery_idx
  on public.arena_room_players (user_id, left_at, room_id);

create index if not exists arena_rooms_recovery_status_idx
  on public.arena_rooms (mode, status, created_at desc)
  where status in ('waiting', 'countdown', 'starting', 'active', 'submitted');

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
      and existing_room.mode in ('duel', 'group_lobby')
      and (
        existing_room.status in ('waiting', 'countdown', 'starting', 'active', 'submitted')
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
    and arp.left_at is null;

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
      and existing_room.mode in ('duel', 'group_lobby')
      and (
        existing_room.status in ('waiting', 'countdown', 'starting', 'active', 'submitted')
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
        select count(distinct arp.user_id)::integer
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

grant execute on function public.join_arena_room_by_invite(text, text, text) to authenticated;
grant execute on function public.prevent_multiple_active_duel_rooms() to authenticated;
grant execute on function public.get_arena_invite(text) to authenticated;
grant execute on function public.get_arena_invite(text) to anon;

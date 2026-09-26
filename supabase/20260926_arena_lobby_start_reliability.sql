begin;

-- Private rooms are created before their host player row. The previous invite
-- function returned early for the host, leaving the room visible but without
-- authoritative host membership. Let the normal upsert path add the host too.
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
  target_room public.arena_rooms%rowtype;
  present_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  perform public.cancel_stale_arena_rooms();

  select * into target_room
  from public.arena_rooms
  where lower(invite_code) = lower(trim(target_invite_code))
  for update;

  if target_room.id is null then raise exception 'Invite not found.'; end if;
  if target_room.status = 'cancelled' then raise exception 'This room was closed by the host.'; end if;
  if target_room.status = 'finished' then raise exception 'The game has already finished.'; end if;
  if target_room.status <> 'waiting' then raise exception 'This Arena room is no longer waiting.'; end if;
  if coalesce(target_room.expires_at, target_room.created_at + interval '2 hours') <= now() then
    raise exception 'This Arena invite has expired.';
  end if;

  if exists (
    select 1 from public.arena_room_players arp
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
    join public.arena_rooms existing_room on existing_room.id = existing_player.room_id
    where existing_player.user_id = auth.uid()
      and existing_player.left_at is null
      and coalesce(existing_player.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
      and existing_room.mode in ('duel', 'group_lobby', 'party_mode')
      and (
        existing_room.status in ('waiting', 'starting', 'active')
        or (existing_room.status = 'finished' and existing_room.rematch_requested_by is not null)
      )
      and existing_room.id <> target_room.id
  ) then
    raise exception 'You are already in another active Arena room.';
  end if;

  select count(distinct arp.user_id)::integer into present_count
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
    finished_at = null,
    forfeited_at = null,
    result_status = 'active'
  where room_id = target_room.id and user_id = auth.uid();

  if not found then
    insert into public.arena_room_players (
      room_id, user_id, display_name, username, left_at, result_status
    ) values (
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

revoke all on function public.join_arena_room_by_invite(text, text, text)
  from public, anon;
grant execute on function public.join_arena_room_by_invite(text, text, text)
  to authenticated;

commit;

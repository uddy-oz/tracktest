begin;

-- Anonymous players keep their public display name on the room membership,
-- not in profiles. Prefer that value in invite previews without exposing IDs.
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
set search_path = ''
as $$
begin
  perform public.cancel_stale_arena_rooms();

  return query
    with invite_room as (
      select *
      from public.arena_rooms ar
      where pg_catalog.lower(ar.invite_code) = pg_catalog.lower(pg_catalog.btrim(target_invite_code))
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
      coalesce(
        nullif(host_player.display_name, ''),
        nullif(p.display_name, ''),
        nullif(p.username, ''),
        'Arena Host'
      ),
      coalesce(nullif(host_player.username, ''), p.username),
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
    left join public.arena_room_players host_player
      on host_player.room_id = ir.id
     and host_player.user_id = ir.host_user_id
     and host_player.left_at is null
     and coalesce(host_player.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
    left join public.profiles p
      on p.id = ir.host_user_id;
end;
$$;

revoke all on function public.get_arena_invite(text) from public;
grant execute on function public.get_arena_invite(text) to authenticated, anon;

commit;

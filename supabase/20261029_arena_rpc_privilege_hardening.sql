begin;

-- Anonymous visitors may inspect invite metadata and public rankings, but
-- account-bound Arena operations require an authenticated Supabase identity.
-- Anonymous Supabase guest sessions use the authenticated database role.
do $$
declare
  target_function regprocedure;
begin
  foreach target_function in array array[
    'public.cancel_stale_arena_rooms()'::regprocedure,
    'public.close_arena_room(uuid)'::regprocedure,
    'public.close_duel_room(uuid)'::regprocedure,
    'public.finish_arena_room_if_complete(uuid)'::regprocedure,
    'public.finish_duel_room_if_complete(uuid)'::regprocedure,
    'public.forfeit_arena_room(uuid)'::regprocedure,
    'public.forfeit_duel_room(uuid)'::regprocedure,
    'public.join_arena_room_by_invite(text,text,text)'::regprocedure,
    'public.leave_arena_room(uuid)'::regprocedure,
    'public.leave_waiting_arena_room(uuid)'::regprocedure,
    'public.leave_waiting_duel_room(uuid)'::regprocedure,
    'public.request_arena_rematch(uuid)'::regprocedure,
    'public.skip_party_question_v2(uuid,integer,integer)'::regprocedure,
    'public.start_prepared_party_question(uuid,integer,integer,text)'::regprocedure,
    'public.is_arena_room_player(uuid,uuid)'::regprocedure,
    'public.is_arena_room_waiting(uuid)'::regprocedure
  ] loop
    execute pg_catalog.format('revoke all on function %s from public, anon', target_function);
    execute pg_catalog.format('grant execute on function %s to authenticated', target_function);
  end loop;

  -- Cleanup is used by authenticated room discovery and SECURITY DEFINER
  -- application RPCs, but must never be directly invocable by anon.
  revoke all on function public.cancel_stale_arena_rooms() from public, anon;
  grant execute on function public.cancel_stale_arena_rooms() to authenticated;

  -- The legacy Duel cleanup function has no current client caller. Keep it
  -- callable only by its owner/internal SECURITY DEFINER routines.
  revoke all on function public.cancel_stale_duel_rooms() from public, anon;
  revoke all on function public.cancel_stale_duel_rooms() from authenticated;
end;
$$;

-- Trigger functions are callable only by their installed triggers, never by
-- clients as RPCs. Remove inherited/default PUBLIC execution grants.
revoke all on function public.clear_arena_ready_on_new_generation() from public, anon, authenticated;
revoke all on function public.guard_arena_lobby_start_readiness() from public, anon, authenticated;
revoke all on function public.normalize_arena_player_rejoin() from public, anon, authenticated;
revoke all on function public.prepare_duel_room_insert() from public, anon, authenticated;
revoke all on function public.prevent_multiple_active_duel_rooms() from public, anon, authenticated;

-- Keep the public invite endpoint intentionally callable, but replace any
-- older body which ran global cleanup as a side effect of an anonymous read.
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
      end,
      ir.expires_at
    from invite_room ir
    left join present_counts pc on pc.room_id = ir.id
    left join public.arena_room_players host_player
      on host_player.room_id = ir.id
     and host_player.user_id = ir.host_user_id
     and host_player.left_at is null
     and coalesce(host_player.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
    left join public.profiles p on p.id = ir.host_user_id;
end;
$$;

revoke all on function public.get_arena_invite(text) from public;
grant execute on function public.get_arena_invite(text) to authenticated, anon;

commit;

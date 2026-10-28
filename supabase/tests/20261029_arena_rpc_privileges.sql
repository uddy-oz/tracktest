-- Run on an isolated local/staging database after the release migrations.
-- Read-only catalog assertions; safe to rerun.
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
    if has_function_privilege('anon', target_function, 'EXECUTE') then
      raise exception 'Unauthenticated role can execute protected Arena RPC %', target_function;
    end if;
    if not has_function_privilege('authenticated', target_function, 'EXECUTE') then
      raise exception 'Authenticated role lost required Arena RPC %', target_function;
    end if;
  end loop;

  if has_function_privilege('authenticated', 'public.cancel_stale_duel_rooms()'::regprocedure, 'EXECUTE')
     or has_function_privilege('anon', 'public.cancel_stale_duel_rooms()'::regprocedure, 'EXECUTE') then
    raise exception 'Unused legacy Duel cleanup RPC must not be client-executable.';
  end if;

  if not has_function_privilege('anon', 'public.get_arena_invite(text)'::regprocedure, 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_arena_invite(text)'::regprocedure, 'EXECUTE') then
    raise exception 'Public invite preview access must remain available.';
  end if;

  if pg_catalog.strpos(
    pg_catalog.lower(pg_catalog.pg_get_functiondef('public.get_arena_invite(text)'::regprocedure)),
    'perform public.cancel_stale_arena_rooms()'
  ) > 0 then
    raise exception 'Invite preview still invokes global stale-room cleanup.';
  end if;

  foreach target_function in array array[
    'public.clear_arena_ready_on_new_generation()'::regprocedure,
    'public.guard_arena_lobby_start_readiness()'::regprocedure,
    'public.normalize_arena_player_rejoin()'::regprocedure,
    'public.prepare_duel_room_insert()'::regprocedure,
    'public.prevent_multiple_active_duel_rooms()'::regprocedure
  ] loop
    if has_function_privilege('anon', target_function, 'EXECUTE')
       or has_function_privilege('authenticated', target_function, 'EXECUTE') then
      raise exception 'Trigger-only Arena function is directly executable: %', target_function;
    end if;
  end loop;
end;
$$;

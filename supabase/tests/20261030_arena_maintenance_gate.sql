-- Run only against a disposable local clone after applying the maintenance
-- migration. The transaction rolls back all fixtures and state changes.
begin;

do $$
declare
  test_user_id uuid;
  test_room_id uuid := '10000000-0000-4000-8000-000000003001';
  blocked boolean;
begin
  select u.id into test_user_id
  from auth.users u
  where not exists (
    select 1 from public.arena_room_players player where player.user_id = u.id
  )
  and not exists (
    select 1 from public.arena_rooms room
    where room.host_user_id = u.id
      and (room.status in ('waiting', 'starting', 'active')
        or (room.status = 'finished' and room.rematch_requested_by is not null))
  )
  order by u.created_at
  limit 1;
  if test_user_id is null then
    raise exception 'Maintenance gate test requires one disposable local auth user.';
  end if;

  if not exists (
    select 1 from arena_private.runtime_controls
    where control_name = 'multiplayer_maintenance' and enabled
  ) then
    raise exception 'Migration must install the gate enabled.';
  end if;

  update arena_private.runtime_controls set enabled = false
  where control_name = 'multiplayer_maintenance';

  insert into public.arena_rooms (id, host_user_id, mode, status, album_id, album_name, max_players)
  values (test_room_id, test_user_id, 'duel', 'waiting', 'maintenance-test', 'Maintenance Test', 2);
  insert into public.arena_room_players (room_id, user_id, display_name, result_status)
  values (test_room_id, test_user_id, 'Maintenance Host', 'active');

  update arena_private.runtime_controls set enabled = true
  where control_name = 'multiplayer_maintenance';

  begin
    insert into public.arena_rooms (host_user_id, mode, status, album_id, album_name, max_players)
    values (test_user_id, 'duel', 'waiting', 'blocked-test', 'Blocked Test', 2);
    raise exception 'Expected room creation to be blocked.';
  exception when sqlstate '55000' then blocked := true;
  end;
  if not blocked then raise exception 'Room insert was not blocked.'; end if;

  blocked := false;
  begin
    insert into public.arena_room_players (room_id, user_id, display_name)
    values (test_room_id, gen_random_uuid(), 'Blocked Join');
    raise exception 'Expected membership insertion to be blocked.';
  exception when sqlstate '55000' then blocked := true;
  end;
  if not blocked then raise exception 'Membership insert was not blocked.'; end if;

  blocked := false;
  begin
    update public.arena_rooms set status = 'starting' where id = test_room_id;
    raise exception 'Expected match start to be blocked.';
  exception when sqlstate '55000' then blocked := true;
  end;
  if not blocked then raise exception 'Match start was not blocked.'; end if;

  blocked := false;
  begin
    update public.arena_rooms set status = 'active' where id = test_room_id;
    raise exception 'Expected direct Party/competitive activation to be blocked.';
  exception when sqlstate '55000' then blocked := true;
  end;
  if not blocked then raise exception 'Direct room activation was not blocked.'; end if;

  update public.arena_rooms
  set status = 'finished', finished_at = pg_catalog.clock_timestamp()
  where id = test_room_id;
  update public.arena_room_players
  set final_score = 500, correct_answers = 1, finished_at = pg_catalog.clock_timestamp(),
      left_at = pg_catalog.clock_timestamp(), result_status = 'left'
  where room_id = test_room_id and user_id = test_user_id;

  blocked := false;
  begin
    update public.arena_room_players
    set left_at = null, result_status = 'active'
    where room_id = test_room_id and user_id = test_user_id;
    raise exception 'Expected membership reactivation to be blocked.';
  exception when sqlstate '55000' then blocked := true;
  end;
  if not blocked then raise exception 'Membership reactivation was not blocked.'; end if;

  if has_table_privilege('authenticated', 'arena_private.runtime_controls', 'select')
     or has_table_privilege('anon', 'arena_private.runtime_controls', 'select')
     or has_table_privilege('service_role', 'arena_private.runtime_controls', 'select') then
    raise exception 'A client role can read the maintenance control table.';
  end if;

  update arena_private.runtime_controls set enabled = false
  where control_name = 'multiplayer_maintenance';

  insert into public.arena_rooms (host_user_id, mode, status, album_id, album_name, max_players)
  values (test_user_id, 'duel', 'waiting', 'unlocked-test', 'Unlocked Test', 2);

  raise notice 'Maintenance gate blocks room creation, joins, and starts; unlock permits creation.';
end;
$$;

rollback;

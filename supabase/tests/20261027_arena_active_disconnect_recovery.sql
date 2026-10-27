-- Run only against the isolated local Supabase database after applying
-- 20261027_arena_active_disconnect_recovery.sql. All fixtures are rolled back.
begin;

insert into auth.users (id, aud, role, email, is_anonymous)
values
  ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'pr3-host-duel@test.invalid', false),
  ('00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'pr3-player-duel@test.invalid', false),
  ('00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'pr3-guest-duel@test.invalid', true),
  ('00000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'pr3-player-guest@test.invalid', false),
  ('00000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'pr3-party-host@test.invalid', false),
  ('00000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'pr3-party-player@test.invalid', false),
  ('00000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'pr3-group-host@test.invalid', false),
  ('00000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'pr3-group-next-host@test.invalid', false),
  ('00000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'pr3-group-player@test.invalid', false),
  ('00000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'pr3-reconnect-host@test.invalid', false),
  ('00000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'pr3-reconnect-player@test.invalid', false),
  ('00000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'pr3-stale-duel-host@test.invalid', false),
  ('00000000-0000-4000-8000-000000000013', 'authenticated', 'authenticated', 'pr3-stale-duel-player@test.invalid', false),
  ('00000000-0000-4000-8000-000000000014', 'authenticated', 'authenticated', 'pr3-party-leave-host@test.invalid', false),
  ('00000000-0000-4000-8000-000000000015', 'authenticated', 'authenticated', 'pr3-party-leave-player@test.invalid', false);

insert into public.arena_rooms (id, host_user_id, mode, status, album_name, quiz_questions)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'duel', 'active', 'Duel host leave', '[{}, {}, {}, {}, {}]'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004', 'duel', 'active', 'Guest leave', '[{}, {}, {}, {}, {}]'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000005', 'party_mode', 'active', 'Party host timeout', '[{}, {}, {}, {}, {}]'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000007', 'group_lobby', 'active', 'Group host timeout', '[{}, {}, {}, {}, {}]'),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000010', 'duel', 'active', 'Reconnect grace', '[{}, {}, {}, {}, {}]'),
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000012', 'duel', 'active', 'Duel host timeout', '[{}, {}, {}, {}, {}]'),
  ('10000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000014', 'party_mode', 'active', 'Party host leave', '[{}, {}, {}, {}, {}]');

insert into public.arena_room_players (
  room_id, user_id, display_name, current_score, current_correct_answers,
  round_points, rounds_won, rounds_played, presence_updated_at
)
values
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 'Host', 3, 3, 3, 3, 4, now()),
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'Player', 2, 2, 2, 2, 4, now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000004', 'Host', 1, 1, 1, 1, 4, now()),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003', 'Guest', 2, 2, 2, 2, 4, now()),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000005', 'Party Host', 0, 0, 0, 0, 0, now() - interval '60 seconds'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000006', 'Party Player', 0, 0, 0, 0, 0, now()),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000007', 'Group Host', 2, 2, 2, 2, 4, now() - interval '60 seconds'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000008', 'Next Host', 1, 1, 1, 1, 4, now()),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000009', 'Player', 0, 0, 0, 0, 4, now()),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000010', 'Reconnect Host', 0, 0, 0, 0, 0, now() - interval '20 seconds'),
  ('10000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000011', 'Player', 0, 0, 0, 0, 0, now()),
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000012', 'Stale Host', 2, 2, 2, 2, 3, now() - interval '60 seconds'),
  ('10000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000013', 'Player', 1, 1, 1, 1, 3, now()),
  ('10000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000014', 'Party Host', 0, 0, 0, 0, 0, now()),
  ('10000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000015', 'Party Player', 0, 0, 0, 0, 0, now());

-- Host departure in Duel must yield a win to the opponent, not cancel the match.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select public.leave_arena_room('10000000-0000-4000-8000-000000000001');
reset role;
do $$ begin
  if (select status from public.arena_rooms where id = '10000000-0000-4000-8000-000000000001') <> 'finished'
    or (select result_status from public.arena_room_players where room_id = '10000000-0000-4000-8000-000000000001' and user_id = '00000000-0000-4000-8000-000000000001') <> 'forfeit'
    or (select result_status from public.arena_room_players where room_id = '10000000-0000-4000-8000-000000000001' and user_id = '00000000-0000-4000-8000-000000000002') <> 'win_by_forfeit'
  then raise exception 'Host departure did not resolve the Duel fairly.'; end if;
end $$;

-- Repeated forfeit calls must be harmless and progression stays one row/player.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select public.leave_arena_room('10000000-0000-4000-8000-000000000001');
reset role;
do $$ begin
  if (select count(*) from public.quiz_results where arena_room_id = '10000000-0000-4000-8000-000000000001') <> 2
  then raise exception 'Repeated forfeit duplicated progression rows.'; end if;
end $$;

-- Leaving from the finished results view must not overwrite the winner state.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
set local role authenticated;
select public.leave_arena_room('10000000-0000-4000-8000-000000000001');
reset role;
do $$ begin
  if (select result_status from public.arena_room_players where room_id = '10000000-0000-4000-8000-000000000001' and user_id = '00000000-0000-4000-8000-000000000002') <> 'win_by_forfeit'
    or (select status from public.arena_rooms where id = '10000000-0000-4000-8000-000000000001') <> 'finished'
  then raise exception 'Post-game leave rewrote the completed Duel result.'; end if;
end $$;

-- A stale active Duel host is forfeited and the connected opponent wins.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000013', true);
set local role authenticated;
select public.reconcile_arena_room_presence('10000000-0000-4000-8000-000000000006');
reset role;
do $$ begin
  if (select status from public.arena_rooms where id = '10000000-0000-4000-8000-000000000006') <> 'finished'
    or (select result_status from public.arena_room_players where room_id = '10000000-0000-4000-8000-000000000006' and user_id = '00000000-0000-4000-8000-000000000012') <> 'forfeit'
    or (select result_status from public.arena_room_players where room_id = '10000000-0000-4000-8000-000000000006' and user_id = '00000000-0000-4000-8000-000000000013') <> 'win_by_forfeit'
  then raise exception 'Stale Duel host did not resolve fairly.'; end if;
end $$;

-- A guest non-host leaving gets the same fair Duel resolution.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select public.leave_arena_room('10000000-0000-4000-8000-000000000002');
reset role;
do $$ begin
  if (select status from public.arena_rooms where id = '10000000-0000-4000-8000-000000000002') <> 'finished'
    or (select result_status from public.arena_room_players where room_id = '10000000-0000-4000-8000-000000000002' and user_id = '00000000-0000-4000-8000-000000000003') <> 'forfeit'
    or (select result_status from public.arena_room_players where room_id = '10000000-0000-4000-8000-000000000002' and user_id = '00000000-0000-4000-8000-000000000004') <> 'win_by_forfeit'
  then raise exception 'Guest departure did not resolve the Duel fairly.'; end if;
end $$;

-- Party host departure is an explicit room cancellation, not host transfer.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000014', true);
set local role authenticated;
select public.leave_arena_room('10000000-0000-4000-8000-000000000007');
reset role;
do $$ begin
  if (select status from public.arena_rooms where id = '10000000-0000-4000-8000-000000000007') <> 'cancelled'
    or (select close_reason from public.arena_rooms where id = '10000000-0000-4000-8000-000000000007') <> 'host_ended'
  then raise exception 'Party host departure did not cancel the room.'; end if;
end $$;

-- Party Mode cancels if the host stays absent beyond the reconnect window.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000006', true);
set local role authenticated;
select public.reconcile_arena_room_presence('10000000-0000-4000-8000-000000000003');
reset role;
do $$ begin
  if (select status from public.arena_rooms where id = '10000000-0000-4000-8000-000000000003') <> 'cancelled'
    or (select close_reason from public.arena_rooms where id = '10000000-0000-4000-8000-000000000003') <> 'host_disconnected'
  then raise exception 'Party did not close after host disconnect timeout.'; end if;
end $$;

-- Group mode remains active and transfers host ownership to a connected player.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000009', true);
set local role authenticated;
select public.reconcile_arena_room_presence('10000000-0000-4000-8000-000000000004');
reset role;
do $$ begin
  if (select status from public.arena_rooms where id = '10000000-0000-4000-8000-000000000004') <> 'active'
    or (select host_user_id from public.arena_rooms where id = '10000000-0000-4000-8000-000000000004') <> '00000000-0000-4000-8000-000000000008'
    or (select result_status from public.arena_room_players where room_id = '10000000-0000-4000-8000-000000000004' and user_id = '00000000-0000-4000-8000-000000000007') <> 'forfeit'
  then raise exception 'Group host handoff failed.'; end if;
end $$;

-- A refresh/network interruption shorter than 45 seconds keeps the game active.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000010', true);
set local role authenticated;
select public.reconcile_arena_room_presence('10000000-0000-4000-8000-000000000005');
select public.heartbeat_arena_room_presence('10000000-0000-4000-8000-000000000005');
reset role;
do $$ begin
  if (select status from public.arena_rooms where id = '10000000-0000-4000-8000-000000000005') <> 'active'
    or (select presence_status from public.arena_room_players where room_id = '10000000-0000-4000-8000-000000000005' and user_id = '00000000-0000-4000-8000-000000000010') <> 'connected'
  then raise exception 'Reconnect grace did not restore the active player.'; end if;
end $$;

rollback;

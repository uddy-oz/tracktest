begin;
set local lock_timeout = '3s';

alter table public.arena_rooms
  add column if not exists unified_friends boolean not null default false;

-- Use the existing authenticated atomic creator and its collision-safe code.
create or replace function public.create_friends_room(
  selected_album_id text, selected_album_name text, selected_artist_name text,
  selected_artwork_url text, room_is_private boolean,
  player_display_name text, player_username text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare created_room_id uuid;
begin
  created_room_id := public.create_arena_room(
    'group_lobby', selected_album_id, selected_album_name, selected_artist_name,
    selected_artwork_url, 10, true, player_display_name, player_username
  );
  update public.arena_rooms
  set unified_friends = true, is_private = coalesce(room_is_private, false)
  where id = created_room_id;
  return created_room_id;
end;
$$;

create or replace function public.activate_friends_question_set(
  target_room_id uuid, target_question_set_id uuid,
  expected_player_ids uuid[], expected_album_id text
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_room public.arena_rooms%rowtype;
  target_set arena_private.question_sets%rowtype;
  roster uuid[];
begin
  -- Lock the room first, in the same order as membership and start RPCs.
  select * into target_room from public.arena_rooms
  where id = target_room_id for update;
  if caller_id is null or target_room.id is null or not target_room.unified_friends
     or target_room.host_user_id <> caller_id then
    raise exception 'Only the host can start this Friends room.';
  end if;
  select * into target_set from arena_private.question_sets
  where id = target_question_set_id and room_id = target_room_id for update;
  if target_set.id is null or target_set.host_user_id <> caller_id
     or target_set.round_number <> target_room.round_number
     or target_set.mode <> target_room.mode then
    raise exception 'Prepare a fresh question set for this match.';
  end if;
  if target_room.status in ('starting', 'active') and target_set.activated_at is not null then
    return public.activate_arena_question_set(target_room_id, target_question_set_id);
  end if;
  if target_room.status <> 'waiting' or target_room.mode <> 'group_lobby'
     or target_room.album_id is distinct from expected_album_id then
    raise exception 'The room or album changed. Refresh and start again.';
  end if;
  select array_agg(p.user_id order by p.user_id) into roster
  from public.arena_room_players p
  where p.room_id = target_room_id and p.left_at is null
    and p.finished_at is null and p.forfeited_at is null
    and coalesce(p.result_status, 'active') not in ('cancelled', 'left', 'forfeit');
  if coalesce(cardinality(roster), 0) not between 2 and target_room.max_players
     or not (caller_id = any(roster))
     or roster is distinct from (
       select array_agg(e.id order by e.id) from unnest(expected_player_ids) e(id)
     ) then
    raise exception 'The player roster changed. Review readiness and start again.';
  end if;
  if cardinality(roster) = 2 then
    update public.arena_rooms set mode = 'duel' where id = target_room_id;
    update arena_private.question_sets set mode = 'duel' where id = target_question_set_id;
  end if;
  -- The existing engine checks every ready flag and stages the shared clock
  -- under the same lock. A rejection rolls back both format updates above.
  return public.activate_arena_question_set(target_room_id, target_question_set_id);
end;
$$;

-- Only a new generation returns to expandable waiting-room rules.
create or replace function arena_private.reset_friends_waiting_format()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.unified_friends and new.status = 'waiting'
     and new.round_number > old.round_number then
    new.mode := 'group_lobby';
  end if;
  return new;
end;
$$;

drop trigger if exists reset_friends_waiting_format on public.arena_rooms;
create trigger reset_friends_waiting_format before update of status, round_number
on public.arena_rooms for each row execute function arena_private.reset_friends_waiting_format();

revoke all on function public.create_friends_room(text,text,text,text,boolean,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.activate_friends_question_set(uuid,uuid,uuid[],text)
  from public, anon, authenticated, service_role;
revoke all on function arena_private.reset_friends_waiting_format()
  from public, anon, authenticated, service_role;
grant execute on function public.create_friends_room(text,text,text,text,boolean,text,text)
  to authenticated;
grant execute on function public.activate_friends_question_set(uuid,uuid,uuid[],text)
  to authenticated;

-- Friends room mode can vary by rematch. Historical rows retain the mode
-- saved by the authoritative finalizer in their own generation.
create or replace view public.public_profile_recent_results as
select
  qr.id, qr.user_id, p.username,
  coalesce(nullif(p.display_name, ''), nullif(p.username, ''), 'Unknown Player') as display_name,
  qr.album_name, qr.artist_name, qr.total_questions, qr.correct_answers,
  qr.accuracy, qr.final_points, qr.average_answer_time, qr.played_at,
  case when ar.unified_friends then qr.game_mode
       else coalesce(ar.mode, qr.game_mode, 'single_player') end as game_mode,
  qr.is_private, qr.is_winner, qr.was_host, qr.player_count, qr.placement,
  qr.score_margin, qr.result_status, qr.scoring_model, qr.round_points,
  qr.rounds_won, qr.rounds_played, qr.average_winning_response_time,
  qr.fastest_winning_response_time, qr.multiplayer_outcome,
  qr.competitive_progression_eligible, qr.clean_sheet, qr.opponent_round_wins,
  qr.opponents_defeated, qr.comeback_win, qr.dominant_win
from public.quiz_results qr
join public.profiles p on p.id = qr.user_id
left join public.arena_rooms ar on ar.id = qr.arena_room_id
where p.username is not null;

notify pgrst, 'reload schema';
commit;

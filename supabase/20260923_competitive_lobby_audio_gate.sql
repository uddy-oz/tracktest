begin;

-- Stage competitive questions before the room becomes active. This gives every
-- Duel/Group client time to unlock and preload round one without consuming the
-- authoritative countdown or answer window.
create or replace function public.prepare_competitive_arena_room(
  target_room_id uuid,
  target_questions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
  player_count integer;
  minimum_players integer;
  staged_round_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select * into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby')
    and status in ('waiting', 'starting')
    and host_user_id = auth.uid()
  for update;

  if target_room.id is null then
    raise exception 'Only the host can prepare this waiting competitive room.';
  end if;

  -- A repeated host request must not replace the round token after clients have
  -- started preparing it.
  if target_room.status = 'starting'
    and target_room.competitive_round_id is not null
  then
    return jsonb_build_object(
      'prepared', true,
      'roundId', target_room.competitive_round_id,
      'alreadyPrepared', true
    );
  end if;

  if jsonb_typeof(target_questions) <> 'array'
    or jsonb_array_length(target_questions) = 0
  then
    raise exception 'Competitive questions are required.';
  end if;

  minimum_players := case when target_room.mode = 'duel' then 2 else 3 end;

  select count(*)::integer into player_count
  from public.arena_room_players arp
  where arp.room_id = target_room_id
    and arp.left_at is null
    and arp.finished_at is null
    and coalesce(arp.result_status, 'active') not in (
      'cancelled', 'left', 'forfeit'
    );

  if player_count < minimum_players then
    raise exception 'Not enough players to start this room.';
  end if;

  staged_round_id := gen_random_uuid();

  delete from public.arena_competitive_answers
  where room_id = target_room_id
    and room_round_number = coalesce(target_room.round_number, 1);

  delete from public.arena_competitive_audio_readiness
  where room_id = target_room_id
    and room_round_number = coalesce(target_room.round_number, 1);

  update public.arena_room_players
  set
    is_ready = false,
    final_score = 0,
    correct_answers = 0,
    total_questions = 0,
    average_answer_time = 0,
    current_score = 0,
    current_correct_answers = 0,
    current_question_index = 0,
    current_streak = 0,
    round_points = 0,
    rounds_won = 0,
    rounds_played = 0,
    winning_response_total_ms = 0,
    average_winning_response_ms = 0,
    fastest_winning_response_ms = null,
    competitive_answered_question_index = -1,
    competitive_selected_answer = null,
    competitive_answer_was_correct = null,
    finished_at = null,
    forfeited_at = null,
    result_status = 'active'
  where room_id = target_room_id
    and left_at is null
    and coalesce(result_status, 'active') not in ('cancelled', 'left');

  update public.arena_rooms
  set
    status = 'starting',
    started_at = null,
    finished_at = null,
    quiz_questions = target_questions,
    competitive_question_index = 0,
    competitive_round_id = staged_round_id,
    competitive_round_phase = 'preparing_audio',
    competitive_answer_starts_at = null,
    competitive_answer_ends_at = null,
    competitive_reveal_ends_at = null,
    competitive_round_winner_user_id = null,
    competitive_winning_answer_at = null,
    competitive_winning_response_ms = null,
    competitive_audio_prepare_started_at = clock_timestamp(),
    competitive_audio_ready_deadline_at = null,
    competitive_required_ready_count = player_count,
    competitive_ready_count = 0,
    competitive_audio_failed = false,
    competitive_audio_failure_reason = null
  where id = target_room_id;

  return jsonb_build_object(
    'prepared', true,
    'roundId', staged_round_id,
    'requiredCount', player_count
  );
end;
$$;

create or replace function public.acknowledge_competitive_lobby_audio_ready(
  target_room_id uuid,
  target_round_id uuid,
  target_preview_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
  expected_preview_url text;
  required_count integer;
  ready_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select * into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby')
    and status = 'starting'
  for update;

  if target_room.id is null then
    return jsonb_build_object('accepted', false, 'inactiveRoom', true);
  end if;

  if target_room.competitive_round_id is distinct from target_round_id
    or target_room.competitive_question_index <> 0
    or target_room.competitive_round_phase <> 'preparing_audio'
  then
    return jsonb_build_object('accepted', false, 'staleRound', true);
  end if;

  if not exists (
    select 1 from public.arena_room_players arp
    where arp.room_id = target_room_id
      and arp.user_id = auth.uid()
      and arp.left_at is null
      and arp.finished_at is null
      and coalesce(arp.result_status, 'active') not in (
        'cancelled', 'left', 'forfeit'
      )
  ) then
    raise exception 'You are not an active player in this room.';
  end if;

  expected_preview_url := target_room.quiz_questions
    -> 0 -> 'correctTrack' ->> 'previewUrl';

  if expected_preview_url is null
    or expected_preview_url = ''
    or target_preview_url is distinct from expected_preview_url
  then
    raise exception 'Audio readiness does not match the staged question.';
  end if;

  update public.arena_room_players
  set is_ready = true
  where room_id = target_room_id
    and user_id = auth.uid()
    and left_at is null
    and finished_at is null;

  insert into public.arena_competitive_audio_readiness (
    room_id, room_round_number, round_id, question_index, user_id,
    preview_url, readiness_status, failure_reason, acknowledged_at
  ) values (
    target_room_id,
    coalesce(target_room.round_number, 1),
    target_round_id,
    0,
    auth.uid(),
    target_preview_url,
    'ready',
    null,
    clock_timestamp()
  )
  on conflict (room_id, room_round_number, round_id, user_id)
  do update set
    question_index = 0,
    preview_url = excluded.preview_url,
    readiness_status = 'ready',
    failure_reason = null,
    acknowledged_at = excluded.acknowledged_at;

  select count(*)::integer into required_count
  from public.arena_room_players arp
  where arp.room_id = target_room_id
    and arp.left_at is null
    and arp.finished_at is null
    and coalesce(arp.result_status, 'active') not in (
      'cancelled', 'left', 'forfeit'
    );

  select count(*)::integer into ready_count
  from public.arena_room_players arp
  where arp.room_id = target_room_id
    and arp.is_ready
    and arp.left_at is null
    and arp.finished_at is null
    and coalesce(arp.result_status, 'active') not in (
      'cancelled', 'left', 'forfeit'
    );

  update public.arena_rooms
  set
    competitive_required_ready_count = required_count,
    competitive_ready_count = ready_count
  where id = target_room_id;

  return jsonb_build_object(
    'accepted', true,
    'requiredCount', required_count,
    'readyCount', ready_count,
    'allReady', required_count > 0 and ready_count >= required_count
  );
end;
$$;

create or replace function public.start_prepared_competitive_arena_room(
  target_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
  required_count integer;
  ready_count integer;
  minimum_players integer;
  server_starts_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select * into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby')
    and status in ('starting', 'active')
    and host_user_id = auth.uid()
  for update;

  if target_room.id is null then
    raise exception 'Only the host can start this prepared competitive room.';
  end if;

  if target_room.status = 'active' then
    return jsonb_build_object('started', true, 'alreadyStarted', true);
  end if;

  select count(*)::integer into required_count
  from public.arena_room_players arp
  where arp.room_id = target_room_id
    and arp.left_at is null
    and arp.finished_at is null
    and coalesce(arp.result_status, 'active') not in (
      'cancelled', 'left', 'forfeit'
    );

  select count(*)::integer into ready_count
  from public.arena_room_players arp
  where arp.room_id = target_room_id
    and arp.is_ready
    and arp.left_at is null
    and arp.finished_at is null
    and coalesce(arp.result_status, 'active') not in (
      'cancelled', 'left', 'forfeit'
    );

  minimum_players := case when target_room.mode = 'duel' then 2 else 3 end;

  if required_count < minimum_players or ready_count < required_count then
    return jsonb_build_object(
      'started', false,
      'requiredCount', required_count,
      'readyCount', ready_count
    );
  end if;

  server_starts_at := clock_timestamp() + interval '3 seconds';

  update public.arena_rooms
  set
    status = 'active',
    started_at = clock_timestamp(),
    competitive_round_phase = 'countdown',
    competitive_answer_starts_at = server_starts_at,
    competitive_answer_ends_at = server_starts_at + interval '10 seconds',
    competitive_audio_ready_deadline_at = null,
    competitive_required_ready_count = required_count,
    competitive_ready_count = ready_count
  where id = target_room_id;

  return jsonb_build_object(
    'started', true,
    'requiredCount', required_count,
    'readyCount', ready_count,
    'answerStartsAt', server_starts_at
  );
end;
$$;

revoke all on function public.prepare_competitive_arena_room(uuid, jsonb)
  from public, anon;
revoke all on function public.acknowledge_competitive_lobby_audio_ready(uuid, uuid, text)
  from public, anon;
revoke all on function public.start_prepared_competitive_arena_room(uuid)
  from public, anon;

grant execute on function public.prepare_competitive_arena_room(uuid, jsonb)
  to authenticated;
grant execute on function public.acknowledge_competitive_lobby_audio_ready(uuid, uuid, text)
  to authenticated;
grant execute on function public.start_prepared_competitive_arena_room(uuid)
  to authenticated;

commit;

begin;

-- A global audio skip is a preparation outcome. Once countdown begins, the
-- readiness barrier is closed and no delayed client failure may move the round
-- backwards into reveal.
create or replace function public.apply_competitive_audio_skip(
  target_room_id uuid,
  target_round_id uuid,
  target_question_index integer,
  failure_reason text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
  server_now timestamptz := clock_timestamp();
begin
  select * into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby')
    and status = 'active'
  for update;

  if target_room.id is null
    or target_room.competitive_round_id is distinct from target_round_id
    or target_room.competitive_question_index <> target_question_index
    or target_room.competitive_round_phase <> 'preparing_audio'
  then
    return false;
  end if;

  insert into public.arena_competitive_answers (
    room_id, room_round_number, round_id, question_index, user_id,
    answer_text, is_correct, is_round_winner, response_time_ms, submitted_at
  )
  select
    target_room_id,
    coalesce(target_room.round_number, 1),
    target_round_id,
    target_question_index,
    arp.user_id,
    null,
    false,
    false,
    10000,
    server_now
  from public.arena_room_players arp
  where arp.room_id = target_room_id
    and arp.left_at is null
    and arp.finished_at is null
    and coalesce(arp.result_status, 'active') not in (
      'cancelled', 'left', 'forfeit'
    )
  on conflict (room_id, room_round_number, question_index, user_id) do nothing;

  update public.arena_room_players
  set
    rounds_played = rounds_played + 1,
    current_question_index = greatest(
      current_question_index,
      target_question_index + 1
    ),
    current_streak = 0
  where room_id = target_room_id
    and left_at is null
    and finished_at is null
    and coalesce(result_status, 'active') not in (
      'cancelled', 'left', 'forfeit'
    );

  update public.arena_rooms
  set
    competitive_round_phase = 'reveal',
    competitive_answer_starts_at = null,
    competitive_answer_ends_at = null,
    competitive_reveal_ends_at = server_now + interval '2.5 seconds',
    competitive_round_winner_user_id = null,
    competitive_winning_answer_at = null,
    competitive_winning_response_ms = null,
    competitive_audio_ready_deadline_at = null,
    competitive_audio_failed = true,
    competitive_audio_failure_reason = left(
      coalesce(nullif(failure_reason, ''), 'Audio readiness failed.'),
      240
    )
  where id = target_room_id;

  return true;
end;
$$;

-- Keep the existing public signature, but reject valid-looking late failures
-- after the server has crossed the readiness barrier.
create or replace function public.report_competitive_audio_failure(
  target_room_id uuid,
  target_round_id uuid,
  target_question_index integer,
  target_preview_url text,
  failure_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
  expected_preview_url text;
  did_skip boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select * into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby')
    and status = 'active'
  for update;

  if target_room.id is null then
    return jsonb_build_object('accepted', false, 'inactiveRoom', true);
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
    return jsonb_build_object('accepted', false, 'inactivePlayer', true);
  end if;

  expected_preview_url := target_room.quiz_questions
    -> target_question_index
    -> 'correctTrack'
    ->> 'previewUrl';

  if target_room.competitive_round_id is distinct from target_round_id
    or target_room.competitive_question_index <> target_question_index
  then
    return jsonb_build_object('accepted', false, 'staleRound', true);
  end if;

  if target_room.competitive_round_phase <> 'preparing_audio' then
    return jsonb_build_object(
      'accepted', false,
      'readinessClosed', true,
      'phase', target_room.competitive_round_phase
    );
  end if;

  if target_preview_url is distinct from coalesce(expected_preview_url, '') then
    raise exception 'Audio failure does not match the authoritative question.';
  end if;

  insert into public.arena_competitive_audio_readiness (
    room_id, room_round_number, round_id, question_index, user_id,
    preview_url, readiness_status, failure_reason, acknowledged_at
  ) values (
    target_room_id,
    coalesce(target_room.round_number, 1),
    target_round_id,
    target_question_index,
    auth.uid(),
    target_preview_url,
    'failed',
    left(coalesce(failure_reason, 'Audio readiness failed.'), 240),
    clock_timestamp()
  )
  on conflict (room_id, room_round_number, round_id, user_id)
  do update set
    readiness_status = 'failed',
    failure_reason = excluded.failure_reason,
    acknowledged_at = excluded.acknowledged_at;

  did_skip := public.apply_competitive_audio_skip(
    target_room_id,
    target_round_id,
    target_question_index,
    failure_reason
  );

  return jsonb_build_object(
    'accepted', did_skip,
    'skippedForEveryone', did_skip
  );
end;
$$;

-- Late boundary timers are expected with polling, tab restore, and Realtime.
-- Validate the caller before delegating, and return false instead of turning a
-- harmless stale call into an HTTP 400 after the player or room has finished.
create or replace function public.sync_competitive_arena_timeline_v2(
  target_room_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  perform 1
    from public.arena_rooms room
    join public.arena_room_players player
      on player.room_id = room.id
    where room.id = target_room_id
      and room.mode in ('duel', 'group_lobby')
      and room.status = 'active'
      and player.user_id = auth.uid()
      and player.left_at is null
      and player.finished_at is null
      and coalesce(player.result_status, 'active') not in (
        'cancelled', 'left', 'forfeit'
      )
    for update of room, player;

  if not found then
    return false;
  end if;

  return public.sync_competitive_arena_timeline(target_room_id);
end;
$$;

revoke all on function public.apply_competitive_audio_skip(uuid, uuid, integer, text)
  from public, anon, authenticated;
revoke all on function public.report_competitive_audio_failure(uuid, uuid, integer, text, text)
  from public, anon;
revoke all on function public.sync_competitive_arena_timeline_v2(uuid)
  from public, anon;

grant execute on function public.report_competitive_audio_failure(uuid, uuid, integer, text, text)
  to authenticated;
grant execute on function public.sync_competitive_arena_timeline_v2(uuid)
  to authenticated;

commit;

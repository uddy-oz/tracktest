begin;

-- Competitive matches keep scored questions in quiz_questions and unused
-- candidates in a separate reserve queue. Existing timeline/scoring functions
-- therefore continue to use the same authoritative question count.
alter table public.arena_rooms
  add column if not exists competitive_target_question_count integer,
  add column if not exists competitive_reserve_questions jsonb not null default '[]'::jsonb,
  add column if not exists competitive_reserve_replacements integer not null default 0;

alter table public.arena_rooms
  drop constraint if exists arena_rooms_competitive_target_question_count_check;
alter table public.arena_rooms
  add constraint arena_rooms_competitive_target_question_count_check
  check (
    competitive_target_question_count is null
    or competitive_target_question_count > 0
  );

alter table public.arena_rooms
  drop constraint if exists arena_rooms_competitive_reserve_questions_check;
alter table public.arena_rooms
  add constraint arena_rooms_competitive_reserve_questions_check
  check (jsonb_typeof(competitive_reserve_questions) = 'array');

-- Rematches must never inherit candidates or metrics from the prior match.
create or replace function public.clear_competitive_audio_state_on_idle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.competitive_round_phase = 'idle' then
    new.competitive_audio_prepare_started_at := null;
    new.competitive_audio_ready_deadline_at := null;
    new.competitive_required_ready_count := 0;
    new.competitive_ready_count := 0;
    new.competitive_audio_failed := false;
    new.competitive_audio_failure_reason := null;
    new.competitive_target_question_count := null;
    new.competitive_reserve_questions := '[]'::jsonb;
    new.competitive_reserve_replacements := 0;
  end if;
  return new;
end;
$$;

-- The v2 entry point splits an oversized candidate pool before delegating to
-- the deployed lobby preparation function. Old clients and old databases keep
-- their original two-argument path unchanged.
create or replace function public.prepare_competitive_arena_room_v2(
  target_room_id uuid,
  target_questions jsonb,
  target_question_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  question_total integer;
  primary_questions jsonb;
  reserve_questions jsonb;
  preparation jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if jsonb_typeof(target_questions) <> 'array' then
    raise exception 'Competitive questions are required.';
  end if;

  question_total := jsonb_array_length(target_questions);
  if target_question_count < 1 or target_question_count > question_total then
    raise exception 'Competitive target question count is invalid.';
  end if;

  select
    coalesce(
      jsonb_agg(item.value order by item.ordinality)
        filter (where item.ordinality <= target_question_count),
      '[]'::jsonb
    ),
    coalesce(
      jsonb_agg(item.value order by item.ordinality)
        filter (where item.ordinality > target_question_count),
      '[]'::jsonb
    )
  into primary_questions, reserve_questions
  from jsonb_array_elements(target_questions) with ordinality
    as item(value, ordinality);

  preparation := public.prepare_competitive_arena_room(
    target_room_id,
    primary_questions
  );

  if coalesce((preparation ->> 'alreadyPrepared')::boolean, false) then
    return preparation;
  end if;

  update public.arena_rooms
  set
    competitive_target_question_count = target_question_count,
    competitive_reserve_questions = reserve_questions,
    competitive_reserve_replacements = 0
  where id = target_room_id
    and host_user_id = auth.uid()
    and mode in ('duel', 'group_lobby')
    and status = 'starting';

  if not found then
    raise exception 'Prepared competitive room could not be finalized.';
  end if;

  return preparation || jsonb_build_object(
    'targetQuestionCount', target_question_count,
    'reserveCount', jsonb_array_length(reserve_questions)
  );
end;
$$;

-- This keeps the same internal signature used by the deployed timeline. Before
-- countdown it promotes a reserve candidate atomically. Only when no reserve
-- remains does an active round become a visible skipped reveal.
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
  replacement_question jsonb;
  remaining_reserves jsonb;
  replacement_round_id uuid;
begin
  select * into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby')
    and status in ('starting', 'active')
  for update;

  if target_room.id is null
    or target_room.competitive_round_id is distinct from target_round_id
    or target_room.competitive_question_index <> target_question_index
    or target_room.competitive_round_phase <> 'preparing_audio'
  then
    return false;
  end if;

  if jsonb_array_length(
    coalesce(target_room.competitive_reserve_questions, '[]'::jsonb)
  ) > 0 then
    replacement_question := target_room.competitive_reserve_questions -> 0;
    remaining_reserves := target_room.competitive_reserve_questions - 0;
    replacement_round_id := gen_random_uuid();

    update public.arena_rooms
    set
      quiz_questions = jsonb_set(
        quiz_questions,
        array[target_question_index::text],
        replacement_question,
        false
      ),
      competitive_reserve_questions = remaining_reserves,
      competitive_reserve_replacements =
        competitive_reserve_replacements + 1,
      competitive_round_id = replacement_round_id,
      competitive_round_phase = 'preparing_audio',
      competitive_answer_starts_at = null,
      competitive_answer_ends_at = null,
      competitive_reveal_ends_at = null,
      competitive_round_winner_user_id = null,
      competitive_winning_answer_at = null,
      competitive_winning_response_ms = null,
      competitive_audio_prepare_started_at = server_now,
      competitive_audio_ready_deadline_at = case
        when status = 'active' then server_now + interval '4 seconds'
        else null
      end,
      competitive_ready_count = 0,
      competitive_audio_failed = false,
      competitive_audio_failure_reason = null
    where id = target_room_id;

    if target_room.status = 'starting' then
      update public.arena_room_players
      set is_ready = false
      where room_id = target_room_id
        and left_at is null
        and finished_at is null
        and coalesce(result_status, 'active') not in (
          'cancelled', 'left', 'forfeit'
        );
    end if;

    return true;
  end if;

  -- During the pre-game gate there is no fair round to score or skip. Keep the
  -- room staged so the UI can ask for another album or a manual retry.
  if target_room.status = 'starting' then
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
      coalesce(nullif(failure_reason, ''), 'UNKNOWN: Audio readiness failed.'),
      240
    )
  where id = target_room_id;

  return true;
end;
$$;

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
  resulting_room public.arena_rooms%rowtype;
  expected_preview_url text;
  did_recover boolean;
  was_replaced boolean;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select * into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby')
    and status in ('starting', 'active')
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
    -> target_question_index -> 'correctTrack' ->> 'previewUrl';

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
    left(coalesce(failure_reason, 'UNKNOWN: Audio readiness failed.'), 240),
    clock_timestamp()
  )
  on conflict (room_id, room_round_number, round_id, user_id)
  do update set
    readiness_status = 'failed',
    failure_reason = excluded.failure_reason,
    acknowledged_at = excluded.acknowledged_at;

  did_recover := public.apply_competitive_audio_skip(
    target_room_id,
    target_round_id,
    target_question_index,
    failure_reason
  );

  select * into resulting_room
  from public.arena_rooms
  where id = target_room_id;

  was_replaced := did_recover
    and resulting_room.competitive_round_id is distinct from target_round_id
    and resulting_room.competitive_round_phase = 'preparing_audio';

  return jsonb_build_object(
    'accepted', did_recover,
    'replacementStaged', was_replaced,
    'skippedForEveryone', did_recover and not was_replaced,
    'noReserve', not did_recover
      and jsonb_array_length(
        coalesce(resulting_room.competitive_reserve_questions, '[]'::jsonb)
      ) = 0,
    'roundId', resulting_room.competitive_round_id,
    'reserveCount', jsonb_array_length(
      coalesce(resulting_room.competitive_reserve_questions, '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.prepare_competitive_arena_room_v2(uuid, jsonb, integer)
  from public, anon;
revoke all on function public.apply_competitive_audio_skip(uuid, uuid, integer, text)
  from public, anon, authenticated;
revoke all on function public.report_competitive_audio_failure(uuid, uuid, integer, text, text)
  from public, anon;

grant execute on function public.prepare_competitive_arena_room_v2(uuid, jsonb, integer)
  to authenticated;
grant execute on function public.report_competitive_audio_failure(uuid, uuid, integer, text, text)
  to authenticated;

commit;

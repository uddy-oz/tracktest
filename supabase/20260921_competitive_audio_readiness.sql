begin;

-- Competitive rounds now wait for every active Duel/Group client to buffer the
-- exact preview and seek to the shared clip start before the server publishes
-- the countdown. Party Mode keeps its separate host-only audio authority.
alter table public.arena_rooms
  add column if not exists competitive_audio_prepare_started_at timestamptz,
  add column if not exists competitive_audio_ready_deadline_at timestamptz,
  add column if not exists competitive_required_ready_count integer not null default 0,
  add column if not exists competitive_ready_count integer not null default 0,
  add column if not exists competitive_audio_failed boolean not null default false,
  add column if not exists competitive_audio_failure_reason text;

alter table public.arena_rooms
  drop constraint if exists arena_rooms_competitive_round_phase_check;

alter table public.arena_rooms
  add constraint arena_rooms_competitive_round_phase_check
  check (
    competitive_round_phase in (
      'idle',
      'preparing_audio',
      'countdown',
      'answering',
      'reveal',
      'finished'
    )
  );

create table if not exists public.arena_competitive_audio_readiness (
  room_id uuid not null references public.arena_rooms(id) on delete cascade,
  room_round_number integer not null,
  round_id uuid not null,
  question_index integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  preview_url text not null,
  readiness_status text not null,
  failure_reason text,
  acknowledged_at timestamptz not null default clock_timestamp(),
  primary key (room_id, room_round_number, round_id, user_id),
  constraint arena_competitive_audio_readiness_status_check
    check (readiness_status in ('ready', 'failed'))
);

create index if not exists arena_competitive_audio_readiness_round_idx
  on public.arena_competitive_audio_readiness (
    room_id,
    room_round_number,
    round_id,
    readiness_status
  );

alter table public.arena_competitive_audio_readiness enable row level security;
revoke all on public.arena_competitive_audio_readiness from anon, authenticated;

-- Old rematch code already changes the phase to idle. This trigger ensures the
-- new readiness fields cannot leak from a completed round into a rematch.
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
  end if;
  return new;
end;
$$;

drop trigger if exists clear_competitive_audio_state_on_idle
  on public.arena_rooms;
create trigger clear_competitive_audio_state_on_idle
before insert or update of competitive_round_phase on public.arena_rooms
for each row execute function public.clear_competitive_audio_state_on_idle();

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
    or target_room.competitive_round_phase not in (
      'preparing_audio', 'countdown', 'answering'
    )
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

revoke all on function public.apply_competitive_audio_skip(uuid, uuid, integer, text)
  from public, anon, authenticated;

create or replace function public.start_competitive_arena_room(
  target_room_id uuid,
  target_questions jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
  player_count integer;
  minimum_players integer;
  server_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select * into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby')
    and status = 'waiting'
    and host_user_id = auth.uid()
  for update;

  if target_room.id is null then
    raise exception 'Only the host can start this waiting competitive room.';
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
    and coalesce(arp.result_status, 'active') not in (
      'cancelled', 'left', 'forfeit'
    );

  if player_count < minimum_players then
    raise exception 'Not enough players to start this room.';
  end if;

  delete from public.arena_competitive_answers
  where room_id = target_room_id
    and room_round_number = coalesce(target_room.round_number, 1);

  delete from public.arena_competitive_audio_readiness
  where room_id = target_room_id
    and room_round_number = coalesce(target_room.round_number, 1);

  update public.arena_room_players
  set
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
    status = 'active',
    started_at = server_now,
    finished_at = null,
    quiz_questions = target_questions,
    competitive_question_index = 0,
    competitive_round_id = gen_random_uuid(),
    competitive_round_phase = 'preparing_audio',
    competitive_answer_starts_at = null,
    competitive_answer_ends_at = null,
    competitive_reveal_ends_at = null,
    competitive_round_winner_user_id = null,
    competitive_winning_answer_at = null,
    competitive_winning_response_ms = null,
    competitive_audio_prepare_started_at = server_now,
    competitive_audio_ready_deadline_at = server_now + interval '12 seconds',
    competitive_required_ready_count = player_count,
    competitive_ready_count = 0,
    competitive_audio_failed = false,
    competitive_audio_failure_reason = null
  where id = target_room_id;

  return true;
end;
$$;

create or replace function public.acknowledge_competitive_audio_ready(
  target_room_id uuid,
  target_round_id uuid,
  target_question_index integer,
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
  server_starts_at timestamptz;
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
    raise exception 'This competitive room is not active.';
  end if;

  if target_room.competitive_round_id is distinct from target_round_id
    or target_room.competitive_question_index <> target_question_index
  then
    return jsonb_build_object('accepted', false, 'staleRound', true);
  end if;

  if target_room.competitive_round_phase <> 'preparing_audio' then
    return jsonb_build_object(
      'accepted', false,
      'phase', target_room.competitive_round_phase
    );
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
    -> target_question_index
    -> 'correctTrack'
    ->> 'previewUrl';

  if expected_preview_url is null
    or expected_preview_url = ''
    or target_preview_url is distinct from expected_preview_url
  then
    raise exception 'Audio readiness does not match the authoritative question.';
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
    'ready',
    null,
    clock_timestamp()
  )
  on conflict (room_id, room_round_number, round_id, user_id)
  do update set
    question_index = excluded.question_index,
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
  from public.arena_competitive_audio_readiness ar
  join public.arena_room_players arp
    on arp.room_id = ar.room_id and arp.user_id = ar.user_id
  where ar.room_id = target_room_id
    and ar.room_round_number = coalesce(target_room.round_number, 1)
    and ar.round_id = target_round_id
    and ar.question_index = target_question_index
    and ar.readiness_status = 'ready'
    and arp.left_at is null
    and arp.finished_at is null
    and coalesce(arp.result_status, 'active') not in (
      'cancelled', 'left', 'forfeit'
    );

  if required_count > 0 and ready_count >= required_count then
    server_starts_at := clock_timestamp() + interval '3 seconds';
    update public.arena_rooms
    set
      competitive_round_phase = 'countdown',
      competitive_answer_starts_at = server_starts_at,
      competitive_answer_ends_at = server_starts_at + interval '10 seconds',
      competitive_audio_ready_deadline_at = null,
      competitive_required_ready_count = required_count,
      competitive_ready_count = ready_count
    where id = target_room_id;
  else
    update public.arena_rooms
    set
      competitive_required_ready_count = required_count,
      competitive_ready_count = ready_count
    where id = target_room_id;
  end if;

  return jsonb_build_object(
    'accepted', true,
    'requiredCount', required_count,
    'readyCount', ready_count,
    'phase', case
      when required_count > 0 and ready_count >= required_count
        then 'countdown'
      else 'preparing_audio'
    end,
    'answerStartsAt', server_starts_at
  );
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
    raise exception 'This competitive room is not active.';
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
    raise exception 'Only room members can report competitive audio failure.';
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

  return jsonb_build_object('accepted', did_skip, 'skippedForEveryone', did_skip);
end;
$$;

create or replace function public.sync_competitive_arena_timeline(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
  question_total integer;
  next_question integer;
  server_now timestamptz := clock_timestamp();
  required_count integer;
  ready_count integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.arena_room_players arp
    where arp.room_id = target_room_id
      and arp.user_id = auth.uid()
      and arp.left_at is null
      and arp.finished_at is null
      and coalesce(arp.result_status, 'active') not in (
        'cancelled', 'left', 'forfeit'
      )
  ) then
    raise exception 'Only competitive room members can sync the game.';
  end if;

  select * into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby')
    and status = 'active'
  for update;

  if target_room.id is null then return false; end if;
  question_total := coalesce(jsonb_array_length(target_room.quiz_questions), 0);

  if target_room.competitive_round_phase = 'preparing_audio' then
    select count(*)::integer into required_count
    from public.arena_room_players arp
    where arp.room_id = target_room_id
      and arp.left_at is null
      and arp.finished_at is null
      and coalesce(arp.result_status, 'active') not in (
        'cancelled', 'left', 'forfeit'
      );

    select count(*)::integer into ready_count
    from public.arena_competitive_audio_readiness ar
    join public.arena_room_players arp
      on arp.room_id = ar.room_id and arp.user_id = ar.user_id
    where ar.room_id = target_room_id
      and ar.room_round_number = coalesce(target_room.round_number, 1)
      and ar.round_id = target_room.competitive_round_id
      and ar.question_index = target_room.competitive_question_index
      and ar.readiness_status = 'ready'
      and arp.left_at is null
      and arp.finished_at is null
      and coalesce(arp.result_status, 'active') not in (
        'cancelled', 'left', 'forfeit'
      );

    if required_count > 0 and ready_count >= required_count then
      update public.arena_rooms
      set
        competitive_round_phase = 'countdown',
        competitive_answer_starts_at = server_now + interval '3 seconds',
        competitive_answer_ends_at = server_now + interval '13 seconds',
        competitive_audio_ready_deadline_at = null,
        competitive_required_ready_count = required_count,
        competitive_ready_count = ready_count
      where id = target_room_id;
      return true;
    end if;

    update public.arena_rooms
    set
      competitive_required_ready_count = required_count,
      competitive_ready_count = ready_count
    where id = target_room_id;

    if target_room.competitive_audio_ready_deadline_at is not null
      and server_now >= target_room.competitive_audio_ready_deadline_at
    then
      return public.apply_competitive_audio_skip(
        target_room_id,
        target_room.competitive_round_id,
        target_room.competitive_question_index,
        'Audio readiness timed out before every player was ready.'
      );
    end if;

    return false;
  end if;

  if target_room.competitive_round_phase = 'countdown'
    and server_now >= target_room.competitive_answer_starts_at
  then
    update public.arena_rooms set competitive_round_phase = 'answering'
    where id = target_room_id;
    target_room.competitive_round_phase := 'answering';
  end if;

  if target_room.competitive_round_phase = 'answering'
    and server_now >= target_room.competitive_answer_ends_at
  then
    insert into public.arena_competitive_answers (
      room_id, room_round_number, round_id, question_index, user_id,
      answer_text, is_correct, is_round_winner, response_time_ms, submitted_at
    )
    select
      target_room_id,
      coalesce(target_room.round_number, 1),
      target_room.competitive_round_id,
      target_room.competitive_question_index,
      arp.user_id,
      null,
      false,
      false,
      10000,
      target_room.competitive_answer_ends_at
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
        target_room.competitive_question_index + 1
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
      competitive_reveal_ends_at = server_now + interval '2.5 seconds'
    where id = target_room_id;
    return true;
  end if;

  if target_room.competitive_round_phase = 'reveal'
    and target_room.competitive_reveal_ends_at is not null
    and server_now >= target_room.competitive_reveal_ends_at
  then
    next_question := target_room.competitive_question_index + 1;

    if next_question >= question_total then
      update public.arena_room_players
      set
        final_score = round_points,
        correct_answers = rounds_won,
        total_questions = rounds_played,
        average_answer_time = case
          when rounds_won > 0 then round(average_winning_response_ms / 1000, 2)
          else 0
        end,
        current_score = round_points,
        current_correct_answers = rounds_won,
        current_question_index = rounds_played,
        current_streak = 0,
        finished_at = coalesce(finished_at, server_now),
        result_status = 'completed'
      where room_id = target_room_id
        and left_at is null
        and coalesce(result_status, 'active') not in (
          'cancelled', 'left', 'forfeit'
        );

      update public.arena_rooms
      set
        status = 'finished',
        finished_at = coalesce(finished_at, server_now),
        competitive_round_phase = 'finished',
        competitive_answer_starts_at = null,
        competitive_answer_ends_at = null,
        competitive_reveal_ends_at = null,
        competitive_audio_prepare_started_at = null,
        competitive_audio_ready_deadline_at = null
      where id = target_room_id;
      return true;
    end if;

    update public.arena_room_players
    set
      competitive_answered_question_index = -1,
      competitive_selected_answer = null,
      competitive_answer_was_correct = null
    where room_id = target_room_id
      and left_at is null
      and finished_at is null
      and coalesce(result_status, 'active') not in (
        'cancelled', 'left', 'forfeit'
      );

    update public.arena_rooms
    set
      competitive_question_index = next_question,
      competitive_round_id = gen_random_uuid(),
      competitive_round_phase = 'preparing_audio',
      competitive_answer_starts_at = null,
      competitive_answer_ends_at = null,
      competitive_reveal_ends_at = null,
      competitive_round_winner_user_id = null,
      competitive_winning_answer_at = null,
      competitive_winning_response_ms = null,
      competitive_audio_prepare_started_at = server_now,
      competitive_audio_ready_deadline_at = server_now + interval '12 seconds',
      competitive_required_ready_count = (
        select count(*)::integer from public.arena_room_players arp
        where arp.room_id = target_room_id
          and arp.left_at is null
          and arp.finished_at is null
          and coalesce(arp.result_status, 'active') not in (
            'cancelled', 'left', 'forfeit'
          )
      ),
      competitive_ready_count = 0,
      competitive_audio_failed = false,
      competitive_audio_failure_reason = null
    where id = target_room_id;
    return true;
  end if;

  return false;
end;
$$;

revoke all on function public.start_competitive_arena_room(uuid, jsonb)
  from public, anon;
revoke all on function public.acknowledge_competitive_audio_ready(uuid, uuid, integer, text)
  from public, anon;
revoke all on function public.report_competitive_audio_failure(uuid, uuid, integer, text, text)
  from public, anon;
revoke all on function public.sync_competitive_arena_timeline(uuid)
  from public, anon;

grant execute on function public.start_competitive_arena_room(uuid, jsonb)
  to authenticated;
grant execute on function public.acknowledge_competitive_audio_ready(uuid, uuid, integer, text)
  to authenticated;
grant execute on function public.report_competitive_audio_failure(uuid, uuid, integer, text, text)
  to authenticated;
grant execute on function public.sync_competitive_arena_timeline(uuid)
  to authenticated;

commit;

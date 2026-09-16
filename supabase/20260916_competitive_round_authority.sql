-- Server-authoritative shared rounds for Duel and Group Lobby.
-- Party Mode intentionally keeps its separate Kahoot-style timeline and answer ledger.

begin;

-- Production databases created from the original stats schema may not have
-- received the later unified Arena progression migration. These columns are
-- the existing repository-defined bridge between an Arena room and its saved
-- quiz result. arena_rooms.mode remains the authoritative live room mode;
-- quiz_results.game_mode stores that mode with the historical result.
alter table public.quiz_results
  add column if not exists game_mode text not null default 'single_player',
  add column if not exists arena_room_id uuid references public.arena_rooms(id) on delete set null,
  add column if not exists arena_round_number integer,
  add column if not exists is_private boolean not null default false,
  add column if not exists is_winner boolean not null default false,
  add column if not exists was_host boolean not null default false,
  add column if not exists player_count integer not null default 1,
  add column if not exists placement integer,
  add column if not exists score_margin integer not null default 0,
  add column if not exists result_status text not null default 'completed';

alter table public.quiz_results
  drop constraint if exists quiz_results_game_mode_check;

alter table public.quiz_results
  add constraint quiz_results_game_mode_check
  check (
    game_mode in (
      'single_player',
      'duel',
      'group_lobby',
      'party_mode',
      'championship'
    )
  );

create unique index if not exists quiz_results_arena_round_user_unique_idx
  on public.quiz_results (arena_room_id, arena_round_number, user_id)
  where arena_room_id is not null;

create index if not exists quiz_results_user_mode_played_idx
  on public.quiz_results (user_id, game_mode, played_at desc);

alter table public.arena_rooms
  add column if not exists competitive_question_index integer not null default 0,
  add column if not exists competitive_round_id uuid,
  add column if not exists competitive_round_phase text not null default 'idle',
  add column if not exists competitive_answer_starts_at timestamptz,
  add column if not exists competitive_answer_ends_at timestamptz,
  add column if not exists competitive_reveal_ends_at timestamptz,
  add column if not exists competitive_round_winner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists competitive_winning_answer_at timestamptz,
  add column if not exists competitive_winning_response_ms integer;

alter table public.arena_rooms
  drop constraint if exists arena_rooms_competitive_round_phase_check;

alter table public.arena_rooms
  add constraint arena_rooms_competitive_round_phase_check
  check (
    competitive_round_phase in (
      'idle',
      'countdown',
      'answering',
      'reveal',
      'finished'
    )
  );

alter table public.arena_room_players
  add column if not exists round_points integer not null default 0,
  add column if not exists rounds_won integer not null default 0,
  add column if not exists rounds_played integer not null default 0,
  add column if not exists winning_response_total_ms bigint not null default 0,
  add column if not exists average_winning_response_ms numeric not null default 0,
  add column if not exists fastest_winning_response_ms integer,
  add column if not exists competitive_answered_question_index integer not null default -1,
  add column if not exists competitive_selected_answer text,
  add column if not exists competitive_answer_was_correct boolean;

alter table public.quiz_results
  add column if not exists scoring_model text not null default 'legacy',
  add column if not exists round_points integer not null default 0,
  add column if not exists rounds_won integer not null default 0,
  add column if not exists rounds_played integer not null default 0,
  add column if not exists average_winning_response_time numeric not null default 0,
  add column if not exists fastest_winning_response_time numeric;

alter table public.quiz_results
  drop constraint if exists quiz_results_scoring_model_check;

alter table public.quiz_results
  add constraint quiz_results_scoring_model_check
  check (scoring_model in ('legacy', 'round_points'));

create table if not exists public.arena_competitive_answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.arena_rooms(id) on delete cascade,
  room_round_number integer not null,
  round_id uuid not null,
  question_index integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  answer_text text,
  is_correct boolean not null default false,
  is_round_winner boolean not null default false,
  response_time_ms integer not null default 10000,
  submitted_at timestamptz not null default clock_timestamp(),
  unique (room_id, room_round_number, question_index, user_id),
  unique (round_id, user_id)
);

create unique index if not exists arena_competitive_answers_one_winner_idx
  on public.arena_competitive_answers (round_id)
  where is_round_winner;

create index if not exists arena_competitive_answers_room_round_idx
  on public.arena_competitive_answers
  (room_id, room_round_number, question_index);

alter table public.arena_competitive_answers enable row level security;

drop policy if exists "Arena members can read competitive answers"
  on public.arena_competitive_answers;

-- Competitive answers can only be written through the guarded RPC below.
-- Clients render the summarized room/player state and cannot inspect another
-- player's submitted choice during an active round.
revoke all on public.arena_competitive_answers from anon, authenticated;

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
  server_starts_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select *
  into target_room
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

  select count(*)::integer
  into player_count
  from public.arena_room_players arp
  where arp.room_id = target_room_id
    and arp.left_at is null
    and coalesce(arp.result_status, 'active') not in ('cancelled', 'left', 'forfeit');

  if player_count < minimum_players then
    raise exception 'Not enough players to start this room.';
  end if;

  delete from public.arena_competitive_answers
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

  server_starts_at := clock_timestamp() + interval '3 seconds';

  update public.arena_rooms
  set
    status = 'active',
    started_at = server_starts_at,
    finished_at = null,
    quiz_questions = target_questions,
    competitive_question_index = 0,
    competitive_round_id = gen_random_uuid(),
    competitive_round_phase = 'countdown',
    competitive_answer_starts_at = server_starts_at,
    competitive_answer_ends_at = server_starts_at + interval '10 seconds',
    competitive_reveal_ends_at = null,
    competitive_round_winner_user_id = null,
    competitive_winning_answer_at = null,
    competitive_winning_response_ms = null
  where id = target_room_id;

  return true;
end;
$$;

create or replace function public.get_competitive_server_time(target_room_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
    or not public.is_arena_room_player(target_room_id, auth.uid())
  then
    raise exception 'Only room members can read the competitive room clock.';
  end if;

  if not exists (
    select 1
    from public.arena_rooms
    where id = target_room_id
      and mode in ('duel', 'group_lobby')
  ) then
    raise exception 'Competitive room not found.';
  end if;

  return clock_timestamp();
end;
$$;

create or replace function public.submit_competitive_arena_answer(
  target_room_id uuid,
  target_round_id uuid,
  target_question_index integer,
  target_answer text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_received_at timestamptz := clock_timestamp();
  target_room public.arena_rooms%rowtype;
  correct_answer text;
  answer_is_valid boolean;
  answer_is_correct boolean;
  response_ms integer;
  inserted_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  -- Serializing on the room row makes the first accepted correct request the
  -- only transaction that can claim this round.
  select *
  into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby')
    and status = 'active'
  for update;

  if target_room.id is null then
    raise exception 'This competitive game is not active.';
  end if;

  if target_room.competitive_round_id is distinct from target_round_id
    or target_room.competitive_question_index <> target_question_index
  then
    return jsonb_build_object(
      'accepted', false,
      'staleRound', true,
      'roundLocked', target_room.competitive_round_phase = 'reveal'
    );
  end if;

  if target_room.competitive_round_phase = 'reveal'
    or target_room.competitive_round_winner_user_id is not null
  then
    return jsonb_build_object(
      'accepted', false,
      'roundLocked', true,
      'winnerUserId', target_room.competitive_round_winner_user_id,
      'responseTimeMs', target_room.competitive_winning_response_ms
    );
  end if;

  if target_room.competitive_round_phase = 'countdown'
    and request_received_at >= target_room.competitive_answer_starts_at
  then
    target_room.competitive_round_phase := 'answering';
    update public.arena_rooms
    set competitive_round_phase = 'answering'
    where id = target_room_id;
  end if;

  if target_room.competitive_round_phase <> 'answering'
    or request_received_at < target_room.competitive_answer_starts_at
    or request_received_at > target_room.competitive_answer_ends_at
  then
    return jsonb_build_object('accepted', false, 'roundLocked', true);
  end if;

  if not exists (
    select 1
    from public.arena_room_players arp
    where arp.room_id = target_room_id
      and arp.user_id = auth.uid()
      and arp.left_at is null
      and arp.finished_at is null
      and coalesce(arp.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
  ) then
    raise exception 'You are not an active player in this room.';
  end if;

  correct_answer := coalesce(
    target_room.quiz_questions -> target_question_index ->> 'correctAnswer',
    target_room.quiz_questions -> target_question_index -> 'correctTrack' ->> 'name'
  );

  answer_is_valid := target_answer is null or exists (
    select 1
    from jsonb_array_elements(
      target_room.quiz_questions -> target_question_index -> 'options'
    ) option_row
    where option_row ->> 'name' = target_answer
  );

  if not answer_is_valid then
    raise exception 'Selected answer is not part of this round.';
  end if;

  answer_is_correct := target_answer is not null
    and target_answer = correct_answer;
  response_ms := least(
    10000,
    greatest(
      0,
      round(
        extract(epoch from (
          request_received_at - target_room.competitive_answer_starts_at
        )) * 1000
      )::integer
    )
  );

  insert into public.arena_competitive_answers (
    room_id,
    room_round_number,
    round_id,
    question_index,
    user_id,
    answer_text,
    is_correct,
    response_time_ms,
    submitted_at
  )
  values (
    target_room_id,
    coalesce(target_room.round_number, 1),
    target_round_id,
    target_question_index,
    auth.uid(),
    target_answer,
    answer_is_correct,
    response_ms,
    request_received_at
  )
  on conflict (room_id, room_round_number, question_index, user_id) do nothing
  returning id into inserted_id;

  if inserted_id is null then
    return jsonb_build_object('accepted', false, 'duplicate', true);
  end if;

  update public.arena_room_players
  set
    competitive_answered_question_index = target_question_index,
    competitive_selected_answer = target_answer,
    competitive_answer_was_correct = answer_is_correct
  where room_id = target_room_id
    and user_id = auth.uid();

  if answer_is_correct then
    update public.arena_competitive_answers
    set is_round_winner = true
    where id = inserted_id;

    update public.arena_room_players
    set
      round_points = round_points + case when user_id = auth.uid() then 1 else 0 end,
      rounds_won = rounds_won + case when user_id = auth.uid() then 1 else 0 end,
      rounds_played = rounds_played + 1,
      winning_response_total_ms = winning_response_total_ms
        + case when user_id = auth.uid() then response_ms else 0 end,
      average_winning_response_ms = case
        when user_id = auth.uid()
          then round(
            (winning_response_total_ms + response_ms)::numeric /
              nullif(rounds_won + 1, 0),
            1
          )
        else average_winning_response_ms
      end,
      fastest_winning_response_ms = case
        when user_id = auth.uid()
          then least(coalesce(fastest_winning_response_ms, response_ms), response_ms)
        else fastest_winning_response_ms
      end,
      current_score = current_score + case when user_id = auth.uid() then 1 else 0 end,
      current_correct_answers = current_correct_answers
        + case when user_id = auth.uid() then 1 else 0 end,
      current_question_index = greatest(current_question_index, target_question_index + 1),
      current_streak = case
        when user_id = auth.uid() then current_streak + 1
        else 0
      end
    where room_id = target_room_id
      and left_at is null
      and finished_at is null
      and coalesce(result_status, 'active') not in ('cancelled', 'left', 'forfeit');

    update public.arena_rooms
    set
      competitive_round_phase = 'reveal',
      competitive_round_winner_user_id = auth.uid(),
      competitive_winning_answer_at = request_received_at,
      competitive_winning_response_ms = response_ms,
      competitive_reveal_ends_at = clock_timestamp() + interval '2.5 seconds'
    where id = target_room_id;
  end if;

  return jsonb_build_object(
    'accepted', true,
    'isCorrect', answer_is_correct,
    'roundWon', answer_is_correct,
    'winnerUserId', case when answer_is_correct then auth.uid() else null end,
    'responseTimeMs', response_ms
  );
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
  next_starts_at timestamptz;
  server_now timestamptz := clock_timestamp();
begin
  if auth.uid() is null
    or not public.is_arena_room_player(target_room_id, auth.uid())
  then
    raise exception 'Only competitive room members can sync the game.';
  end if;

  select *
  into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby')
    and status = 'active'
  for update;

  if target_room.id is null then
    return false;
  end if;

  question_total := coalesce(jsonb_array_length(target_room.quiz_questions), 0);

  if target_room.competitive_round_phase = 'countdown'
    and server_now >= target_room.competitive_answer_starts_at
  then
    update public.arena_rooms
    set competitive_round_phase = 'answering'
    where id = target_room_id;
    target_room.competitive_round_phase := 'answering';
  end if;

  if target_room.competitive_round_phase = 'answering'
    and server_now >= target_room.competitive_answer_ends_at
  then
    insert into public.arena_competitive_answers (
      room_id,
      room_round_number,
      round_id,
      question_index,
      user_id,
      answer_text,
      is_correct,
      is_round_winner,
      response_time_ms,
      submitted_at
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
      and coalesce(arp.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
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
      and coalesce(result_status, 'active') not in ('cancelled', 'left', 'forfeit');

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
        and coalesce(result_status, 'active') not in ('cancelled', 'left', 'forfeit');

      update public.arena_rooms
      set
        status = 'finished',
        finished_at = coalesce(finished_at, server_now),
        competitive_round_phase = 'finished',
        competitive_answer_starts_at = null,
        competitive_answer_ends_at = null,
        competitive_reveal_ends_at = null
      where id = target_room_id;

      return true;
    end if;

    next_starts_at := server_now + interval '3 seconds';

    update public.arena_room_players
    set
      competitive_answered_question_index = -1,
      competitive_selected_answer = null,
      competitive_answer_was_correct = null
    where room_id = target_room_id
      and left_at is null
      and finished_at is null
      and coalesce(result_status, 'active') not in ('cancelled', 'left', 'forfeit');

    update public.arena_rooms
    set
      competitive_question_index = next_question,
      competitive_round_id = gen_random_uuid(),
      competitive_round_phase = 'countdown',
      competitive_answer_starts_at = next_starts_at,
      competitive_answer_ends_at = next_starts_at + interval '10 seconds',
      competitive_reveal_ends_at = null,
      competitive_round_winner_user_id = null,
      competitive_winning_answer_at = null,
      competitive_winning_response_ms = null
    where id = target_room_id;

    return true;
  end if;

  return false;
end;
$$;

-- Reset both legacy and round-authoritative state for rematches. Party fields
-- remain separate and are initialized again by start_party_room.
create or replace function public.reset_arena_room_for_rematch(
  target_room_id uuid,
  new_album_id text default null,
  new_album_name text default null,
  new_artist_name text default null,
  new_artwork_url text default null
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

  if not exists (
    select 1
    from public.arena_room_players arp
    where arp.room_id = target_room_id
      and arp.user_id = auth.uid()
      and arp.left_at is null
      and coalesce(arp.result_status, 'active') not in ('cancelled', 'left')
  ) then
    raise exception 'Only the current host can start a rematch.';
  end if;

  update public.arena_rooms
  set
    status = 'waiting',
    album_id = coalesce(nullif(new_album_id, ''), album_id),
    album_name = coalesce(nullif(new_album_name, ''), album_name),
    artist_name = coalesce(nullif(new_artist_name, ''), artist_name),
    artwork_url = coalesce(nullif(new_artwork_url, ''), artwork_url),
    started_at = null,
    finished_at = null,
    expires_at = clock_timestamp() + interval '2 hours',
    quiz_questions = '[]'::jsonb,
    round_number = coalesce(round_number, 1) + 1,
    rematch_requested_by = null,
    rematch_requested_at = null,
    competitive_question_index = 0,
    competitive_round_id = null,
    competitive_round_phase = 'idle',
    competitive_answer_starts_at = null,
    competitive_answer_ends_at = null,
    competitive_reveal_ends_at = null,
    competitive_round_winner_user_id = null,
    competitive_winning_answer_at = null,
    competitive_winning_response_ms = null,
    party_question_index = 0,
    party_question_phase = 'idle',
    party_clip_starts_at = null,
    party_answer_starts_at = null,
    party_answer_ends_at = null,
    party_reveal_ends_at = null,
    party_audio_question_index = null,
    party_audio_status = 'idle'
  where id = target_room_id
    and mode in ('duel', 'group_lobby', 'party_mode')
    and status in ('finished', 'cancelled')
    and host_user_id = auth.uid();

  if not found then
    raise exception 'Only the host can start a rematch.';
  end if;

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
    is_ready = false,
    finished_at = null,
    forfeited_at = null,
    result_status = 'active'
  where room_id = target_room_id
    and left_at is null
    and coalesce(result_status, 'active') not in ('cancelled', 'left');

  return true;
end;
$$;

-- Extend progression rows without deleting or rewriting historical results.
create or replace function public.sync_arena_progression_for_room(target_room_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
  synced_count integer := 0;
begin
  select * into target_room
  from public.arena_rooms
  where id = target_room_id;

  if target_room.id is null or target_room.status <> 'finished' then
    return 0;
  end if;

  with candidates as (
    select
      arp.user_id,
      greatest(coalesce(arp.final_score, 0), 0)::integer as final_score,
      greatest(coalesce(arp.correct_answers, 0), 0)::integer as correct_answers,
      greatest(coalesce(arp.total_questions, 0), 0)::integer as total_questions,
      greatest(coalesce(arp.average_answer_time, 0), 0)::numeric as average_answer_time,
      greatest(coalesce(arp.round_points, 0), 0)::integer as round_points,
      greatest(coalesce(arp.rounds_won, 0), 0)::integer as rounds_won,
      greatest(coalesce(arp.rounds_played, 0), 0)::integer as rounds_played,
      greatest(coalesce(arp.average_winning_response_ms, 0), 0)::numeric / 1000
        as average_winning_response_time,
      case
        when arp.fastest_winning_response_ms is null then null
        else greatest(arp.fastest_winning_response_ms, 0)::numeric / 1000
      end as fastest_winning_response_time,
      case
        when target_room.mode in ('duel', 'group_lobby')
          and coalesce(arp.rounds_played, 0) > 0
          then 'round_points'
        else 'legacy'
      end as scoring_model,
      coalesce(arp.result_status, 'completed') as result_status,
      coalesce(arp.finished_at, target_room.finished_at, clock_timestamp()) as played_at,
      case coalesce(arp.result_status, 'completed')
        when 'win_by_forfeit' then 3
        when 'completed' then 2
        when 'active' then 1
        when 'forfeit' then -1
        else 0
      end as result_rank,
      case
        when coalesce(arp.total_questions, 0) > 0
          then round(
            (coalesce(arp.correct_answers, 0)::numeric /
              nullif(arp.total_questions, 0)) * 100,
            2
          )
        else 0
      end as accuracy
    from public.arena_room_players arp
    where arp.room_id = target_room.id
      and coalesce(arp.result_status, 'active') not in ('cancelled', 'left')
      and (target_room.mode <> 'party_mode' or arp.user_id <> target_room.host_user_id)
  ),
  ranked as (
    select
      candidates.*,
      rank() over (
        order by
          result_rank desc,
          final_score desc,
          case when scoring_model = 'round_points'
            then average_winning_response_time else 0 end asc,
          case when scoring_model = 'legacy' then accuracy else 0 end desc,
          case when scoring_model = 'legacy' then average_answer_time else 0 end asc
      )::integer as placement,
      count(*) over ()::integer as player_count
    from candidates
  ),
  resolved as (
    select
      ranked.*,
      count(*) filter (where placement = 1) over ()::integer as top_tie_count
    from ranked
  )
  insert into public.quiz_results (
    user_id, album_name, artist_name, total_questions, correct_answers,
    accuracy, final_points, average_answer_time, played_at, game_mode,
    arena_room_id, arena_round_number, is_private, is_winner, was_host,
    player_count, placement, score_margin, result_status, scoring_model,
    round_points, rounds_won, rounds_played, average_winning_response_time,
    fastest_winning_response_time
  )
  select
    resolved.user_id,
    coalesce(nullif(target_room.album_name, ''), 'Arena Album'),
    coalesce(nullif(target_room.artist_name, ''), 'Unknown Artist'),
    resolved.total_questions,
    resolved.correct_answers,
    resolved.accuracy,
    resolved.final_score,
    resolved.average_answer_time,
    resolved.played_at,
    target_room.mode,
    target_room.id,
    coalesce(target_room.round_number, 1),
    coalesce(target_room.is_private, false),
    resolved.placement = 1 and resolved.top_tie_count = 1,
    resolved.user_id = target_room.host_user_id,
    resolved.player_count,
    resolved.placement,
    case
      when resolved.placement = 1 and resolved.top_tie_count = 1 then greatest(
        resolved.final_score - coalesce(
          (select max(opponent.final_score) from candidates opponent
            where opponent.user_id <> resolved.user_id),
          0
        ),
        0
      )
      else 0
    end,
    resolved.result_status,
    resolved.scoring_model,
    resolved.round_points,
    resolved.rounds_won,
    resolved.rounds_played,
    resolved.average_winning_response_time,
    resolved.fastest_winning_response_time
  from resolved
  on conflict (arena_room_id, arena_round_number, user_id)
    where arena_room_id is not null
  do update set
    album_name = excluded.album_name,
    artist_name = excluded.artist_name,
    total_questions = excluded.total_questions,
    correct_answers = excluded.correct_answers,
    accuracy = excluded.accuracy,
    final_points = excluded.final_points,
    average_answer_time = excluded.average_answer_time,
    played_at = excluded.played_at,
    game_mode = excluded.game_mode,
    is_private = excluded.is_private,
    is_winner = excluded.is_winner,
    was_host = excluded.was_host,
    player_count = excluded.player_count,
    placement = excluded.placement,
    score_margin = excluded.score_margin,
    result_status = excluded.result_status,
    scoring_model = excluded.scoring_model,
    round_points = excluded.round_points,
    rounds_won = excluded.rounds_won,
    rounds_played = excluded.rounds_played,
    average_winning_response_time = excluded.average_winning_response_time,
    fastest_winning_response_time = excluded.fastest_winning_response_time;

  get diagnostics synced_count = row_count;
  return synced_count;
end;
$$;

-- Keep progression server-owned even when the earlier unified progression
-- migration was not applied to a production database.
revoke all on function public.sync_arena_progression_for_room(uuid)
  from public, anon, authenticated;

create or replace function public.sync_arena_progression_when_finished()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'finished' and old.status is distinct from new.status then
    perform public.sync_arena_progression_for_room(new.id);
  end if;

  return new;
end;
$$;

revoke all on function public.sync_arena_progression_when_finished()
  from public, anon, authenticated;

drop trigger if exists arena_rooms_sync_progression on public.arena_rooms;
create trigger arena_rooms_sync_progression
  after update of status on public.arena_rooms
  for each row
  execute function public.sync_arena_progression_when_finished();

-- Upsert any completed Arena rounds that predate the unified quiz result
-- columns. Existing rows are preserved by the room/round/user conflict key.
do $$
declare
  finished_room record;
begin
  for finished_room in
    select id
    from public.arena_rooms
    where status = 'finished'
      and mode in ('duel', 'group_lobby', 'party_mode', 'championship')
  loop
    perform public.sync_arena_progression_for_room(finished_room.id);
  end loop;
end;
$$;

create or replace view public.public_profile_recent_results as
select
  qr.id,
  qr.user_id,
  p.username,
  coalesce(nullif(p.display_name, ''), nullif(p.username, ''), 'Unknown Player') as display_name,
  qr.album_name,
  qr.artist_name,
  qr.total_questions,
  qr.correct_answers,
  qr.accuracy,
  qr.final_points,
  qr.average_answer_time,
  qr.played_at,
  coalesce(ar.mode, qr.game_mode, 'single_player') as game_mode,
  qr.is_private,
  qr.is_winner,
  qr.was_host,
  qr.player_count,
  qr.placement,
  qr.score_margin,
  qr.result_status,
  qr.scoring_model,
  qr.round_points,
  qr.rounds_won,
  qr.rounds_played,
  qr.average_winning_response_time,
  qr.fastest_winning_response_time
from public.quiz_results qr
join public.profiles p on p.id = qr.user_id
left join public.arena_rooms ar on ar.id = qr.arena_room_id
where p.username is not null;

create or replace view public.public_profile_artist_stats as
select
  qr.user_id,
  p.username,
  qr.artist_name,
  count(*)::integer as quizzes_played,
  sum(qr.correct_answers)::integer as correct_answers,
  sum(qr.total_questions)::integer as total_questions,
  coalesce(
    round(
      (sum(qr.correct_answers)::numeric / nullif(sum(qr.total_questions), 0)) * 100,
      1
    ),
    0
  ) as accuracy,
  sum(qr.final_points)::integer as total_points,
  max(qr.final_points)::integer as best_score,
  max(qr.played_at) as updated_at
from public.quiz_results qr
join public.profiles p on p.id = qr.user_id
where p.username is not null
group by qr.user_id, p.username, qr.artist_name;

create or replace view public.public_profile_album_stats as
select
  qr.user_id,
  p.username,
  qr.album_name,
  qr.artist_name,
  count(*)::integer as times_played,
  max(qr.final_points)::integer as best_score,
  max(qr.accuracy) as best_accuracy,
  max(qr.played_at) as last_played_at
from public.quiz_results qr
join public.profiles p on p.id = qr.user_id
where p.username is not null
group by qr.user_id, p.username, qr.album_name, qr.artist_name;

create or replace view public.global_artist_masters as
select
  qr.user_id,
  coalesce(
    nullif(p.display_name, ''),
    nullif(p.username, ''),
    'Unknown Player'
  ) as player_name,
  p.username,
  qr.artist_name,
  count(*)::integer as quizzes_played,
  coalesce(
    round(
      (sum(qr.correct_answers)::numeric / nullif(sum(qr.total_questions), 0)) * 100,
      1
    ),
    0
  ) as accuracy,
  sum(qr.final_points)::integer as total_points,
  max(qr.final_points)::integer as best_score,
  max(qr.played_at) as updated_at
from public.quiz_results qr
left join public.profiles p on p.id = qr.user_id
group by qr.user_id, p.display_name, p.username, qr.artist_name;

grant select on public.public_profile_recent_results to anon, authenticated;
grant select on public.public_profile_artist_stats to anon, authenticated;
grant select on public.public_profile_album_stats to anon, authenticated;
grant select on public.global_artist_masters to anon, authenticated;

revoke all on function public.start_competitive_arena_room(uuid, jsonb)
  from public, anon;
revoke all on function public.get_competitive_server_time(uuid)
  from public, anon;
revoke all on function public.submit_competitive_arena_answer(uuid, uuid, integer, text)
  from public, anon;
revoke all on function public.sync_competitive_arena_timeline(uuid)
  from public, anon;
revoke all on function public.reset_arena_room_for_rematch(uuid, text, text, text, text)
  from public, anon;

grant execute on function public.start_competitive_arena_room(uuid, jsonb)
  to authenticated;
grant execute on function public.get_competitive_server_time(uuid)
  to authenticated;
grant execute on function public.submit_competitive_arena_answer(uuid, uuid, integer, text)
  to authenticated;
grant execute on function public.sync_competitive_arena_timeline(uuid)
  to authenticated;
grant execute on function public.reset_arena_room_for_rematch(uuid, text, text, text, text)
  to authenticated;

commit;

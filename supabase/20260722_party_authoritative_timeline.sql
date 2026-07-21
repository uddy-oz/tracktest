-- Party Mode authoritative question clock and one-answer-per-player ledger.
-- Run after 20260721_party_host_audio_authority.sql.

alter table public.arena_rooms
  add column if not exists party_question_index integer not null default 0,
  add column if not exists party_question_phase text not null default 'idle',
  add column if not exists party_clip_starts_at timestamptz,
  add column if not exists party_answer_starts_at timestamptz,
  add column if not exists party_answer_ends_at timestamptz,
  add column if not exists party_reveal_ends_at timestamptz;

alter table public.arena_rooms
  drop constraint if exists arena_rooms_party_question_phase_check;

alter table public.arena_rooms
  add constraint arena_rooms_party_question_phase_check
  check (
    party_question_phase in (
      'idle',
      'countdown',
      'awaiting_audio',
      'answering',
      'reveal',
      'finished'
    )
  );

create table if not exists public.arena_party_answers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.arena_rooms(id) on delete cascade,
  round_number integer not null,
  question_index integer not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  answer_text text,
  is_correct boolean not null default false,
  points integer not null default 0,
  answer_time_seconds numeric not null default 10,
  submitted_at timestamptz not null default now(),
  unique (room_id, round_number, question_index, user_id)
);

create index if not exists arena_party_answers_room_question_idx
  on public.arena_party_answers (room_id, round_number, question_index);

alter table public.arena_party_answers enable row level security;

drop policy if exists "Party room members can read answers"
  on public.arena_party_answers;

create policy "Party room members can read answers"
  on public.arena_party_answers
  for select
  to authenticated
  using (public.is_arena_room_player(room_id, auth.uid()));

-- Answers are written only through submit_party_answer so score, timing, and
-- duplicate-answer checks remain authoritative.
revoke insert, update, delete on public.arena_party_answers
  from anon, authenticated;
grant select on public.arena_party_answers to authenticated;

create or replace function public.start_party_room(
  target_room_id uuid,
  target_questions jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.arena_rooms%rowtype;
  competitor_count integer;
  server_starts_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select *
  into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode = 'party_mode'
    and status = 'waiting'
    and host_user_id = auth.uid()
  for update;

  if target_room.id is null then
    raise exception 'Only the host can start this waiting Party room.';
  end if;

  if jsonb_typeof(target_questions) <> 'array'
    or jsonb_array_length(target_questions) = 0
  then
    raise exception 'Party questions are required.';
  end if;

  select count(*)::integer
  into competitor_count
  from public.arena_room_players arp
  where arp.room_id = target_room_id
    and arp.user_id <> target_room.host_user_id
    and arp.left_at is null
    and coalesce(arp.result_status, 'active') not in ('cancelled', 'left', 'forfeit');

  if competitor_count < 1 then
    raise exception 'At least one joined player is required.';
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
    finished_at = null,
    forfeited_at = null,
    result_status = 'active'
  where room_id = target_room_id
    and left_at is null;

  delete from public.arena_party_answers
  where room_id = target_room_id
    and round_number = coalesce(target_room.round_number, 1);

  server_starts_at := now() + interval '3 seconds';

  update public.arena_rooms
  set
    status = 'active',
    started_at = server_starts_at,
    finished_at = null,
    quiz_questions = target_questions,
    party_question_index = 0,
    party_question_phase = 'countdown',
    party_clip_starts_at = server_starts_at,
    party_answer_starts_at = server_starts_at,
    party_answer_ends_at = server_starts_at + interval '10 seconds',
    party_reveal_ends_at = null,
    party_audio_question_index = 0,
    party_audio_status = 'pending',
    party_audio_updated_at = now()
  where id = target_room_id;

  return true;
end;
$$;

create or replace function public.sync_party_room_timeline(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.arena_rooms%rowtype;
  competitor_count integer;
  answered_count integer;
  question_total integer;
  next_question integer;
  next_starts_at timestamptz;
begin
  if auth.uid() is null
    or not public.is_arena_room_player(target_room_id, auth.uid())
  then
    raise exception 'Only Party room members can sync the game.';
  end if;

  select *
  into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode = 'party_mode'
    and status = 'active'
  for update;

  if target_room.id is null then
    return false;
  end if;

  question_total := coalesce(jsonb_array_length(target_room.quiz_questions), 0);

  if target_room.party_question_phase = 'countdown'
    and now() >= target_room.party_answer_starts_at
  then
    update public.arena_rooms
    set party_question_phase = case
      when party_audio_status = 'playing' then 'answering'
      else 'awaiting_audio'
    end
    where id = target_room_id;

    select * into target_room
    from public.arena_rooms
    where id = target_room_id;
  end if;

  if target_room.party_question_phase in ('awaiting_audio', 'answering') then
    select count(*)::integer
    into competitor_count
    from public.arena_room_players arp
    where arp.room_id = target_room_id
      and arp.user_id <> target_room.host_user_id
      and arp.left_at is null
      and arp.finished_at is null
      and coalesce(arp.result_status, 'active') not in ('cancelled', 'left', 'forfeit');

    select count(*)::integer
    into answered_count
    from public.arena_party_answers apa
    join public.arena_room_players arp
      on arp.room_id = apa.room_id and arp.user_id = apa.user_id
    where apa.room_id = target_room_id
      and apa.round_number = coalesce(target_room.round_number, 1)
      and apa.question_index = target_room.party_question_index
      and arp.user_id <> target_room.host_user_id
      and arp.left_at is null
      and arp.finished_at is null
      and coalesce(arp.result_status, 'active') not in ('cancelled', 'left', 'forfeit');

    if competitor_count = 0 then
      update public.arena_rooms
      set
        party_question_phase = 'finished',
        status = 'finished',
        finished_at = coalesce(finished_at, now())
      where id = target_room_id;
      return true;
    end if;

    if now() >= target_room.party_answer_ends_at then
      update public.arena_room_players arp
      set
        current_question_index = greatest(
          arp.current_question_index,
          target_room.party_question_index + 1
        ),
        current_streak = 0
      where arp.room_id = target_room_id
        and arp.user_id <> target_room.host_user_id
        and arp.left_at is null
        and arp.finished_at is null
        and coalesce(arp.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
        and not exists (
          select 1
          from public.arena_party_answers apa
          where apa.room_id = target_room_id
            and apa.round_number = coalesce(target_room.round_number, 1)
            and apa.question_index = target_room.party_question_index
            and apa.user_id = arp.user_id
        );

      insert into public.arena_party_answers (
        room_id,
        round_number,
        question_index,
        user_id,
        answer_text,
        is_correct,
        points,
        answer_time_seconds
      )
      select
        target_room_id,
        coalesce(target_room.round_number, 1),
        target_room.party_question_index,
        arp.user_id,
        null,
        false,
        0,
        10
      from public.arena_room_players arp
      where arp.room_id = target_room_id
        and arp.user_id <> target_room.host_user_id
        and arp.left_at is null
        and arp.finished_at is null
        and coalesce(arp.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
      on conflict (room_id, round_number, question_index, user_id) do nothing;

      update public.arena_rooms
      set
        party_question_phase = 'reveal',
        party_reveal_ends_at = now() + interval '1.2 seconds'
      where id = target_room_id;
      return true;
    end if;

    if answered_count >= competitor_count then
      update public.arena_rooms
      set
        party_question_phase = 'reveal',
        party_reveal_ends_at = now() + interval '1.2 seconds'
      where id = target_room_id;
      return true;
    end if;
  end if;

  if target_room.party_question_phase = 'reveal'
    and target_room.party_reveal_ends_at is not null
    and now() >= target_room.party_reveal_ends_at
  then
    next_question := target_room.party_question_index + 1;

    if next_question >= question_total then
      update public.arena_room_players arp
      set
        final_score = totals.final_score,
        correct_answers = totals.correct_answers,
        total_questions = totals.total_questions,
        average_answer_time = totals.average_answer_time,
        current_score = totals.final_score,
        current_correct_answers = totals.correct_answers,
        current_question_index = totals.total_questions,
        current_streak = 0,
        finished_at = coalesce(arp.finished_at, now()),
        result_status = 'completed'
      from (
        select
          apa.user_id,
          coalesce(sum(apa.points), 0)::integer as final_score,
          count(*) filter (where apa.is_correct)::integer as correct_answers,
          count(*)::integer as total_questions,
          coalesce(avg(apa.answer_time_seconds), 0) as average_answer_time
        from public.arena_party_answers apa
        where apa.room_id = target_room_id
          and apa.round_number = coalesce(target_room.round_number, 1)
        group by apa.user_id
      ) totals
      where arp.room_id = target_room_id
        and arp.user_id = totals.user_id
        and arp.user_id <> target_room.host_user_id
        and arp.left_at is null
        and coalesce(arp.result_status, 'active') not in ('cancelled', 'left', 'forfeit');

      update public.arena_rooms
      set
        party_question_phase = 'finished',
        status = 'finished',
        finished_at = coalesce(finished_at, now()),
        party_clip_starts_at = null,
        party_answer_starts_at = null,
        party_answer_ends_at = null,
        party_reveal_ends_at = null,
        party_audio_status = 'idle',
        party_audio_updated_at = now()
      where id = target_room_id;
      return true;
    end if;

    next_starts_at := now() + interval '3 seconds';

    update public.arena_rooms
    set
      party_question_index = next_question,
      party_question_phase = 'countdown',
      party_clip_starts_at = next_starts_at,
      party_answer_starts_at = next_starts_at,
      party_answer_ends_at = next_starts_at + interval '10 seconds',
      party_reveal_ends_at = null,
      party_audio_question_index = next_question,
      party_audio_status = 'pending',
      party_audio_updated_at = now()
    where id = target_room_id;
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.get_party_server_time(target_room_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
    or not public.is_arena_room_player(target_room_id, auth.uid())
  then
    raise exception 'Only Party room members can read the room clock.';
  end if;

  if not exists (
    select 1
    from public.arena_rooms
    where id = target_room_id
      and mode = 'party_mode'
  ) then
    raise exception 'Party room not found.';
  end if;

  return clock_timestamp();
end;
$$;

create or replace function public.submit_party_answer(
  target_room_id uuid,
  target_answer text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.arena_rooms%rowtype;
  correct_answer text;
  answer_is_correct boolean;
  remaining_seconds numeric;
  earned_points integer;
  answer_seconds numeric;
  inserted_id uuid;
  competitor_count integer;
  answered_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select *
  into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode = 'party_mode'
    and status = 'active'
  for update;

  if target_room.id is null then
    raise exception 'This Party game is not active.';
  end if;

  if auth.uid() = target_room.host_user_id then
    raise exception 'The Party host observes and cannot submit answers.';
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
    raise exception 'You are not an active Party player.';
  end if;

  if target_room.party_question_phase = 'countdown'
    and now() >= target_room.party_answer_starts_at
    and target_room.party_audio_status = 'playing'
  then
    target_room.party_question_phase := 'answering';
    update public.arena_rooms
    set party_question_phase = 'answering'
    where id = target_room_id;
  end if;

  if target_room.party_question_phase <> 'answering'
    or now() > target_room.party_answer_ends_at
  then
    raise exception 'This Party question is not accepting answers.';
  end if;

  correct_answer := coalesce(
    target_room.quiz_questions -> target_room.party_question_index ->> 'correctAnswer',
    target_room.quiz_questions -> target_room.party_question_index -> 'correctTrack' ->> 'name'
  );
  answer_is_correct := coalesce(trim(target_answer), '') = coalesce(correct_answer, '');
  remaining_seconds := least(
    10,
    greatest(0, extract(epoch from (target_room.party_answer_ends_at - now())))
  );
  earned_points := case
    when answer_is_correct
      then 500 + floor(500 * remaining_seconds / 10)::integer
    else 0
  end;
  answer_seconds := greatest(0, 10 - remaining_seconds);

  insert into public.arena_party_answers (
    room_id,
    round_number,
    question_index,
    user_id,
    answer_text,
    is_correct,
    points,
    answer_time_seconds
  )
  values (
    target_room_id,
    coalesce(target_room.round_number, 1),
    target_room.party_question_index,
    auth.uid(),
    trim(target_answer),
    answer_is_correct,
    earned_points,
    answer_seconds
  )
  on conflict (room_id, round_number, question_index, user_id) do nothing
  returning id into inserted_id;

  if inserted_id is null then
    return jsonb_build_object('accepted', false, 'duplicate', true);
  end if;

  update public.arena_room_players
  set
    current_score = current_score + earned_points,
    current_correct_answers = current_correct_answers + case when answer_is_correct then 1 else 0 end,
    current_question_index = greatest(
      current_question_index,
      target_room.party_question_index + 1
    ),
    current_streak = case when answer_is_correct then current_streak + 1 else 0 end
  where room_id = target_room_id
    and user_id = auth.uid();

  select count(*)::integer
  into competitor_count
  from public.arena_room_players arp
  where arp.room_id = target_room_id
    and arp.user_id <> target_room.host_user_id
    and arp.left_at is null
    and arp.finished_at is null
    and coalesce(arp.result_status, 'active') not in ('cancelled', 'left', 'forfeit');

  select count(*)::integer
  into answered_count
  from public.arena_party_answers apa
  join public.arena_room_players arp
    on arp.room_id = apa.room_id and arp.user_id = apa.user_id
  where apa.room_id = target_room_id
    and apa.round_number = coalesce(target_room.round_number, 1)
    and apa.question_index = target_room.party_question_index
    and arp.user_id <> target_room.host_user_id
    and arp.left_at is null
    and arp.finished_at is null
    and coalesce(arp.result_status, 'active') not in ('cancelled', 'left', 'forfeit');

  if competitor_count > 0 and answered_count >= competitor_count then
    update public.arena_rooms
    set
      party_question_phase = 'reveal',
      party_reveal_ends_at = now() + interval '1.2 seconds'
    where id = target_room_id
      and party_question_index = target_room.party_question_index
      and party_question_phase = 'answering';
  end if;

  return jsonb_build_object(
    'accepted', true,
    'isCorrect', answer_is_correct,
    'points', earned_points,
    'correctAnswer', correct_answer,
    'answerTimeSeconds', answer_seconds
  );
end;
$$;

create or replace function public.skip_party_question(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.arena_rooms%rowtype;
begin
  select *
  into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode = 'party_mode'
    and status = 'active'
    and host_user_id = auth.uid()
  for update;

  if target_room.id is null then
    raise exception 'Only the active Party host can skip a question.';
  end if;

  if target_room.party_question_phase not in ('countdown', 'awaiting_audio', 'answering') then
    return false;
  end if;

  insert into public.arena_party_answers (
    room_id,
    round_number,
    question_index,
    user_id,
    answer_text,
    is_correct,
    points,
    answer_time_seconds
  )
  select
    target_room_id,
    coalesce(target_room.round_number, 1),
    target_room.party_question_index,
    arp.user_id,
    null,
    false,
    0,
    10
  from public.arena_room_players arp
  where arp.room_id = target_room_id
    and arp.user_id <> target_room.host_user_id
    and arp.left_at is null
    and arp.finished_at is null
    and coalesce(arp.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
  on conflict (room_id, round_number, question_index, user_id) do nothing;

  update public.arena_room_players arp
  set
    current_question_index = greatest(
      arp.current_question_index,
      target_room.party_question_index + 1
    ),
    current_streak = 0
  where arp.room_id = target_room_id
    and arp.user_id <> target_room.host_user_id
    and arp.left_at is null
    and arp.finished_at is null
    and coalesce(arp.result_status, 'active') not in ('cancelled', 'left', 'forfeit');

  update public.arena_rooms
  set
    party_audio_question_index = target_room.party_question_index,
    party_audio_status = 'skipped',
    party_audio_updated_at = now(),
    party_question_phase = 'reveal',
    party_reveal_ends_at = now() + interval '1.2 seconds'
  where id = target_room_id;

  return true;
end;
$$;

-- Audio state changes also move the shared Party phase. Guests never call this
-- RPC and therefore cannot become an audio source.
create or replace function public.set_party_audio_state(
  target_room_id uuid,
  target_round_number integer,
  target_question_index integer,
  target_status text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.arena_rooms%rowtype;
begin
  if target_status not in ('pending', 'playing') then
    raise exception 'Invalid Party audio state.';
  end if;

  select *
  into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode = 'party_mode'
    and status = 'active'
    and host_user_id = auth.uid()
    and round_number = target_round_number
  for update;

  if target_room.id is null then
    raise exception 'Only the active Party host can control room audio.';
  end if;

  if target_question_index <> target_room.party_question_index then
    raise exception 'Party audio question is out of date.';
  end if;

  if target_status = 'pending'
    and target_room.party_audio_status <> 'pending'
  then
    raise exception 'Party audio cannot move backwards.';
  end if;

  update public.arena_rooms
  set
    party_audio_question_index = target_question_index,
    party_audio_status = target_status,
    party_audio_updated_at = now(),
    party_question_phase = case
      when target_status = 'playing'
        and now() >= party_answer_starts_at
        and party_question_phase in ('countdown', 'awaiting_audio')
      then 'answering'
      else party_question_phase
    end
  where id = target_room_id;

  return true;
end;
$$;

-- Party hosts are observers, so public progression and placements exclude the
-- host while Duel and Group Lobby keep their existing behavior.
create or replace function public.sync_arena_progression_for_room(target_room_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
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
      coalesce(arp.result_status, 'completed') as result_status,
      coalesce(arp.finished_at, target_room.finished_at, now()) as played_at,
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
        order by result_rank desc, final_score desc, accuracy desc, average_answer_time asc
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
    player_count, placement, score_margin, result_status
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
    resolved.result_status
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
    result_status = excluded.result_status;

  get diagnostics synced_count = row_count;
  return synced_count;
end;
$$;

revoke all on function public.start_party_room(uuid, jsonb)
  from public, anon;
revoke all on function public.sync_party_room_timeline(uuid)
  from public, anon;
revoke all on function public.get_party_server_time(uuid)
  from public, anon;
revoke all on function public.submit_party_answer(uuid, text)
  from public, anon;
revoke all on function public.skip_party_question(uuid)
  from public, anon;
revoke all on function public.set_party_audio_state(uuid, integer, integer, text)
  from public, anon;

grant execute on function public.start_party_room(uuid, jsonb)
  to authenticated;
grant execute on function public.sync_party_room_timeline(uuid)
  to authenticated;
grant execute on function public.get_party_server_time(uuid)
  to authenticated;
grant execute on function public.submit_party_answer(uuid, text)
  to authenticated;
grant execute on function public.skip_party_question(uuid)
  to authenticated;
grant execute on function public.set_party_audio_state(uuid, integer, integer, text)
  to authenticated;

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'arena_rooms'
  ) then
    alter publication supabase_realtime add table public.arena_rooms;
  end if;

  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'arena_room_players'
  ) then
    alter publication supabase_realtime add table public.arena_room_players;
  end if;
end;
$$;

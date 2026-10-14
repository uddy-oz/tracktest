begin;

-- Party Mode has one audio owner: the host. Keep the room authoritative by
-- opening each countdown only after that host has prepared the exact preview.
alter table public.arena_rooms
  add column if not exists party_audio_ready_deadline_at timestamptz;

alter table public.arena_rooms
  drop constraint if exists arena_rooms_party_question_phase_check;

alter table public.arena_rooms
  add constraint arena_rooms_party_question_phase_check
  check (
    party_question_phase in (
      'idle',
      'preparing_audio',
      'countdown',
      'awaiting_audio',
      'answering',
      'reveal',
      'finished'
    )
  );

create or replace function public._skip_party_question_internal(
  target_room_id uuid,
  target_round_number integer,
  target_question_index integer
)
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
    and round_number = target_round_number
    and party_question_index = target_question_index
  for update;

  if target_room.id is null
    or target_room.party_question_phase not in (
      'preparing_audio',
      'countdown',
      'awaiting_audio',
      'answering'
    )
  then
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
    target_round_number,
    target_question_index,
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
      target_question_index + 1
    ),
    current_streak = 0
  where arp.room_id = target_room_id
    and arp.user_id <> target_room.host_user_id
    and arp.left_at is null
    and arp.finished_at is null
    and coalesce(arp.result_status, 'active') not in ('cancelled', 'left', 'forfeit');

  update public.arena_rooms
  set
    party_audio_question_index = target_question_index,
    party_audio_status = 'skipped',
    party_audio_updated_at = clock_timestamp(),
    party_audio_ready_deadline_at = null,
    party_question_phase = 'reveal',
    party_reveal_ends_at = clock_timestamp() + interval '1.2 seconds'
  where id = target_room_id
    and round_number = target_round_number
    and party_question_index = target_question_index;

  return true;
end;
$$;

revoke all on function public._skip_party_question_internal(uuid, integer, integer)
  from public, anon, authenticated;

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
  preparation_deadline timestamptz;
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

  preparation_deadline := clock_timestamp() + interval '8 seconds';

  update public.arena_rooms
  set
    status = 'active',
    started_at = clock_timestamp(),
    finished_at = null,
    quiz_questions = target_questions,
    party_question_index = 0,
    party_question_phase = 'preparing_audio',
    party_clip_starts_at = null,
    party_answer_starts_at = null,
    party_answer_ends_at = null,
    party_reveal_ends_at = null,
    party_audio_question_index = 0,
    party_audio_status = 'pending',
    party_audio_updated_at = clock_timestamp(),
    party_audio_ready_deadline_at = preparation_deadline
  where id = target_room_id;

  return true;
end;
$$;

create or replace function public.start_prepared_party_question(
  target_room_id uuid,
  target_round_number integer,
  target_question_index integer,
  target_preview_url text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.arena_rooms%rowtype;
  expected_preview_url text;
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
    and status = 'active'
  for update;

  if auth.uid() is null
    or target_room.id is null
    or target_room.host_user_id <> auth.uid()
  then
    raise exception 'Only the active Party host can start a prepared question.';
  end if;

  if target_room.round_number <> target_round_number
    or target_room.party_question_index <> target_question_index
    or target_room.party_question_phase <> 'preparing_audio'
    or target_room.party_audio_status <> 'pending'
  then
    return false;
  end if;

  expected_preview_url := coalesce(
    target_room.quiz_questions -> target_question_index -> 'correctTrack' ->> 'previewUrl',
    ''
  );

  if expected_preview_url = ''
    or expected_preview_url is distinct from coalesce(target_preview_url, '')
  then
    return false;
  end if;

  if target_room.party_audio_ready_deadline_at is not null
    and clock_timestamp() >= target_room.party_audio_ready_deadline_at
  then
    return false;
  end if;

  server_starts_at := clock_timestamp() + interval '3 seconds';

  update public.arena_rooms
  set
    party_question_phase = 'countdown',
    party_clip_starts_at = server_starts_at,
    party_answer_starts_at = server_starts_at,
    party_answer_ends_at = server_starts_at + interval '10 seconds',
    party_reveal_ends_at = null,
    party_audio_question_index = target_question_index,
    party_audio_status = 'pending',
    party_audio_updated_at = clock_timestamp(),
    party_audio_ready_deadline_at = server_starts_at + interval '4 seconds'
  where id = target_room_id
    and round_number = target_round_number
    and party_question_index = target_question_index
    and party_question_phase = 'preparing_audio';

  return found;
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
  preparation_deadline timestamptz;
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

  if target_room.party_question_phase = 'preparing_audio' then
    if target_room.party_audio_ready_deadline_at is not null
      and clock_timestamp() >= target_room.party_audio_ready_deadline_at
    then
      return public._skip_party_question_internal(
        target_room_id,
        coalesce(target_room.round_number, 1),
        target_room.party_question_index
      );
    end if;

    return false;
  end if;

  if target_room.party_question_phase = 'countdown'
    and clock_timestamp() >= target_room.party_answer_starts_at
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

  if target_room.party_question_phase = 'awaiting_audio'
    and target_room.party_audio_status <> 'playing'
    and target_room.party_audio_ready_deadline_at is not null
    and clock_timestamp() >= target_room.party_audio_ready_deadline_at
  then
    return public._skip_party_question_internal(
      target_room_id,
      coalesce(target_room.round_number, 1),
      target_room.party_question_index
    );
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
        finished_at = coalesce(finished_at, clock_timestamp()),
        party_audio_ready_deadline_at = null
      where id = target_room_id;
      return true;
    end if;

    if clock_timestamp() >= target_room.party_answer_ends_at then
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
        party_reveal_ends_at = clock_timestamp() + interval '1.2 seconds',
        party_audio_ready_deadline_at = null
      where id = target_room_id;
      return true;
    end if;

    if answered_count >= competitor_count then
      update public.arena_rooms
      set
        party_question_phase = 'reveal',
        party_reveal_ends_at = clock_timestamp() + interval '1.2 seconds',
        party_audio_ready_deadline_at = null
      where id = target_room_id;
      return true;
    end if;
  end if;

  if target_room.party_question_phase = 'reveal'
    and target_room.party_reveal_ends_at is not null
    and clock_timestamp() >= target_room.party_reveal_ends_at
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
        finished_at = coalesce(arp.finished_at, clock_timestamp()),
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
        finished_at = coalesce(finished_at, clock_timestamp()),
        party_clip_starts_at = null,
        party_answer_starts_at = null,
        party_answer_ends_at = null,
        party_reveal_ends_at = null,
        party_audio_status = 'idle',
        party_audio_updated_at = clock_timestamp(),
        party_audio_ready_deadline_at = null
      where id = target_room_id;
      return true;
    end if;

    preparation_deadline := clock_timestamp() + interval '8 seconds';

    update public.arena_rooms
    set
      party_question_index = next_question,
      party_question_phase = 'preparing_audio',
      party_clip_starts_at = null,
      party_answer_starts_at = null,
      party_answer_ends_at = null,
      party_reveal_ends_at = null,
      party_audio_question_index = next_question,
      party_audio_status = 'pending',
      party_audio_updated_at = clock_timestamp(),
      party_audio_ready_deadline_at = preparation_deadline
    where id = target_room_id;
    return true;
  end if;

  return false;
end;
$$;

create or replace function public.skip_party_question_v2(
  target_room_id uuid,
  target_round_number integer,
  target_question_index integer
)
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
  for update;

  if auth.uid() is null
    or target_room.id is null
    or target_room.host_user_id <> auth.uid()
  then
    raise exception 'Only the active Party host can skip a question.';
  end if;

  return public._skip_party_question_internal(
    target_room_id,
    target_round_number,
    target_question_index
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
  for update;

  if auth.uid() is null
    or target_room.id is null
    or target_room.host_user_id <> auth.uid()
  then
    raise exception 'Only the active Party host can skip a question.';
  end if;

  return public._skip_party_question_internal(
    target_room_id,
    coalesce(target_room.round_number, 1),
    target_room.party_question_index
  );
end;
$$;

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

  if target_room.party_question_phase not in ('countdown', 'awaiting_audio', 'answering')
    or (
      target_status = 'playing'
      and target_room.party_audio_ready_deadline_at is not null
      and clock_timestamp() >= target_room.party_audio_ready_deadline_at
    )
  then
    return false;
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
    party_audio_updated_at = clock_timestamp(),
    party_audio_ready_deadline_at = case
      when target_status = 'playing' then null
      else party_audio_ready_deadline_at
    end,
    party_question_phase = case
      when target_status = 'playing'
        and clock_timestamp() >= party_answer_starts_at
        and party_question_phase in ('countdown', 'awaiting_audio')
      then 'answering'
      else party_question_phase
    end
  where id = target_room_id;

  return true;
end;
$$;

revoke all on function public.start_party_room(uuid, jsonb) from public;
revoke all on function public.start_prepared_party_question(uuid, integer, integer, text) from public;
revoke all on function public.sync_party_room_timeline(uuid) from public;
revoke all on function public.skip_party_question_v2(uuid, integer, integer) from public;
revoke all on function public.skip_party_question(uuid) from public;
revoke all on function public.set_party_audio_state(uuid, integer, integer, text) from public;

grant execute on function public.start_party_room(uuid, jsonb) to authenticated;
grant execute on function public.start_prepared_party_question(uuid, integer, integer, text) to authenticated;
grant execute on function public.sync_party_room_timeline(uuid) to authenticated;
grant execute on function public.skip_party_question_v2(uuid, integer, integer) to authenticated;
grant execute on function public.skip_party_question(uuid) to authenticated;
grant execute on function public.set_party_audio_state(uuid, integer, integer, text) to authenticated;

commit;

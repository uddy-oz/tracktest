begin;

create schema if not exists arena_private;
revoke all on schema arena_private from public, anon, authenticated, service_role;

create table if not exists arena_private.question_sets (
  id uuid primary key,
  room_id uuid not null references public.arena_rooms(id) on delete cascade,
  host_user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('duel', 'group_lobby', 'party_mode')),
  round_number integer not null check (round_number > 0),
  target_question_count integer not null check (target_question_count between 5 and 12),
  public_questions jsonb not null check (jsonb_typeof(public_questions) = 'array'),
  reserve_questions jsonb not null default '[]'::jsonb check (jsonb_typeof(reserve_questions) = 'array'),
  created_at timestamptz not null default clock_timestamp(),
  activated_at timestamptz
);

create table if not exists arena_private.question_keys (
  question_set_id uuid not null references arena_private.question_sets(id) on delete cascade,
  room_id uuid not null references public.arena_rooms(id) on delete cascade,
  round_number integer not null,
  question_id uuid not null,
  correct_option_id text not null,
  correct_answer text not null,
  correct_track_id text not null,
  preview_url text not null,
  clip_start_seconds numeric not null default 8,
  primary key (question_set_id, question_id),
  unique (room_id, round_number, question_id),
  check (preview_url like 'https://audio-ssl.itunes.apple.com/%'
      or preview_url like 'https://audio.itunes.apple.com/%')
);

create index if not exists arena_private_question_keys_room_round_idx
  on arena_private.question_keys (room_id, round_number, question_id);

alter table arena_private.question_sets enable row level security;
alter table arena_private.question_keys enable row level security;
revoke all on all tables in schema arena_private from public, anon, authenticated, service_role;
revoke all on all sequences in schema arena_private from public, anon, authenticated, service_role;

-- Answer submissions are private server state. The room-player table is
-- replicated to clients, so never persist a selected option or correctness
-- bit there; the answered index remains sufficient to lock reconnecting clients.
update public.arena_room_players
set competitive_selected_answer = null,
    competitive_answer_was_correct = null
where competitive_selected_answer is not null
   or competitive_answer_was_correct is not null;

-- Party answer rows also contain option IDs and correctness. They are consumed
-- only by SECURITY DEFINER timeline functions, never by browser queries.
revoke all on table public.arena_party_answers from public, anon, authenticated;
drop policy if exists "Party room members can read answers"
  on public.arena_party_answers;
revoke all on table public.arena_competitive_answers from public, anon, authenticated;

do $$
begin
  if exists (
    select 1 from public.arena_rooms r
    where r.status in ('starting', 'active')
      and coalesce(jsonb_array_length(r.quiz_questions), 0) > 0
      and not exists (
        select 1 from arena_private.question_sets s
        where s.room_id = r.id
          and s.round_number = coalesce(r.round_number, 1)
          and s.activated_at is not null
      )
  ) then
    raise exception 'Drain legacy active Arena games before applying secure answer staging.';
  end if;
end;
$$;

-- Clear legacy client-authored question payloads from waiting and historical
-- rooms. Active rooms with a trusted staged set are preserved.
update public.arena_rooms
set quiz_questions = '[]'::jsonb,
    competitive_reserve_questions = '[]'::jsonb
where status not in ('starting', 'active')
  and (coalesce(jsonb_array_length(quiz_questions), 0) > 0
    or coalesce(jsonb_array_length(competitive_reserve_questions), 0) > 0);

alter table public.arena_rooms
  add column if not exists competitive_revealed_answer text,
  add column if not exists competitive_revealed_option_id text,
  add column if not exists party_revealed_answer text,
  add column if not exists party_revealed_option_id text;

create or replace function public.stage_arena_question_set(
  p_room_id uuid,
  p_host_user_id uuid,
  p_mode text,
  p_round_number integer,
  p_question_set_id uuid,
  p_target_question_count integer,
  p_public_questions jsonb,
  p_reserve_questions jsonb,
  p_question_keys jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
  existing_set_id uuid;
  question_count integer;
  reserve_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Trusted server authorization is required.';
  end if;

  select * into target_room
  from public.arena_rooms
  where id = p_room_id
  for update;
  if target_room.id is null
    or target_room.host_user_id <> p_host_user_id
    or target_room.status <> 'waiting'
    or target_room.mode <> p_mode
    or target_room.round_number <> p_round_number
  then
    raise exception 'The host or waiting room changed before question staging.';
  end if;

  -- Room-row locking makes preparation idempotent. A lost response or repeat
  -- click reuses the same unactivated set instead of sampling fresh questions.
  select id into existing_set_id from arena_private.question_sets
  where room_id = p_room_id and round_number = p_round_number
    and activated_at is null
  order by created_at limit 1;
  if existing_set_id is not null then return existing_set_id; end if;

  if jsonb_typeof(p_public_questions) <> 'array'
    or jsonb_typeof(p_reserve_questions) <> 'array'
    or jsonb_typeof(p_question_keys) <> 'array'
  then
    raise exception 'Question snapshots are malformed.';
  end if;

  question_count := jsonb_array_length(p_public_questions);
  reserve_count := jsonb_array_length(p_reserve_questions);
  if question_count <> p_target_question_count
    or question_count not between 5 and 12
    or jsonb_array_length(p_question_keys) <> question_count + reserve_count
    or (p_mode = 'party_mode' and reserve_count <> 0)
  then
    raise exception 'Question set size is invalid.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_public_questions || p_reserve_questions) q(value)
    where jsonb_typeof(q.value -> 'options') <> 'array'
      or jsonb_array_length(q.value -> 'options') <> 4
      or not exists (
        select 1 from jsonb_array_elements(p_question_keys) k(value)
        where k.value ->> 'questionId' = q.value ->> 'questionId'
          and coalesce(k.value ->> 'correctOptionId', '') <> ''
          and coalesce(k.value ->> 'correctAnswer', '') <> ''
          and coalesce(k.value ->> 'correctTrackId', '') <> ''
          and exists (
            select 1 from jsonb_array_elements(q.value -> 'options') o(value)
            where o.value ->> 'id' = k.value ->> 'correctOptionId'
              and o.value ->> 'name' = k.value ->> 'correctAnswer'
          )
      )
  ) then
    raise exception 'A question has no matching server-held answer key.';
  end if;

  delete from arena_private.question_sets old_set
  where old_set.room_id = p_room_id
    and old_set.activated_at is null
    and old_set.round_number = p_round_number;

  insert into arena_private.question_sets (
    id, room_id, host_user_id, mode, round_number,
    target_question_count, public_questions, reserve_questions
  ) values (
    p_question_set_id, p_room_id, p_host_user_id, p_mode, p_round_number,
    p_target_question_count, p_public_questions, p_reserve_questions
  );

  insert into arena_private.question_keys (
    question_set_id, room_id, round_number, question_id,
    correct_option_id, correct_answer, correct_track_id,
    preview_url, clip_start_seconds
  )
  select
    p_question_set_id, p_room_id, p_round_number,
    (key.value ->> 'questionId')::uuid,
    key.value ->> 'correctOptionId',
    key.value ->> 'correctAnswer',
    key.value ->> 'correctTrackId',
    key.value ->> 'previewUrl',
    coalesce((key.value ->> 'clipStartSeconds')::numeric, 8)
  from jsonb_array_elements(p_question_keys) key(value);

  return p_question_set_id;
end;
$$;

revoke all on function public.stage_arena_question_set(uuid, uuid, text, integer, uuid, integer, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.stage_arena_question_set(uuid, uuid, text, integer, uuid, integer, jsonb, jsonb, jsonb)
  to service_role;

create or replace function public.activate_arena_question_set(
  target_room_id uuid,
  target_question_set_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_room public.arena_rooms%rowtype;
  target_set arena_private.question_sets%rowtype;
  active_count integer;
  not_ready_count integer;
  minimum_players integer;
  staged_round_id uuid;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into target_room from public.arena_rooms
  where id = target_room_id for update;
  select * into target_set from arena_private.question_sets
  where id = target_question_set_id and room_id = target_room_id for update;

  if target_room.id is null or target_set.id is null
    or target_room.host_user_id <> caller_id
    or target_set.host_user_id <> caller_id
    or target_room.mode <> target_set.mode
    or target_room.round_number <> target_set.round_number
  then
    raise exception 'Only the room host can activate its current trusted question set.';
  end if;

  if target_set.activated_at is not null then
    if target_room.status in ('starting', 'active')
      and target_room.quiz_questions -> 0 ->> 'questionId' =
        target_set.public_questions -> 0 ->> 'questionId'
    then return true; end if;
    raise exception 'This question set has already been used.';
  end if;
  if target_room.status <> 'waiting' then
    raise exception 'This room is no longer waiting.';
  end if;

  select count(*)::integer,
         count(*) filter (where not coalesce(lobby_ready, false))::integer
  into active_count, not_ready_count
  from public.arena_room_players
  where room_id = target_room_id and left_at is null and finished_at is null
    and coalesce(result_status, 'active') not in ('cancelled', 'left', 'forfeit');

  minimum_players := case target_room.mode
    when 'duel' then 2 when 'group_lobby' then 3 else 2 end;
  if active_count < minimum_players or active_count > target_room.max_players then
    raise exception 'The room does not have a valid player count.';
  end if;
  if target_room.mode <> 'party_mode' and not_ready_count > 0 then
    raise exception 'Every current player must ready up before the match starts.';
  end if;

  delete from public.arena_competitive_answers
  where room_id = target_room_id and room_round_number = target_room.round_number;
  delete from public.arena_competitive_audio_readiness
  where room_id = target_room_id and room_round_number = target_room.round_number;
  delete from public.arena_party_answers
  where room_id = target_room_id and round_number = target_room.round_number;

  update public.arena_room_players set
    final_score = 0, correct_answers = 0, total_questions = 0,
    average_answer_time = 0, current_score = 0,
    current_correct_answers = 0, current_question_index = 0,
    current_streak = 0, round_points = 0, rounds_won = 0, rounds_played = 0,
    winning_response_total_ms = 0, average_winning_response_ms = 0,
    fastest_winning_response_ms = null,
    competitive_answered_question_index = -1,
    competitive_selected_answer = null, competitive_answer_was_correct = null,
    is_ready = false, finished_at = null, forfeited_at = null,
    result_status = 'active'
  where room_id = target_room_id and left_at is null
    and coalesce(result_status, 'active') not in ('cancelled', 'left');

  if target_room.mode = 'party_mode' then
    update public.arena_rooms set
      status = 'active', started_at = clock_timestamp(), finished_at = null,
      quiz_questions = target_set.public_questions,
      party_question_index = 0, party_question_phase = 'preparing_audio',
      party_clip_starts_at = null, party_answer_starts_at = null,
      party_answer_ends_at = null, party_reveal_ends_at = null,
      party_audio_question_index = 0, party_audio_status = 'pending',
      party_audio_updated_at = clock_timestamp(),
      party_audio_ready_deadline_at = clock_timestamp() + interval '8 seconds',
      party_revealed_answer = null, party_revealed_option_id = null
    where id = target_room_id;
  else
    staged_round_id := gen_random_uuid();
    update public.arena_rooms set
      status = 'starting', started_at = null, finished_at = null,
      quiz_questions = target_set.public_questions,
      competitive_reserve_questions = target_set.reserve_questions,
      competitive_reserve_replacements = 0,
      competitive_target_question_count = target_set.target_question_count,
      competitive_question_index = 0, competitive_round_id = staged_round_id,
      competitive_round_phase = 'preparing_audio',
      competitive_answer_starts_at = null, competitive_answer_ends_at = null,
      competitive_reveal_ends_at = null, competitive_round_winner_user_id = null,
      competitive_winning_answer_at = null, competitive_winning_response_ms = null,
      competitive_audio_prepare_started_at = clock_timestamp(),
      competitive_audio_ready_deadline_at = null,
      competitive_required_ready_count = active_count,
      competitive_ready_count = 0, competitive_audio_failed = false,
      competitive_audio_failure_reason = null,
      competitive_revealed_answer = null, competitive_revealed_option_id = null
    where id = target_room_id;
  end if;

  update arena_private.question_sets
  set activated_at = clock_timestamp()
  where id = target_set.id;
  return true;
end;
$$;

revoke all on function public.activate_arena_question_set(uuid, uuid) from public, anon;
grant execute on function public.activate_arena_question_set(uuid, uuid) to authenticated;

create or replace function public.get_arena_question_audio(
  target_room_id uuid,
  target_question_index integer,
  target_question_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_room public.arena_rooms%rowtype;
  expected_index integer;
  answer_key arena_private.question_keys%rowtype;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into target_room from public.arena_rooms where id = target_room_id;
  if target_room.id is null or target_room.status not in ('starting', 'active') then
    raise exception 'This Arena question is not active.';
  end if;

  if target_room.mode = 'party_mode' then
    if target_room.host_user_id <> caller_id then
      raise exception 'Only the Party host can retrieve the audio source.';
    end if;
    expected_index := target_room.party_question_index;
  else
    if not exists (
      select 1 from public.arena_room_players p
      where p.room_id = target_room_id and p.user_id = caller_id
        and p.left_at is null and p.finished_at is null
        and coalesce(p.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
    ) then raise exception 'Active room membership is required.'; end if;
    expected_index := case when target_room.status = 'starting'
      then 0 else target_room.competitive_question_index end;
  end if;

  if target_question_index <> expected_index
    or target_room.quiz_questions -> target_question_index ->> 'questionId'
      is distinct from target_question_id::text
    or (target_room.mode = 'party_mode'
      and target_room.party_question_phase not in ('preparing_audio', 'countdown', 'awaiting_audio', 'answering'))
    or (target_room.mode <> 'party_mode'
      and target_room.competitive_round_phase not in ('preparing_audio', 'countdown', 'answering'))
  then raise exception 'Audio source request is stale or outside the active question.'; end if;

  select * into answer_key from arena_private.question_keys
  where room_id = target_room_id and round_number = target_room.round_number
    and question_id = target_question_id;
  if answer_key.question_id is null then raise exception 'Trusted audio source is unavailable.'; end if;

  return jsonb_build_object(
    'questionId', answer_key.question_id,
    'previewUrl', answer_key.preview_url,
    'clipStartSeconds', answer_key.clip_start_seconds
  );
end;
$$;

revoke all on function public.get_arena_question_audio(uuid, integer, uuid) from public, anon;
grant execute on function public.get_arena_question_audio(uuid, integer, uuid) to authenticated;

create or replace function public.publish_arena_revealed_answer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_question_id uuid;
  answer_key arena_private.question_keys%rowtype;
begin
  if new.mode in ('duel', 'group_lobby') then
    if new.competitive_round_phase = 'reveal'
      and (tg_op = 'INSERT' or old.competitive_round_phase is distinct from 'reveal'
        or old.competitive_question_index is distinct from new.competitive_question_index)
    then
      current_question_id := nullif(
        new.quiz_questions -> new.competitive_question_index ->> 'questionId', ''
      )::uuid;
      select * into answer_key from arena_private.question_keys
      where room_id = new.id and round_number = new.round_number
        and question_id = current_question_id;
      new.competitive_revealed_answer := answer_key.correct_answer;
      new.competitive_revealed_option_id := answer_key.correct_option_id;
    elsif new.competitive_round_phase is distinct from 'reveal' then
      new.competitive_revealed_answer := null;
      new.competitive_revealed_option_id := null;
    end if;
  elsif new.mode = 'party_mode' then
    if new.party_question_phase = 'reveal'
      and (tg_op = 'INSERT' or old.party_question_phase is distinct from 'reveal'
        or old.party_question_index is distinct from new.party_question_index)
    then
      current_question_id := nullif(
        new.quiz_questions -> new.party_question_index ->> 'questionId', ''
      )::uuid;
      select * into answer_key from arena_private.question_keys
      where room_id = new.id and round_number = new.round_number
        and question_id = current_question_id;
      new.party_revealed_answer := answer_key.correct_answer;
      new.party_revealed_option_id := answer_key.correct_option_id;

      -- Keep public player totals unchanged while answers are still being
      -- collected. Publish this question's aggregate only at the shared reveal.
      update public.arena_room_players player set
        current_score = player.current_score + coalesce(answer.points, 0),
        current_correct_answers = player.current_correct_answers
          + case when coalesce(answer.is_correct, false) then 1 else 0 end,
        current_question_index = greatest(
          player.current_question_index, new.party_question_index + 1
        ),
        current_streak = case when coalesce(answer.is_correct, false)
          then player.current_streak + 1 else 0 end
      from (
        select member.user_id, submitted.points, submitted.is_correct
        from public.arena_room_players member
        left join public.arena_party_answers submitted
          on submitted.room_id = new.id
          and submitted.round_number = coalesce(new.round_number, 1)
          and submitted.question_index = new.party_question_index
          and submitted.user_id = member.user_id
        where member.room_id = new.id
          and member.user_id <> new.host_user_id
          and member.left_at is null and member.finished_at is null
          and coalesce(member.result_status, 'active')
            not in ('cancelled', 'left', 'forfeit')
      ) answer
      where player.room_id = new.id and player.user_id = answer.user_id;
    elsif new.party_question_phase is distinct from 'reveal' then
      new.party_revealed_answer := null;
      new.party_revealed_option_id := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists publish_arena_revealed_answer on public.arena_rooms;
create trigger publish_arena_revealed_answer
before insert or update
on public.arena_rooms
for each row execute function public.publish_arena_revealed_answer();
revoke all on function public.publish_arena_revealed_answer() from public, anon, authenticated;

-- Existing clients may no longer submit question JSON directly. Only the
-- trusted server stages a catalog-validated snapshot; the host activates its
-- opaque, one-use set identifier after the existing audio unlock gesture.
revoke all on function public.prepare_competitive_arena_room(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.prepare_competitive_arena_room_v2(uuid, jsonb, integer) from public, anon, authenticated;
revoke all on function public.start_competitive_arena_room(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.start_party_room(uuid, jsonb) from public, anon, authenticated;

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
  current_question_id uuid;
  expected_preview_url text;
  required_count integer;
  ready_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  select * into target_room from public.arena_rooms
  where id = target_room_id and mode in ('duel', 'group_lobby')
    and status = 'starting' for update;
  if target_room.id is null then return jsonb_build_object('accepted', false, 'inactiveRoom', true); end if;
  if target_room.competitive_round_id is distinct from target_round_id
    or target_room.competitive_question_index <> 0
    or target_room.competitive_round_phase <> 'preparing_audio'
  then return jsonb_build_object('accepted', false, 'staleRound', true); end if;
  if not exists (
    select 1 from public.arena_room_players p where p.room_id = target_room_id
      and p.user_id = auth.uid() and p.left_at is null and p.finished_at is null
      and coalesce(p.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
  ) then raise exception 'You are not an active player in this room.'; end if;

  current_question_id := nullif(target_room.quiz_questions -> 0 ->> 'questionId', '')::uuid;
  select key.preview_url into expected_preview_url
  from arena_private.question_keys key
  where key.room_id = target_room_id and key.round_number = target_room.round_number
    and key.question_id = current_question_id;
  if expected_preview_url is null or target_preview_url is distinct from expected_preview_url then
    raise exception 'Audio readiness does not match the trusted staged question.';
  end if;

  update public.arena_room_players set is_ready = true
  where room_id = target_room_id and user_id = auth.uid() and left_at is null and finished_at is null;
  insert into public.arena_competitive_audio_readiness (
    room_id, room_round_number, round_id, question_index, user_id,
    preview_url, readiness_status, failure_reason, acknowledged_at
  ) values (
    target_room_id, coalesce(target_room.round_number, 1), target_round_id, 0,
    auth.uid(), target_preview_url, 'ready', null, clock_timestamp()
  ) on conflict (room_id, room_round_number, round_id, user_id)
  do update set question_index = 0, preview_url = excluded.preview_url,
    readiness_status = 'ready', failure_reason = null,
    acknowledged_at = excluded.acknowledged_at;

  select count(*)::integer into required_count from public.arena_room_players p
  where p.room_id = target_room_id and p.left_at is null and p.finished_at is null
    and coalesce(p.result_status, 'active') not in ('cancelled', 'left', 'forfeit');
  select count(*)::integer into ready_count from public.arena_room_players p
  where p.room_id = target_room_id and p.is_ready and p.left_at is null and p.finished_at is null
    and coalesce(p.result_status, 'active') not in ('cancelled', 'left', 'forfeit');
  update public.arena_rooms set competitive_required_ready_count = required_count,
    competitive_ready_count = ready_count where id = target_room_id;
  return jsonb_build_object('accepted', true, 'requiredCount', required_count,
    'readyCount', ready_count, 'allReady', required_count > 0 and ready_count >= required_count);
end;
$$;

-- Reconciliation ACK for later competitive rounds; only the private key store
-- is consulted for the expected source URL.
create or replace function public.acknowledge_competitive_audio_ready_v2(
  target_room_id uuid,
  target_match_generation integer,
  target_round_id uuid,
  target_question_index integer,
  target_preview_url text,
  target_client_id text default null,
  target_ack_attempt integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
  membership public.arena_room_players%rowtype;
  current_question_uuid uuid;
  expected_preview_url text;
  required_count integer;
  ready_count_before integer;
  ready_count_after integer;
  acknowledgement_existed boolean;
  already_ready boolean;
  server_starts_at timestamptz;
  server_phase text;
  authoritative_round_key text;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  select * into target_room from public.arena_rooms
  where id = target_room_id and mode in ('duel', 'group_lobby') and status = 'active'
  for update;
  if target_room.id is null then
    return jsonb_build_object('accepted', false, 'alreadyReady', false, 'reason', 'inactive_room');
  end if;
  authoritative_round_key := concat_ws(':', target_room.id::text,
    coalesce(target_room.round_number, 1)::text,
    coalesce(target_room.competitive_round_id::text, 'missing'),
    target_room.competitive_question_index::text);
  select * into membership from public.arena_room_players player
  where player.room_id = target_room_id and player.user_id = auth.uid()
    and player.left_at is null and player.finished_at is null
    and coalesce(player.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
  order by player.joined_at desc limit 1;
  if membership.id is null then
    return jsonb_build_object('accepted', false, 'alreadyReady', false,
      'reason', 'inactive_player', 'roundKey', authoritative_round_key,
      'serverPhase', target_room.competitive_round_phase);
  end if;
  select count(*)::integer into required_count from public.arena_room_players player
  where player.room_id = target_room_id and player.left_at is null
    and player.finished_at is null
    and coalesce(player.result_status, 'active') not in ('cancelled', 'left', 'forfeit');
  select count(*)::integer into ready_count_before
  from public.arena_competitive_audio_readiness readiness
  join public.arena_room_players player on player.room_id = readiness.room_id
    and player.user_id = readiness.user_id
  where readiness.room_id = target_room_id
    and readiness.room_round_number = coalesce(target_room.round_number, 1)
    and readiness.round_id = target_room.competitive_round_id
    and readiness.question_index = target_room.competitive_question_index
    and readiness.readiness_status = 'ready'
    and player.left_at is null and player.finished_at is null
    and coalesce(player.result_status, 'active') not in ('cancelled', 'left', 'forfeit');
  if coalesce(target_room.round_number, 1) <> target_match_generation
    or target_room.competitive_round_id is distinct from target_round_id
    or target_room.competitive_question_index <> target_question_index then
    return jsonb_build_object('accepted', false, 'alreadyReady', false,
      'reason', 'round_key_mismatch', 'readyCount', ready_count_before,
      'requiredCount', required_count, 'roundKey', authoritative_round_key,
      'serverPhase', target_room.competitive_round_phase, 'membershipId', membership.id);
  end if;
  current_question_uuid := nullif(target_room.quiz_questions -> target_question_index ->> 'questionId', '')::uuid;
  select key.preview_url into expected_preview_url from arena_private.question_keys key
  where key.room_id = target_room_id and key.round_number = target_match_generation
    and key.question_id = current_question_uuid;
  if expected_preview_url is null or target_preview_url is distinct from expected_preview_url then
    return jsonb_build_object('accepted', false, 'alreadyReady', false,
      'reason', 'preview_url_mismatch', 'readyCount', ready_count_before,
      'requiredCount', required_count, 'roundKey', authoritative_round_key,
      'serverPhase', target_room.competitive_round_phase, 'membershipId', membership.id);
  end if;
  select exists (select 1 from public.arena_competitive_audio_readiness readiness
      where readiness.room_id = target_room_id and readiness.room_round_number = target_match_generation
        and readiness.round_id = target_round_id and readiness.user_id = auth.uid()),
    exists (select 1 from public.arena_competitive_audio_readiness readiness
      where readiness.room_id = target_room_id and readiness.room_round_number = target_match_generation
        and readiness.round_id = target_round_id and readiness.question_index = target_question_index
        and readiness.user_id = auth.uid() and readiness.preview_url = target_preview_url
        and readiness.readiness_status = 'ready')
  into acknowledgement_existed, already_ready;
  if not already_ready and target_room.competitive_round_phase <> 'preparing_audio' then
    return jsonb_build_object('accepted', false, 'alreadyReady', false,
      'acknowledgementExisted', acknowledgement_existed, 'reason', 'readiness_closed',
      'readyCount', ready_count_before, 'requiredCount', required_count,
      'roundKey', authoritative_round_key, 'serverPhase', target_room.competitive_round_phase,
      'membershipId', membership.id);
  end if;
  if not already_ready then
    insert into public.arena_competitive_audio_readiness as readiness_row (
      room_id, room_round_number, round_id, question_index, user_id, preview_url,
      readiness_status, failure_reason, acknowledged_at, client_id, ack_attempt, acknowledgement_count
    ) values (target_room_id, target_match_generation, target_round_id,
      target_question_index, auth.uid(), target_preview_url, 'ready', null,
      clock_timestamp(), left(nullif(target_client_id, ''), 120),
      greatest(coalesce(target_ack_attempt, 1), 1), 1)
    on conflict (room_id, room_round_number, round_id, user_id) do update set
      question_index = excluded.question_index, preview_url = excluded.preview_url,
      readiness_status = 'ready', failure_reason = null,
      acknowledged_at = excluded.acknowledged_at, client_id = excluded.client_id,
      ack_attempt = excluded.ack_attempt,
      acknowledgement_count = readiness_row.acknowledgement_count + 1;
  else
    update public.arena_competitive_audio_readiness set
      acknowledged_at = clock_timestamp(),
      client_id = coalesce(left(nullif(target_client_id, ''), 120), client_id),
      ack_attempt = greatest(coalesce(target_ack_attempt, 1), 1),
      acknowledgement_count = acknowledgement_count + 1
    where room_id = target_room_id and room_round_number = target_match_generation
      and round_id = target_round_id and user_id = auth.uid();
  end if;
  select count(*)::integer into ready_count_after
  from public.arena_competitive_audio_readiness readiness
  join public.arena_room_players player on player.room_id = readiness.room_id
    and player.user_id = readiness.user_id
  where readiness.room_id = target_room_id and readiness.room_round_number = target_match_generation
    and readiness.round_id = target_round_id and readiness.question_index = target_question_index
    and readiness.readiness_status = 'ready' and player.left_at is null
    and player.finished_at is null
    and coalesce(player.result_status, 'active') not in ('cancelled', 'left', 'forfeit');
  server_phase := target_room.competitive_round_phase;
  if target_room.competitive_round_phase = 'preparing_audio'
    and required_count > 0 and ready_count_after >= required_count then
    server_starts_at := clock_timestamp() + interval '3 seconds';
    server_phase := 'countdown';
    update public.arena_rooms set competitive_round_phase = 'countdown',
      competitive_answer_starts_at = server_starts_at,
      competitive_answer_ends_at = server_starts_at + interval '10 seconds',
      competitive_audio_ready_deadline_at = null,
      competitive_required_ready_count = required_count,
      competitive_ready_count = ready_count_after where id = target_room_id;
  elsif target_room.competitive_round_phase = 'preparing_audio' then
    update public.arena_rooms set competitive_required_ready_count = required_count,
      competitive_ready_count = ready_count_after where id = target_room_id;
  end if;
  return jsonb_build_object('accepted', true, 'alreadyReady', already_ready,
    'acknowledgementExisted', acknowledgement_existed, 'reason', null,
    'readyCountBefore', ready_count_before, 'readyCount', ready_count_after,
    'requiredCount', required_count, 'matchGeneration', target_match_generation,
    'roundNumber', target_match_generation, 'roundKey', authoritative_round_key,
    'serverPhase', server_phase, 'membershipId', membership.id, 'userId', auth.uid(),
    'clientId', left(nullif(target_client_id, ''), 120),
    'ackAttempt', greatest(coalesce(target_ack_attempt, 1), 1),
    'answerStartsAt', server_starts_at);
end;
$$;

create or replace function public.report_competitive_audio_failure(
  target_room_id uuid, target_round_id uuid, target_question_index integer,
  target_preview_url text, failure_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
  resulting_room public.arena_rooms%rowtype;
  current_question_uuid uuid;
  expected_preview_url text;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  select * into target_room from public.arena_rooms
  where id = target_room_id and mode in ('duel', 'group_lobby')
    and status in ('starting', 'active') for update;
  if target_room.id is null then return jsonb_build_object('accepted', false, 'inactiveRoom', true); end if;
  if not exists (select 1 from public.arena_room_players player
    where player.room_id = target_room_id and player.user_id = auth.uid()
      and player.left_at is null and player.finished_at is null
      and coalesce(player.result_status, 'active') not in ('cancelled', 'left', 'forfeit'))
  then return jsonb_build_object('accepted', false, 'inactivePlayer', true); end if;
  if target_room.competitive_round_id is distinct from target_round_id
    or target_room.competitive_question_index <> target_question_index then
    return jsonb_build_object('accepted', false, 'staleRound', true);
  end if;
  if target_room.competitive_round_phase <> 'preparing_audio' then
    return jsonb_build_object('accepted', false, 'readinessClosed', true,
      'phase', target_room.competitive_round_phase);
  end if;
  current_question_uuid := nullif(target_room.quiz_questions -> target_question_index ->> 'questionId', '')::uuid;
  select key.preview_url into expected_preview_url from arena_private.question_keys key
  where key.room_id = target_room_id and key.round_number = target_room.round_number
    and key.question_id = current_question_uuid;
  if expected_preview_url is null or target_preview_url is distinct from expected_preview_url then
    raise exception 'Audio failure does not match the authoritative question.';
  end if;
  insert into public.arena_competitive_audio_readiness (
    room_id, room_round_number, round_id, question_index, user_id,
    preview_url, readiness_status, failure_reason, acknowledged_at
  ) values (target_room_id, coalesce(target_room.round_number, 1), target_round_id,
    target_question_index, auth.uid(), target_preview_url, 'failed',
    left(coalesce(failure_reason, 'UNKNOWN: Audio readiness failed.'), 240), clock_timestamp())
  on conflict (room_id, room_round_number, round_id, user_id) do update set
    readiness_status = 'failed', failure_reason = excluded.failure_reason,
    acknowledged_at = excluded.acknowledged_at;
  select * into resulting_room from public.arena_rooms where id = target_room_id;
  -- A single client report is diagnostic input, not authority to skip a shared
  -- question. The existing server timeline performs bounded recovery at its
  -- readiness deadline, independent of any one participant's report.
  return jsonb_build_object('accepted', true, 'pendingUntilDeadline', true,
    'roundId', resulting_room.competitive_round_id,
    'reserveCount', jsonb_array_length(
      coalesce(resulting_room.competitive_reserve_questions, '[]'::jsonb)));
end;
$$;

create or replace function public.start_prepared_party_question(
  target_room_id uuid, target_round_number integer,
  target_question_index integer, target_preview_url text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
  current_question_uuid uuid;
  expected_preview_url text;
  server_starts_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  select * into target_room from public.arena_rooms
  where id = target_room_id and mode = 'party_mode' and status = 'active' for update;
  if target_room.id is null or target_room.host_user_id <> auth.uid() then
    raise exception 'Only the active Party host can start a prepared question.';
  end if;
  if target_room.round_number <> target_round_number
    or target_room.party_question_index <> target_question_index
    or target_room.party_question_phase <> 'preparing_audio'
    or target_room.party_audio_status <> 'pending' then return false; end if;
  current_question_uuid := nullif(target_room.quiz_questions -> target_question_index ->> 'questionId', '')::uuid;
  select key.preview_url into expected_preview_url from arena_private.question_keys key
  where key.room_id = target_room_id and key.round_number = target_round_number
    and key.question_id = current_question_uuid;
  if expected_preview_url is null or target_preview_url is distinct from expected_preview_url then
    return false;
  end if;
  if target_room.party_audio_ready_deadline_at is not null
    and clock_timestamp() >= target_room.party_audio_ready_deadline_at then return false; end if;
  server_starts_at := clock_timestamp() + interval '3 seconds';
  update public.arena_rooms set party_question_phase = 'countdown',
    party_clip_starts_at = server_starts_at, party_answer_starts_at = server_starts_at,
    party_answer_ends_at = server_starts_at + interval '10 seconds',
    party_reveal_ends_at = null, party_audio_question_index = target_question_index,
    party_audio_status = 'pending', party_audio_updated_at = clock_timestamp(),
    party_audio_ready_deadline_at = server_starts_at + interval '4 seconds'
  where id = target_room_id and round_number = target_round_number
    and party_question_index = target_question_index and party_question_phase = 'preparing_audio';
  return found;
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
  current_question_id uuid;
  answer_key arena_private.question_keys%rowtype;
  answer_is_valid boolean;
  answer_is_correct boolean;
  response_ms integer;
  inserted_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  select * into target_room from public.arena_rooms
  where id = target_room_id and mode in ('duel', 'group_lobby') and status = 'active'
  for update;
  if target_room.id is null then raise exception 'This competitive game is not active.'; end if;
  if target_room.competitive_round_id is distinct from target_round_id
    or target_room.competitive_question_index <> target_question_index
  then return jsonb_build_object('accepted', false, 'staleRound', true,
    'roundLocked', target_room.competitive_round_phase = 'reveal'); end if;
  if target_room.competitive_round_phase = 'reveal'
    or target_room.competitive_round_winner_user_id is not null
  then return jsonb_build_object('accepted', false, 'roundLocked', true,
    'winnerUserId', target_room.competitive_round_winner_user_id,
    'responseTimeMs', target_room.competitive_winning_response_ms); end if;
  if target_room.competitive_round_phase = 'countdown'
    and request_received_at >= target_room.competitive_answer_starts_at
  then
    target_room.competitive_round_phase := 'answering';
    update public.arena_rooms set competitive_round_phase = 'answering' where id = target_room_id;
  end if;
  if target_room.competitive_round_phase <> 'answering'
    or request_received_at < target_room.competitive_answer_starts_at
    or request_received_at > target_room.competitive_answer_ends_at
  then return jsonb_build_object('accepted', false, 'roundLocked', true); end if;
  if not exists (select 1 from public.arena_room_players p
    where p.room_id = target_room_id and p.user_id = auth.uid()
      and p.left_at is null and p.finished_at is null
      and coalesce(p.result_status, 'active') not in ('cancelled', 'left', 'forfeit'))
  then raise exception 'You are not an active player in this room.'; end if;

  current_question_id := nullif(target_room.quiz_questions -> target_question_index ->> 'questionId', '')::uuid;
  select * into answer_key from arena_private.question_keys
  where room_id = target_room_id and round_number = target_room.round_number
    and question_id = current_question_id;
  if answer_key.question_id is null then raise exception 'Trusted answer key is unavailable.'; end if;
  answer_is_valid := target_answer is null or exists (
    select 1 from jsonb_array_elements(target_room.quiz_questions -> target_question_index -> 'options') option_row
    where option_row ->> 'id' = target_answer
  );
  if not answer_is_valid then raise exception 'Selected answer is not part of this round.'; end if;
  answer_is_correct := target_answer is not null and target_answer = answer_key.correct_option_id;
  response_ms := least(10000, greatest(0, round(extract(epoch from
    (request_received_at - target_room.competitive_answer_starts_at)) * 1000)::integer));

  insert into public.arena_competitive_answers (
    room_id, room_round_number, round_id, question_index, user_id,
    answer_text, is_correct, response_time_ms, submitted_at
  ) values (
    target_room_id, coalesce(target_room.round_number, 1), target_round_id,
    target_question_index, auth.uid(), target_answer, answer_is_correct,
    response_ms, request_received_at
  ) on conflict (room_id, room_round_number, question_index, user_id) do nothing
  returning id into inserted_id;
  if inserted_id is null then return jsonb_build_object('accepted', false, 'duplicate', true); end if;

  update public.arena_room_players set
    competitive_answered_question_index = target_question_index
  where room_id = target_room_id and user_id = auth.uid();

  if answer_is_correct then
    update public.arena_competitive_answers set is_round_winner = true where id = inserted_id;
    update public.arena_room_players set
      round_points = round_points + case when user_id = auth.uid() then 1 else 0 end,
      rounds_won = rounds_won + case when user_id = auth.uid() then 1 else 0 end,
      rounds_played = rounds_played + 1,
      winning_response_total_ms = winning_response_total_ms + case when user_id = auth.uid() then response_ms else 0 end,
      average_winning_response_ms = case when user_id = auth.uid()
        then round((winning_response_total_ms + response_ms)::numeric / nullif(rounds_won + 1, 0), 1)
        else average_winning_response_ms end,
      fastest_winning_response_ms = case when user_id = auth.uid()
        then least(coalesce(fastest_winning_response_ms, response_ms), response_ms)
        else fastest_winning_response_ms end,
      current_score = current_score + case when user_id = auth.uid() then 1 else 0 end,
      current_correct_answers = current_correct_answers + case when user_id = auth.uid() then 1 else 0 end,
      current_question_index = greatest(current_question_index, target_question_index + 1),
      current_streak = case when user_id = auth.uid() then current_streak + 1 else 0 end
    where room_id = target_room_id and left_at is null and finished_at is null
      and coalesce(result_status, 'active') not in ('cancelled', 'left', 'forfeit');
    update public.arena_rooms set
      competitive_round_phase = 'reveal', competitive_round_winner_user_id = auth.uid(),
      competitive_winning_answer_at = request_received_at,
      competitive_winning_response_ms = response_ms,
      competitive_reveal_ends_at = clock_timestamp() + interval '2.5 seconds'
    where id = target_room_id;
  end if;

  return jsonb_build_object('accepted', true, 'isCorrect', answer_is_correct,
    'roundWon', answer_is_correct,
    'winnerUserId', case when answer_is_correct then auth.uid() else null end,
    'responseTimeMs', response_ms);
end;
$$;

create or replace function public.submit_party_answer(target_room_id uuid, target_answer text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
  current_question_id uuid;
  answer_key arena_private.question_keys%rowtype;
  answer_is_correct boolean;
  remaining_seconds numeric;
  earned_points integer;
  answer_seconds numeric;
  inserted_id uuid;
  competitor_count integer;
  answered_count integer;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  select * into target_room from public.arena_rooms
  where id = target_room_id and mode = 'party_mode' and status = 'active' for update;
  if target_room.id is null then raise exception 'This Party game is not active.'; end if;
  if auth.uid() = target_room.host_user_id then raise exception 'The Party host observes and cannot submit answers.'; end if;
  if not exists (select 1 from public.arena_room_players p
    where p.room_id = target_room_id and p.user_id = auth.uid()
      and p.left_at is null and p.finished_at is null
      and coalesce(p.result_status, 'active') not in ('cancelled', 'left', 'forfeit'))
  then raise exception 'You are not an active Party player.'; end if;
  if target_room.party_question_phase = 'countdown'
    and clock_timestamp() >= target_room.party_answer_starts_at
    and target_room.party_audio_status = 'playing'
  then
    target_room.party_question_phase := 'answering';
    update public.arena_rooms set party_question_phase = 'answering' where id = target_room_id;
  end if;
  if target_room.party_question_phase <> 'answering'
    or clock_timestamp() > target_room.party_answer_ends_at
  then raise exception 'This Party question is not accepting answers.'; end if;
  if target_answer is null or btrim(target_answer) = '' then
    raise exception 'A selected answer is required.';
  end if;

  current_question_id := nullif(target_room.quiz_questions -> target_room.party_question_index ->> 'questionId', '')::uuid;
  select * into answer_key from arena_private.question_keys
  where room_id = target_room_id and round_number = target_room.round_number
    and question_id = current_question_id;
  if answer_key.question_id is null then raise exception 'Trusted answer key is unavailable.'; end if;
  if not exists (
    select 1 from jsonb_array_elements(target_room.quiz_questions -> target_room.party_question_index -> 'options') option_row
    where option_row ->> 'id' = target_answer
  ) then raise exception 'Selected answer is not part of this question.'; end if;
  answer_is_correct := target_answer = answer_key.correct_option_id;
  remaining_seconds := least(10, greatest(0,
    extract(epoch from (target_room.party_answer_ends_at - clock_timestamp()))));
  earned_points := case when answer_is_correct then 500 + floor(500 * remaining_seconds / 10)::integer else 0 end;
  answer_seconds := greatest(0, 10 - remaining_seconds);

  insert into public.arena_party_answers (
    room_id, round_number, question_index, user_id, answer_text,
    is_correct, points, answer_time_seconds
  ) values (
    target_room_id, coalesce(target_room.round_number, 1),
    target_room.party_question_index, auth.uid(), target_answer,
    answer_is_correct, earned_points, answer_seconds
  ) on conflict (room_id, round_number, question_index, user_id) do nothing
  returning id into inserted_id;
  if inserted_id is null then return jsonb_build_object('accepted', false, 'duplicate', true); end if;

  select count(*)::integer into competitor_count from public.arena_room_players p
  where p.room_id = target_room_id and p.user_id <> target_room.host_user_id
    and p.left_at is null and p.finished_at is null
    and coalesce(p.result_status, 'active') not in ('cancelled', 'left', 'forfeit');
  select count(*)::integer into answered_count
  from public.arena_party_answers a join public.arena_room_players p
    on p.room_id = a.room_id and p.user_id = a.user_id
  where a.room_id = target_room_id and a.round_number = target_room.round_number
    and a.question_index = target_room.party_question_index
    and p.user_id <> target_room.host_user_id and p.left_at is null and p.finished_at is null
    and coalesce(p.result_status, 'active') not in ('cancelled', 'left', 'forfeit');
  if competitor_count > 0 and answered_count >= competitor_count then
    update public.arena_rooms set party_question_phase = 'reveal',
      party_reveal_ends_at = clock_timestamp() + interval '1.2 seconds'
    where id = target_room_id and party_question_index = target_room.party_question_index
      and party_question_phase = 'answering';
  end if;
  return jsonb_build_object('accepted', true, 'isCorrect', answer_is_correct,
    'points', earned_points, 'answerTimeSeconds', answer_seconds);
end;
$$;

revoke all on function public.acknowledge_competitive_lobby_audio_ready(uuid, uuid, text) from public, anon;
grant execute on function public.acknowledge_competitive_lobby_audio_ready(uuid, uuid, text) to authenticated;
revoke all on function public.submit_competitive_arena_answer(uuid, uuid, integer, text) from public, anon;
grant execute on function public.submit_competitive_arena_answer(uuid, uuid, integer, text) to authenticated;
revoke all on function public.submit_party_answer(uuid, text) from public, anon;
grant execute on function public.submit_party_answer(uuid, text) to authenticated;

commit;

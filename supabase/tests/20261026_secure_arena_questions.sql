-- Run only against an isolated local/staging database after the PR2 migration.
-- All fixture rows are rolled back at the end.
begin;

do $$
begin
  if has_table_privilege('authenticated', 'arena_private.question_keys', 'SELECT')
    or has_schema_privilege('authenticated', 'arena_private', 'USAGE')
    or has_table_privilege('service_role', 'arena_private.question_keys', 'SELECT')
    or has_schema_privilege('service_role', 'arena_private', 'USAGE') then
    raise exception 'Authenticated users can access the private answer schema.';
  end if;
  if has_table_privilege('authenticated', 'public.arena_competitive_answers', 'SELECT')
    or has_table_privilege('authenticated', 'public.arena_party_answers', 'SELECT') then
    raise exception 'Authenticated users can inspect submitted option IDs or correctness rows.';
  end if;
  if has_function_privilege(
    'authenticated',
    'public.stage_arena_question_set(uuid,uuid,text,integer,uuid,integer,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated users can stage authoritative answer keys.';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.stage_arena_question_set(uuid,uuid,text,integer,uuid,integer,jsonb,jsonb,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'The trusted service role cannot stage question sets.';
  end if;
end;
$$;

insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('00000000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'local-host@example.invalid', '{}', '{}'),
  ('00000000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'local-player@example.invalid', '{}', '{}'),
  ('00000000-0000-4000-8000-000000000103', 'authenticated', 'authenticated', 'local-party-host@example.invalid', '{}', '{}'),
  ('00000000-0000-4000-8000-000000000104', 'authenticated', 'authenticated', 'local-party-player@example.invalid', '{}', '{}'),
  ('00000000-0000-4000-8000-000000000105', 'authenticated', 'authenticated', 'local-party-player-two@example.invalid', '{}', '{}');

insert into public.arena_rooms (id, host_user_id, mode, status, album_id, album_name, max_players)
values (
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000101',
  'duel', 'waiting', '42', 'Local Test Album', 2
);

insert into public.arena_room_players (room_id, user_id, display_name, lobby_ready)
values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000101', 'Host', true),
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000102', 'Player', true);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000101', true);

do $$
begin
  begin
    update public.arena_rooms set competitive_answer_ends_at = clock_timestamp() where id = '00000000-0000-4000-8000-000000000201';
    raise exception 'Unexpected room gameplay write permission.';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.arena_room_players set rounds_won = 99 where room_id = '00000000-0000-4000-8000-000000000201' and user_id = auth.uid();
    raise exception 'Unexpected player score write permission.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.stage_arena_question_set(
      '00000000-0000-4000-8000-000000000201', auth.uid(), 'duel', 1,
      '00000000-0000-4000-8000-000000000202', 5, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
    );
    raise exception 'Unexpected authenticated question staging permission.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from arena_private.question_keys;
    raise exception 'Unexpected answer key read permission.';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
with question_seed as (
  select md5('local-pr2-question-' || series.n)::uuid as question_id, series.n as question_number
  from generate_series(1, 5) series(n)
), option_seed as (
  select q.question_id, q.question_number, option_number.n as option_number,
         md5('local-pr2-question-' || q.question_number || '-option-' || option_number.n)::uuid as option_id
  from question_seed q cross join generate_series(1, 4) option_number(n)
), questions as (
  select question_id, question_number,
    jsonb_agg(jsonb_build_object(
      'id', option_id, 'name', case when option_number = 1 then 'Secret Track ' || question_number else 'Decoy ' || option_number end
    ) order by option_number) as options,
    max(option_id::text) filter (where option_number = 1)::uuid as correct_option_id
  from option_seed group by question_id, question_number
)
select public.stage_arena_question_set(
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000101', 'duel', 1,
  '00000000-0000-4000-8000-000000000202', 5,
  (select jsonb_agg(jsonb_build_object(
    'questionId', question_id, 'options', options, 'clipStartSeconds', 8
  ) order by question_number) from questions),
  '[]'::jsonb,
  (select jsonb_agg(jsonb_build_object(
    'questionId', q.question_id,
    'correctOptionId', q.correct_option_id,
    'correctAnswer', 'Secret Track ' || q.question_number,
    'correctTrackId', 'itunes-private-' || q.question_number,
    'previewUrl', 'https://audio-ssl.itunes.apple.com/private-' || q.question_number || '.m4a',
    'clipStartSeconds', 8
  ) order by q.question_number) from questions q)
);
do $$
declare reused_set_id uuid;
begin
  reused_set_id := public.stage_arena_question_set(
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000101', 'duel', 1,
    '00000000-0000-4000-8000-000000000205', 5,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb
  );
  if reused_set_id <> '00000000-0000-4000-8000-000000000202' then
    raise exception 'Repeated question staging replaced the original set: %', reused_set_id;
  end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000101', true);
select public.activate_arena_question_set(
  '00000000-0000-4000-8000-000000000201',
  '00000000-0000-4000-8000-000000000202'
);
do $$
declare
  audio_payload jsonb;
begin
  if (select competitive_revealed_answer is not null or competitive_revealed_option_id is not null
      from public.arena_rooms where id = '00000000-0000-4000-8000-000000000201') then
    raise exception 'The answer became visible before the reveal phase.';
  end if;
  if exists (
    select 1 from jsonb_array_elements((select quiz_questions from public.arena_rooms
      where id = '00000000-0000-4000-8000-000000000201')) question
    where question ? 'correctAnswer' or question ? 'correctTrack' or question ? 'previewUrl'
      or exists (select 1 from jsonb_array_elements(question -> 'options') option_row
        where option_row ? 'previewUrl' or option_row ? 'artistName' or option_row ->> 'id' like 'itunes-%')
  ) then raise exception 'The active room snapshot contains answer-linked or audio metadata.'; end if;
  if not has_function_privilege('authenticated', 'public.get_arena_question_audio(uuid,integer,uuid)', 'EXECUTE') then
    raise exception 'Authenticated room participants cannot load audio.';
  end if;
  audio_payload := public.get_arena_question_audio(
    '00000000-0000-4000-8000-000000000201', 0,
    md5('local-pr2-question-1')::uuid
  );
  if audio_payload ->> 'previewUrl' is null
    or audio_payload ? 'correctAnswer'
    or audio_payload ? 'correctOptionId'
  then raise exception 'The audio endpoint returned missing audio or an answer key.'; end if;
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000102', true);
do $$
declare denied boolean := false;
begin
  begin
    perform public.activate_arena_question_set(
      '00000000-0000-4000-8000-000000000201',
      '00000000-0000-4000-8000-000000000202'
    );
  exception when others then denied := true;
  end;
  if not denied then raise exception 'A non-host activated the question set.'; end if;
end;
$$;
reset role;

update public.arena_rooms set status = 'active'
where id = '00000000-0000-4000-8000-000000000201';
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000101', true);
do $$
declare failure_result jsonb;
begin
  failure_result := public.report_competitive_audio_failure(
    '00000000-0000-4000-8000-000000000201',
    (select competitive_round_id from public.arena_rooms where id = '00000000-0000-4000-8000-000000000201'),
    0, 'https://audio-ssl.itunes.apple.com/private-1.m4a', 'CLIENT_REPORTED_FAILURE'
  );
  if failure_result ->> 'accepted' <> 'true'
    or failure_result ->> 'pendingUntilDeadline' <> 'true'
    or (select competitive_round_phase <> 'preparing_audio'
        or competitive_question_index <> 0
        from public.arena_rooms where id = '00000000-0000-4000-8000-000000000201') then
    raise exception 'A client audio failure report advanced the shared round: %', failure_result;
  end if;
end;
$$;
do $$
declare ack jsonb;
begin
  ack := public.acknowledge_competitive_audio_ready_v2(
    '00000000-0000-4000-8000-000000000201', 1,
    (select competitive_round_id from public.arena_rooms where id = '00000000-0000-4000-8000-000000000201'),
    0, 'https://audio-ssl.itunes.apple.com/private-1.m4a', 'local-test-host', 1
  );
  if ack ->> 'accepted' <> 'true' or ack ->> 'readyCount' <> '1' then
    raise exception 'First trusted competitive audio ACK failed: %', ack;
  end if;
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000102', true);
do $$
declare ack jsonb;
begin
  ack := public.acknowledge_competitive_audio_ready_v2(
    '00000000-0000-4000-8000-000000000201', 1,
    (select competitive_round_id from public.arena_rooms where id = '00000000-0000-4000-8000-000000000201'),
    0, 'https://audio-ssl.itunes.apple.com/private-1.m4a', 'local-test-player', 1
  );
  if ack ->> 'accepted' <> 'true' or ack ->> 'serverPhase' <> 'countdown' then
    raise exception 'All-player trusted readiness did not open the countdown: %', ack;
  end if;
end;
$$;
reset role;

update public.arena_rooms set
  status = 'active', competitive_round_phase = 'answering',
  competitive_answer_starts_at = clock_timestamp() - interval '1 second',
  competitive_answer_ends_at = clock_timestamp() + interval '10 seconds'
where id = '00000000-0000-4000-8000-000000000201';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000101', true);
do $$
declare
  answer_result jsonb;
begin
  answer_result := public.submit_competitive_arena_answer(
    '00000000-0000-4000-8000-000000000201',
    (select competitive_round_id from public.arena_rooms where id = '00000000-0000-4000-8000-000000000201'),
    0, md5('local-pr2-question-1-option-2')::uuid::text
  );
  if answer_result ->> 'accepted' <> 'true'
    or answer_result ->> 'isCorrect' <> 'false'
    or answer_result ? 'correctAnswer'
    or answer_result ? 'correctOptionId'
  then raise exception 'Wrong answer handling returned an invalid or revealing response: %', answer_result; end if;
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000102', true);
do $$
declare
  answer_result jsonb;
begin
  answer_result := public.submit_competitive_arena_answer(
    '00000000-0000-4000-8000-000000000201',
    (select competitive_round_id from public.arena_rooms where id = '00000000-0000-4000-8000-000000000201'),
    0, md5('local-pr2-question-1-option-1')::uuid::text
  );
  if answer_result ->> 'accepted' <> 'true'
    or answer_result ->> 'isCorrect' <> 'true'
    or answer_result ->> 'roundWon' <> 'true'
    or answer_result ? 'correctAnswer'
    or answer_result ? 'correctOptionId'
  then raise exception 'Correct answer handling returned an invalid or revealing response: %', answer_result; end if;
  if (select competitive_revealed_answer from public.arena_rooms
      where id = '00000000-0000-4000-8000-000000000201') <> 'Secret Track 1'
    or (select competitive_revealed_option_id from public.arena_rooms
      where id = '00000000-0000-4000-8000-000000000201')
        <> md5('local-pr2-question-1-option-1')::uuid::text
  then raise exception 'The answer was not published when the room entered reveal.'; end if;
end;
$$;
reset role;

update public.arena_rooms set competitive_reveal_ends_at = clock_timestamp() - interval '1 second'
where id = '00000000-0000-4000-8000-000000000201';
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000101', true);
select public.sync_competitive_arena_timeline('00000000-0000-4000-8000-000000000201');
do $$
begin
  if (select competitive_question_index <> 1 or competitive_round_phase <> 'preparing_audio'
      from public.arena_rooms where id = '00000000-0000-4000-8000-000000000201') then
    raise exception 'Competitive timeline did not advance to the next trusted question.';
  end if;
end;
$$;
reset role;
update public.arena_rooms set
  competitive_round_phase = 'answering',
  competitive_answer_starts_at = clock_timestamp() - interval '11 seconds',
  competitive_answer_ends_at = clock_timestamp() - interval '1 second'
where id = '00000000-0000-4000-8000-000000000201';
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000101', true);
select public.sync_competitive_arena_timeline('00000000-0000-4000-8000-000000000201');
do $$
begin
  if (select competitive_round_phase <> 'reveal'
      or competitive_revealed_answer <> 'Secret Track 2'
      from public.arena_rooms where id = '00000000-0000-4000-8000-000000000201') then
    raise exception 'Competitive timeout did not reveal its private answer through the timeline.';
  end if;
end;
$$;
reset role;

insert into public.arena_rooms (id, host_user_id, mode, status, album_id, album_name, max_players)
values (
  '00000000-0000-4000-8000-000000000203',
  '00000000-0000-4000-8000-000000000103',
  'party_mode', 'waiting', '42', 'Local Party Album', 10
);
insert into public.arena_room_players (room_id, user_id, display_name, lobby_ready)
values
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000103', 'Host', true),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000104', 'Player', true),
  ('00000000-0000-4000-8000-000000000203', '00000000-0000-4000-8000-000000000105', 'Player Two', true);

set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
with question_seed as (
  select md5('local-pr2-party-' || series.n)::uuid as question_id, series.n as question_number
  from generate_series(1, 5) series(n)
), option_seed as (
  select q.question_id, q.question_number, option_number.n as option_number,
         md5('local-pr2-party-' || q.question_number || '-option-' || option_number.n)::uuid as option_id
  from question_seed q cross join generate_series(1, 4) option_number(n)
), questions as (
  select question_id, question_number,
    jsonb_agg(jsonb_build_object(
      'id', option_id, 'name', case when option_number = 1 then 'Party Secret ' || question_number else 'Party Decoy ' || option_number end
    ) order by option_number) as options,
    max(option_id::text) filter (where option_number = 1)::uuid as correct_option_id
  from option_seed group by question_id, question_number
)
select public.stage_arena_question_set(
  '00000000-0000-4000-8000-000000000203',
  '00000000-0000-4000-8000-000000000103', 'party_mode', 1,
  '00000000-0000-4000-8000-000000000204', 5,
  (select jsonb_agg(jsonb_build_object(
    'questionId', question_id, 'options', options, 'clipStartSeconds', 8
  ) order by question_number) from questions),
  '[]'::jsonb,
  (select jsonb_agg(jsonb_build_object(
    'questionId', q.question_id,
    'correctOptionId', q.correct_option_id,
    'correctAnswer', 'Party Secret ' || q.question_number,
    'correctTrackId', 'itunes-party-' || q.question_number,
    'previewUrl', 'https://audio-ssl.itunes.apple.com/party-' || q.question_number || '.m4a',
    'clipStartSeconds', 8
  ) order by q.question_number) from questions q)
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000103', true);
select public.activate_arena_question_set(
  '00000000-0000-4000-8000-000000000203',
  '00000000-0000-4000-8000-000000000204'
);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000103', true);
do $$
declare audio_payload jsonb;
begin
  audio_payload := public.get_arena_question_audio(
    '00000000-0000-4000-8000-000000000203', 0,
    md5('local-pr2-party-1')::uuid
  );
  if audio_payload ->> 'previewUrl' is null
    or audio_payload ? 'correctAnswer'
    or audio_payload ? 'correctOptionId' then
    raise exception 'The Party host could not receive only the audio source.';
  end if;
end;
$$;
do $$
begin
  if not public.start_prepared_party_question(
    '00000000-0000-4000-8000-000000000203', 1, 0,
    'https://audio-ssl.itunes.apple.com/party-1.m4a'
  ) then
    raise exception 'Party host could not start a trusted prepared question.';
  end if;
end;
$$;
reset role;
update public.arena_rooms set
  party_question_phase = 'answering', party_audio_status = 'playing',
  party_answer_starts_at = clock_timestamp() - interval '1 second',
  party_answer_ends_at = clock_timestamp() + interval '10 seconds'
where id = '00000000-0000-4000-8000-000000000203';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000104', true);
do $$
declare
  denied boolean := false;
begin
  begin
    perform public.get_arena_question_audio(
      '00000000-0000-4000-8000-000000000203', 0,
      md5('local-pr2-party-1')::uuid
    );
  exception when others then denied := true;
  end;
  if not denied then raise exception 'A Party participant retrieved host-only music audio.'; end if;
end;
$$;
do $$
declare
  null_rejected boolean := false;
begin
  begin
    perform public.submit_party_answer(
      '00000000-0000-4000-8000-000000000203', null
    );
  exception when others then null_rejected := true;
  end;
  if not null_rejected then raise exception 'A null Party answer was accepted.'; end if;
  if (select party_question_phase <> 'answering' from public.arena_rooms
      where id = '00000000-0000-4000-8000-000000000203') then
    raise exception 'A null answer changed Party question state.';
  end if;
end;
$$;
reset role;
set local role service_role;
do $$
begin
  if exists (select 1 from public.arena_party_answers
      where room_id = '00000000-0000-4000-8000-000000000203'
        and question_index = 0
        and user_id = '00000000-0000-4000-8000-000000000104') then
    raise exception 'A null answer was stored as an answer row.';
  end if;
end;
$$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000104', true);
do $$
declare answer_result jsonb;
begin
  answer_result := public.submit_party_answer(
    '00000000-0000-4000-8000-000000000203',
    md5('local-pr2-party-1-option-1')::uuid::text
  );
  if answer_result ->> 'accepted' <> 'true'
    or answer_result ->> 'isCorrect' <> 'true'
    or answer_result ? 'correctAnswer'
    or answer_result ? 'correctOptionId'
  then raise exception 'Party answer evaluation failed or disclosed its key: %', answer_result; end if;
  if (select party_question_phase <> 'answering' from public.arena_rooms
      where id = '00000000-0000-4000-8000-000000000203') then
    raise exception 'Party revealed before every active participant answered.';
  end if;
  if (select current_score <> 0 or current_correct_answers <> 0
      from public.arena_room_players where room_id = '00000000-0000-4000-8000-000000000203'
        and user_id = auth.uid()) then
    raise exception 'Party score became visible before all players answered.';
  end if;
end;
$$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000105', true);
do $$
declare answer_result jsonb;
begin
  answer_result := public.submit_party_answer(
    '00000000-0000-4000-8000-000000000203',
    md5('local-pr2-party-1-option-2')::uuid::text
  );
  if answer_result ->> 'accepted' <> 'true'
    or answer_result ->> 'isCorrect' <> 'false' then
    raise exception 'Second Party answer did not resolve the round: %', answer_result;
  end if;
  if (select party_question_phase <> 'reveal' from public.arena_rooms
      where id = '00000000-0000-4000-8000-000000000203') then
    raise exception 'Party did not enter reveal after all active players answered.';
  end if;
  if (select current_score <= 0 or current_correct_answers <> 1 or current_streak <> 1
      from public.arena_room_players where room_id = '00000000-0000-4000-8000-000000000203'
        and user_id = '00000000-0000-4000-8000-000000000104') then
    raise exception 'Correct Party score was not published at reveal.';
  end if;
  if (select current_score <> 0 or current_correct_answers <> 0 or current_streak <> 0
      from public.arena_room_players where room_id = '00000000-0000-4000-8000-000000000203'
        and user_id = auth.uid()) then
    raise exception 'Wrong Party answer produced public score or streak.';
  end if;
end;
$$;
reset role;

update public.arena_rooms set party_reveal_ends_at = clock_timestamp() - interval '1 second'
where id = '00000000-0000-4000-8000-000000000203';
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000103', true);
select public.sync_party_room_timeline('00000000-0000-4000-8000-000000000203');
reset role;
update public.arena_rooms set
  party_question_phase = 'answering',
  party_answer_starts_at = clock_timestamp() - interval '11 seconds',
  party_answer_ends_at = clock_timestamp() - interval '1 second'
where id = '00000000-0000-4000-8000-000000000203';
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000103', true);
select public.sync_party_room_timeline('00000000-0000-4000-8000-000000000203');
do $$
begin
  if (select party_question_phase <> 'reveal'
      or party_revealed_answer <> 'Party Secret 2'
      from public.arena_rooms where id = '00000000-0000-4000-8000-000000000203') then
    raise exception 'Party timeout did not reveal its private answer through the timeline.';
  end if;
end;
$$;
reset role;

rollback;

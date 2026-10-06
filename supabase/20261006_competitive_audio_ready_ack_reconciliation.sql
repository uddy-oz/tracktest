begin;

alter table public.arena_competitive_audio_readiness
  add column if not exists client_id text,
  add column if not exists ack_attempt integer,
  add column if not exists acknowledgement_count integer not null default 0;

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
  expected_preview_url text;
  required_count integer := 0;
  ready_count_before integer := 0;
  ready_count_after integer := 0;
  acknowledgement_existed boolean := false;
  already_ready boolean := false;
  server_starts_at timestamptz;
  server_phase text;
  authoritative_round_key text;
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
    return jsonb_build_object(
      'accepted', false,
      'alreadyReady', false,
      'reason', 'inactive_room'
    );
  end if;

  authoritative_round_key := concat_ws(
    ':',
    target_room.id::text,
    coalesce(target_room.round_number, 1)::text,
    coalesce(target_room.competitive_round_id::text, 'missing'),
    target_room.competitive_question_index::text
  );

  select * into membership
  from public.arena_room_players player
  where player.room_id = target_room_id
    and player.user_id = auth.uid()
    and player.left_at is null
    and player.finished_at is null
    and coalesce(player.result_status, 'active') not in (
      'cancelled', 'left', 'forfeit'
    )
  order by player.joined_at desc
  limit 1;

  if membership.id is null then
    return jsonb_build_object(
      'accepted', false,
      'alreadyReady', false,
      'reason', 'inactive_player',
      'matchGeneration', coalesce(target_room.round_number, 1),
      'roundNumber', coalesce(target_room.round_number, 1),
      'roundKey', authoritative_round_key,
      'serverPhase', target_room.competitive_round_phase
    );
  end if;

  select count(*)::integer into required_count
  from public.arena_room_players player
  where player.room_id = target_room_id
    and player.left_at is null
    and player.finished_at is null
    and coalesce(player.result_status, 'active') not in (
      'cancelled', 'left', 'forfeit'
    );

  select count(*)::integer into ready_count_before
  from public.arena_competitive_audio_readiness readiness
  join public.arena_room_players player
    on player.room_id = readiness.room_id
    and player.user_id = readiness.user_id
  where readiness.room_id = target_room_id
    and readiness.room_round_number = coalesce(target_room.round_number, 1)
    and readiness.round_id = target_room.competitive_round_id
    and readiness.question_index = target_room.competitive_question_index
    and readiness.readiness_status = 'ready'
    and player.left_at is null
    and player.finished_at is null
    and coalesce(player.result_status, 'active') not in (
      'cancelled', 'left', 'forfeit'
    );

  if coalesce(target_room.round_number, 1) <> target_match_generation then
    return jsonb_build_object(
      'accepted', false,
      'alreadyReady', false,
      'reason', 'match_generation_mismatch',
      'readyCount', ready_count_before,
      'requiredCount', required_count,
      'matchGeneration', coalesce(target_room.round_number, 1),
      'roundNumber', coalesce(target_room.round_number, 1),
      'roundKey', authoritative_round_key,
      'serverPhase', target_room.competitive_round_phase,
      'membershipId', membership.id
    );
  end if;

  if target_room.competitive_round_id is distinct from target_round_id
    or target_room.competitive_question_index <> target_question_index
  then
    return jsonb_build_object(
      'accepted', false,
      'alreadyReady', false,
      'reason', 'round_key_mismatch',
      'readyCount', ready_count_before,
      'requiredCount', required_count,
      'matchGeneration', coalesce(target_room.round_number, 1),
      'roundNumber', coalesce(target_room.round_number, 1),
      'roundKey', authoritative_round_key,
      'serverPhase', target_room.competitive_round_phase,
      'membershipId', membership.id
    );
  end if;

  expected_preview_url := target_room.quiz_questions
    -> target_question_index
    -> 'correctTrack'
    ->> 'previewUrl';

  if expected_preview_url is null
    or expected_preview_url = ''
    or target_preview_url is distinct from expected_preview_url
  then
    return jsonb_build_object(
      'accepted', false,
      'alreadyReady', false,
      'reason', 'preview_url_mismatch',
      'readyCount', ready_count_before,
      'requiredCount', required_count,
      'matchGeneration', coalesce(target_room.round_number, 1),
      'roundNumber', coalesce(target_room.round_number, 1),
      'roundKey', authoritative_round_key,
      'serverPhase', target_room.competitive_round_phase,
      'membershipId', membership.id
    );
  end if;

  select
    exists (
      select 1
      from public.arena_competitive_audio_readiness readiness
      where readiness.room_id = target_room_id
        and readiness.room_round_number = target_match_generation
        and readiness.round_id = target_round_id
        and readiness.user_id = auth.uid()
    ),
    exists (
      select 1
      from public.arena_competitive_audio_readiness readiness
      where readiness.room_id = target_room_id
        and readiness.room_round_number = target_match_generation
        and readiness.round_id = target_round_id
        and readiness.question_index = target_question_index
        and readiness.user_id = auth.uid()
        and readiness.preview_url = target_preview_url
        and readiness.readiness_status = 'ready'
    )
  into acknowledgement_existed, already_ready;

  if not already_ready
    and target_room.competitive_round_phase <> 'preparing_audio'
  then
    return jsonb_build_object(
      'accepted', false,
      'alreadyReady', false,
      'acknowledgementExisted', acknowledgement_existed,
      'reason', 'readiness_closed',
      'readyCount', ready_count_before,
      'requiredCount', required_count,
      'matchGeneration', coalesce(target_room.round_number, 1),
      'roundNumber', coalesce(target_room.round_number, 1),
      'roundKey', authoritative_round_key,
      'serverPhase', target_room.competitive_round_phase,
      'membershipId', membership.id
    );
  end if;

  if not already_ready then
    insert into public.arena_competitive_audio_readiness as readiness_row (
      room_id,
      room_round_number,
      round_id,
      question_index,
      user_id,
      preview_url,
      readiness_status,
      failure_reason,
      acknowledged_at,
      client_id,
      ack_attempt,
      acknowledgement_count
    ) values (
      target_room_id,
      target_match_generation,
      target_round_id,
      target_question_index,
      auth.uid(),
      target_preview_url,
      'ready',
      null,
      clock_timestamp(),
      left(nullif(target_client_id, ''), 120),
      greatest(coalesce(target_ack_attempt, 1), 1),
      1
    )
    on conflict (room_id, room_round_number, round_id, user_id)
    do update set
      question_index = excluded.question_index,
      preview_url = excluded.preview_url,
      readiness_status = 'ready',
      failure_reason = null,
      acknowledged_at = excluded.acknowledged_at,
      client_id = excluded.client_id,
      ack_attempt = excluded.ack_attempt,
      acknowledgement_count =
        readiness_row.acknowledgement_count + 1;
  else
    update public.arena_competitive_audio_readiness
    set
      acknowledged_at = clock_timestamp(),
      client_id = coalesce(left(nullif(target_client_id, ''), 120), client_id),
      ack_attempt = greatest(coalesce(target_ack_attempt, 1), 1),
      acknowledgement_count = acknowledgement_count + 1
    where room_id = target_room_id
      and room_round_number = target_match_generation
      and round_id = target_round_id
      and user_id = auth.uid();
  end if;

  select count(*)::integer into ready_count_after
  from public.arena_competitive_audio_readiness readiness
  join public.arena_room_players player
    on player.room_id = readiness.room_id
    and player.user_id = readiness.user_id
  where readiness.room_id = target_room_id
    and readiness.room_round_number = target_match_generation
    and readiness.round_id = target_round_id
    and readiness.question_index = target_question_index
    and readiness.readiness_status = 'ready'
    and player.left_at is null
    and player.finished_at is null
    and coalesce(player.result_status, 'active') not in (
      'cancelled', 'left', 'forfeit'
    );

  server_phase := target_room.competitive_round_phase;
  if target_room.competitive_round_phase = 'preparing_audio'
    and required_count > 0
    and ready_count_after >= required_count
  then
    server_starts_at := clock_timestamp() + interval '3 seconds';
    server_phase := 'countdown';
    update public.arena_rooms
    set
      competitive_round_phase = 'countdown',
      competitive_answer_starts_at = server_starts_at,
      competitive_answer_ends_at = server_starts_at + interval '10 seconds',
      competitive_audio_ready_deadline_at = null,
      competitive_required_ready_count = required_count,
      competitive_ready_count = ready_count_after
    where id = target_room_id;
  elsif target_room.competitive_round_phase = 'preparing_audio' then
    update public.arena_rooms
    set
      competitive_required_ready_count = required_count,
      competitive_ready_count = ready_count_after
    where id = target_room_id;
  end if;

  return jsonb_build_object(
    'accepted', true,
    'alreadyReady', already_ready,
    'acknowledgementExisted', acknowledgement_existed,
    'reason', null,
    'readyCountBefore', ready_count_before,
    'readyCount', ready_count_after,
    'requiredCount', required_count,
    'matchGeneration', target_match_generation,
    'roundNumber', target_match_generation,
    'roundKey', authoritative_round_key,
    'serverPhase', server_phase,
    'membershipId', membership.id,
    'userId', auth.uid(),
    'clientId', left(nullif(target_client_id, ''), 120),
    'ackAttempt', greatest(coalesce(target_ack_attempt, 1), 1),
    'answerStartsAt', server_starts_at
  );
end;
$$;

-- Preserve the existing signature for cached clients while routing current
-- acknowledgements through the idempotent implementation.
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
  target_generation integer;
begin
  select coalesce(round_number, 1) into target_generation
  from public.arena_rooms
  where id = target_room_id;

  if target_generation is null then
    return jsonb_build_object(
      'accepted', false,
      'alreadyReady', false,
      'reason', 'inactive_room'
    );
  end if;

  return public.acknowledge_competitive_audio_ready_v2(
    target_room_id,
    target_generation,
    target_round_id,
    target_question_index,
    target_preview_url,
    null,
    1
  );
end;
$$;

create or replace function public.get_competitive_audio_readiness_state(
  target_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
  authoritative_round_key text;
  player_states jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from public.arena_room_players player
    where player.room_id = target_room_id
      and player.user_id = auth.uid()
      and player.left_at is null
      and coalesce(player.result_status, 'active') not in (
        'cancelled', 'left', 'forfeit'
      )
  ) then
    raise exception 'Only current room players can inspect readiness.';
  end if;

  select * into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby');

  if target_room.id is null then
    return jsonb_build_object('available', false, 'reason', 'inactive_room');
  end if;

  authoritative_round_key := concat_ws(
    ':',
    target_room.id::text,
    coalesce(target_room.round_number, 1)::text,
    coalesce(target_room.competitive_round_id::text, 'missing'),
    target_room.competitive_question_index::text
  );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'membershipId', player.id,
        'userId', player.user_id,
        'displayName', coalesce(player.display_name, player.username, 'Arena Player'),
        'username', player.username,
        'serverAckReady', readiness.readiness_status = 'ready',
        'readinessStatus', readiness.readiness_status,
        'acknowledgedAt', readiness.acknowledged_at,
        'clientId', readiness.client_id,
        'ackAttempt', readiness.ack_attempt,
        'acknowledgementCount', readiness.acknowledgement_count
      )
      order by player.joined_at
    ),
    '[]'::jsonb
  ) into player_states
  from public.arena_room_players player
  left join public.arena_competitive_audio_readiness readiness
    on readiness.room_id = player.room_id
    and readiness.room_round_number = coalesce(target_room.round_number, 1)
    and readiness.round_id = target_room.competitive_round_id
    and readiness.question_index = target_room.competitive_question_index
    and readiness.user_id = player.user_id
  where player.room_id = target_room_id
    and player.left_at is null
    and player.finished_at is null
    and coalesce(player.result_status, 'active') not in (
      'cancelled', 'left', 'forfeit'
    );

  return jsonb_build_object(
    'available', true,
    'roomId', target_room.id,
    'matchGeneration', coalesce(target_room.round_number, 1),
    'roundNumber', coalesce(target_room.round_number, 1),
    'roundId', target_room.competitive_round_id,
    'roundKey', authoritative_round_key,
    'questionIndex', target_room.competitive_question_index,
    'serverPhase', target_room.competitive_round_phase,
    'readyCount', target_room.competitive_ready_count,
    'requiredCount', target_room.competitive_required_ready_count,
    'players', player_states
  );
end;
$$;

revoke all on function public.acknowledge_competitive_audio_ready_v2(
  uuid, integer, uuid, integer, text, text, integer
) from public, anon;
revoke all on function public.acknowledge_competitive_audio_ready(
  uuid, uuid, integer, text
) from public, anon;
revoke all on function public.get_competitive_audio_readiness_state(uuid)
  from public, anon;

grant execute on function public.acknowledge_competitive_audio_ready_v2(
  uuid, integer, uuid, integer, text, text, integer
) to authenticated;
grant execute on function public.acknowledge_competitive_audio_ready(
  uuid, uuid, integer, text
) to authenticated;
grant execute on function public.get_competitive_audio_readiness_state(uuid)
  to authenticated;

commit;

begin;

-- Keep a 12-second reconnect grace and resolve absent active players after
-- 45 seconds. Party Mode is cancelled if its sole audio host does not return.
create or replace function public.reconcile_arena_room_presence_internal(
  target_room_id uuid,
  server_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
  host_last_seen timestamptz;
  stale_player_count integer := 0;
  reconnecting_count integer := 0;
  remaining_count integer := 0;
  minimum_players integer := 0;
  replacement_host_id uuid;
begin
  select * into target_room
  from public.arena_rooms
  where id = target_room_id
    and status in ('waiting', 'starting', 'active')
  for update;

  if target_room.id is null then
    return jsonb_build_object('changed', false, 'hostClosed', false);
  end if;

  select presence_updated_at into host_last_seen
  from public.arena_room_players
  where room_id = target_room_id
    and user_id = target_room.host_user_id
    and left_at is null
  order by joined_at desc
  limit 1;

  if host_last_seen is null
    or host_last_seen <= server_now - interval '45 seconds'
  then
    if target_room.status in ('waiting', 'starting')
      or (target_room.status = 'active' and target_room.mode = 'party_mode')
    then
      update public.arena_rooms
      set status = 'cancelled',
          finished_at = coalesce(finished_at, server_now),
          rematch_requested_by = null,
          rematch_requested_at = null,
          host_is_choosing_album = false,
          close_reason = 'host_disconnected'
      where id = target_room_id;

      update public.arena_room_players
      set lobby_ready = false,
          is_ready = false,
          presence_status = 'left',
          left_at = coalesce(left_at, server_now),
          result_status = case
            when result_status in ('completed', 'forfeit', 'win_by_forfeit')
              then result_status
            when target_room.status = 'active' and user_id = target_room.host_user_id
              then 'left'
            else 'cancelled'
          end
      where room_id = target_room_id and left_at is null;

      return jsonb_build_object(
        'changed', true,
        'hostClosed', true,
        'reason', case when target_room.mode = 'party_mode'
          then 'party_host_disconnected' else 'host_disconnect_timeout' end
      );
    end if;
  end if;

  update public.arena_room_players
  set presence_status = 'reconnecting'
  where room_id = target_room_id
    and left_at is null
    and presence_status = 'connected'
    and presence_updated_at <= server_now - interval '12 seconds';
  get diagnostics reconnecting_count = row_count;

  if target_room.status in ('waiting', 'starting') then
    update public.arena_room_players
    set lobby_ready = false,
        is_ready = false,
        presence_status = 'left',
        left_at = coalesce(left_at, server_now),
        result_status = 'left'
    where room_id = target_room_id
      and user_id <> target_room.host_user_id
      and left_at is null
      and presence_updated_at <= server_now - interval '45 seconds';
    get diagnostics stale_player_count = row_count;

    select count(*)::integer into remaining_count
    from public.arena_room_players
    where room_id = target_room_id
      and left_at is null
      and finished_at is null
      and coalesce(result_status, 'active') not in ('cancelled', 'left', 'forfeit');

    minimum_players := case
      when target_room.mode = 'duel' then 2
      when target_room.mode = 'group_lobby' then 3
      else 2
    end;

    if target_room.status = 'starting' and remaining_count < minimum_players then
      update public.arena_rooms
      set status = 'waiting',
          started_at = null,
          quiz_questions = '[]'::jsonb,
          competitive_question_index = 0,
          competitive_round_id = null,
          competitive_round_phase = 'idle',
          competitive_answer_starts_at = null,
          competitive_answer_ends_at = null,
          competitive_reveal_ends_at = null,
          competitive_round_winner_user_id = null,
          competitive_winning_answer_at = null,
          competitive_winning_response_ms = null
      where id = target_room_id;

      delete from public.arena_competitive_audio_readiness
      where room_id = target_room_id
        and room_round_number = coalesce(target_room.round_number, 1);

      update public.arena_room_players
      set is_ready = false
      where room_id = target_room_id and left_at is null;
    end if;

    return jsonb_build_object(
      'changed', stale_player_count > 0 or reconnecting_count > 0,
      'hostClosed', false,
      'reconnectingCount', reconnecting_count,
      'departedCount', stale_player_count,
      'remainingCount', remaining_count
    );
  end if;

  -- Mark each player who missed the full reconnect window as a forfeit while
  -- preserving their authoritative score at the last accepted answer.
  update public.arena_room_players
  set final_score = greatest(final_score, current_score),
      correct_answers = greatest(correct_answers, current_correct_answers),
      total_questions = greatest(total_questions, coalesce(jsonb_array_length(target_room.quiz_questions), 0)),
      finished_at = coalesce(finished_at, server_now),
      forfeited_at = coalesce(forfeited_at, server_now),
      left_at = coalesce(left_at, server_now),
      lobby_ready = false,
      is_ready = false,
      presence_status = 'left',
      result_status = 'forfeit'
  where room_id = target_room_id
    and left_at is null
    and finished_at is null
    and presence_updated_at <= server_now - interval '45 seconds';
  get diagnostics stale_player_count = row_count;

  select count(*)::integer into remaining_count
  from public.arena_room_players
  where room_id = target_room_id
    and left_at is null
    and finished_at is null
    and coalesce(result_status, 'active') not in ('cancelled', 'left', 'forfeit');

  if stale_player_count = 0 and reconnecting_count = 0 then
    return jsonb_build_object(
      'changed', false, 'hostClosed', false, 'remainingCount', remaining_count
    );
  end if;

  if target_room.mode = 'duel' and stale_player_count > 0 then
    update public.arena_room_players as room_player
    set final_score = greatest(final_score, current_score),
        correct_answers = greatest(correct_answers, current_correct_answers),
        total_questions = greatest(total_questions, coalesce(jsonb_array_length(target_room.quiz_questions), 0)),
        finished_at = coalesce(finished_at, server_now),
        result_status = case when result_status = 'completed'
          then result_status else 'win_by_forfeit' end
    where room_id = target_room_id
      and not exists (
        select 1 from public.arena_room_players forfeited
        where forfeited.room_id = target_room_id
          and forfeited.user_id = room_player.user_id
          and forfeited.result_status = 'forfeit'
      )
      and left_at is null;

    update public.arena_rooms
    set status = 'finished', finished_at = coalesce(finished_at, server_now),
        rematch_requested_by = null, rematch_requested_at = null
    where id = target_room_id;
  elsif target_room.mode = 'group_lobby' then
    if host_last_seen is null
      or host_last_seen <= server_now - interval '45 seconds'
    then
      select player.user_id into replacement_host_id
      from public.arena_room_players player
      where player.room_id = target_room_id
        and player.left_at is null
        and player.finished_at is null
        and coalesce(player.result_status, 'active') not in ('cancelled', 'left', 'forfeit')
        and player.presence_updated_at > server_now - interval '12 seconds'
      order by player.joined_at asc
      limit 1;

      if replacement_host_id is not null then
        update public.arena_rooms set host_user_id = replacement_host_id
        where id = target_room_id;
      end if;
    end if;

    select count(*)::integer into remaining_count
    from public.arena_room_players
    where room_id = target_room_id
      and left_at is null
      and finished_at is null
      and coalesce(result_status, 'active') not in ('cancelled', 'left', 'forfeit');

    if remaining_count = 0 then
      update public.arena_rooms
      set status = 'finished', finished_at = coalesce(finished_at, server_now),
          rematch_requested_by = null, rematch_requested_at = null
      where id = target_room_id;
    end if;
  end if;

  return jsonb_build_object(
    'changed', true,
    'hostClosed', false,
    'reconnectingCount', reconnecting_count,
    'departedCount', stale_player_count,
    'remainingCount', remaining_count
  );
end;
$$;

create or replace function public.cleanup_stale_arena_presence()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target record;
  cleanup_count integer := 0;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  for target in
    select id from public.arena_rooms
    where status in ('waiting', 'starting', 'active')
  loop
    result := public.reconcile_arena_room_presence_internal(
      target.id, clock_timestamp()
    );
    if coalesce((result ->> 'changed')::boolean, false)
      or coalesce((result ->> 'hostClosed')::boolean, false)
    then
      cleanup_count := cleanup_count + 1;
    end if;
  end loop;

  return cleanup_count;
end;
$$;

-- Duel departures are symmetric: either participant can leave, including the
-- host. Group rooms hand off host ownership. Party rooms cancel if the host
-- leaves because no other device owns the shared audio.
create or replace function public.leave_arena_room(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_room public.arena_rooms%rowtype;
  current_player public.arena_room_players%rowtype;
  question_total integer;
  remaining_active_count integer;
  replacement_host_id uuid;
  leave_time timestamptz := clock_timestamp();
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;

  select * into target_room from public.arena_rooms
  where id = target_room_id and mode in ('duel', 'group_lobby', 'party_mode')
  for update;
  if target_room.id is null then return true; end if;

  select * into current_player from public.arena_room_players
  where room_id = target_room_id and user_id = caller_id
  for update;
  if current_player.id is null or current_player.left_at is not null then return true; end if;

  -- Results are immutable once the room is terminal. In particular, a later
  -- cleanup/leave request must not turn a forfeit winner into a plain leaver.
  if target_room.status not in ('waiting', 'starting', 'active') then
    return true;
  end if;

  question_total := coalesce(jsonb_array_length(target_room.quiz_questions), 0);

  if target_room.status = 'active' and target_room.mode = 'party_mode'
    and target_room.host_user_id = caller_id
  then
    update public.arena_rooms
    set status = 'cancelled', finished_at = coalesce(finished_at, leave_time),
        rematch_requested_by = null, rematch_requested_at = null,
        host_is_choosing_album = false, close_reason = 'host_ended'
    where id = target_room_id;

    update public.arena_room_players
    set lobby_ready = false, is_ready = false, presence_status = 'left',
        left_at = coalesce(left_at, leave_time),
        result_status = case
          when result_status in ('completed', 'forfeit', 'win_by_forfeit') then result_status
          when user_id = caller_id then 'left' else 'cancelled' end
    where room_id = target_room_id and left_at is null;
    return true;
  end if;

  if target_room.status = 'active' then
    update public.arena_room_players
    set final_score = greatest(final_score, current_score),
        correct_answers = greatest(correct_answers, current_correct_answers),
        total_questions = greatest(total_questions, question_total),
        finished_at = coalesce(finished_at, leave_time),
        forfeited_at = case
          when current_player.finished_at is null
            then coalesce(forfeited_at, leave_time)
          else forfeited_at
        end,
        left_at = coalesce(left_at, leave_time),
        lobby_ready = false, is_ready = false, presence_status = 'left',
        result_status = case
          when current_player.finished_at is not null
            and current_player.result_status = 'completed' then 'completed'
          else 'forfeit'
        end
    where id = current_player.id;

    if target_room.mode = 'duel' then
      update public.arena_room_players
      set final_score = greatest(final_score, current_score),
          correct_answers = greatest(correct_answers, current_correct_answers),
          total_questions = greatest(total_questions, question_total),
          finished_at = coalesce(finished_at, leave_time),
          result_status = case when result_status = 'completed'
            then result_status else 'win_by_forfeit' end
      where room_id = target_room_id and user_id <> caller_id and left_at is null;

      update public.arena_rooms
      set status = 'finished', finished_at = coalesce(finished_at, leave_time),
          rematch_requested_by = null, rematch_requested_at = null
      where id = target_room_id;
      return true;
    end if;

    if target_room.mode = 'group_lobby' and target_room.host_user_id = caller_id then
      select user_id into replacement_host_id from public.arena_room_players
      where room_id = target_room_id and user_id <> caller_id
        and left_at is null and finished_at is null
        and coalesce(result_status, 'active') not in ('cancelled', 'left', 'forfeit')
      order by joined_at asc limit 1;

      if replacement_host_id is not null then
        update public.arena_rooms set host_user_id = replacement_host_id
        where id = target_room_id;
      end if;
    end if;

    select count(*)::integer into remaining_active_count
    from public.arena_room_players
    where room_id = target_room_id and left_at is null and finished_at is null
      and coalesce(result_status, 'active') not in ('cancelled', 'left', 'forfeit');
    if remaining_active_count = 0 then
      update public.arena_rooms
      set status = 'finished', finished_at = coalesce(finished_at, leave_time),
          rematch_requested_by = null, rematch_requested_at = null
      where id = target_room_id;
    end if;
    return true;
  end if;

  if target_room.host_user_id = caller_id then
    update public.arena_rooms
    set status = 'cancelled', finished_at = coalesce(finished_at, leave_time),
        rematch_requested_by = null, rematch_requested_at = null,
        host_is_choosing_album = false, close_reason = 'host_ended'
    where id = target_room_id;

    update public.arena_room_players
    set lobby_ready = false, is_ready = false, presence_status = 'left',
        left_at = coalesce(left_at, leave_time),
        result_status = case
          when result_status in ('completed', 'forfeit', 'win_by_forfeit') then result_status
          else 'cancelled' end
    where room_id = target_room_id and left_at is null;
    return true;
  end if;

  update public.arena_room_players
  set left_at = coalesce(left_at, leave_time), lobby_ready = false,
      is_ready = false, presence_status = 'left', result_status = 'left'
  where id = current_player.id;

  return true;
end;
$$;

-- Keep the explicit forfeit control on the same locked, idempotent lifecycle
-- path as a voluntary departure so simultaneous submits cannot award twice.
create or replace function public.forfeit_arena_room(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_status text;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  select status into room_status from public.arena_rooms
  where id = target_room_id and mode in ('duel', 'group_lobby', 'party_mode')
  for update;
  if room_status is distinct from 'active' then
    raise exception 'This Arena game is not active.';
  end if;
  perform public.leave_arena_room(target_room_id);
  return true;
end;
$$;

revoke all on function public.reconcile_arena_room_presence_internal(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.cleanup_stale_arena_presence()
  from public, anon;
grant execute on function public.cleanup_stale_arena_presence() to authenticated;
revoke all on function public.leave_arena_room(uuid) from public, anon;
grant execute on function public.leave_arena_room(uuid) to authenticated;
revoke all on function public.forfeit_arena_room(uuid) from public, anon;
grant execute on function public.forfeit_arena_room(uuid) to authenticated;

commit;

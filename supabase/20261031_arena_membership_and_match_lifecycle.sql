begin;

-- Additive lifecycle repair. Existing scores/history and trusted answer keys are not rewritten.
CREATE OR REPLACE FUNCTION public.leave_arena_room(target_room_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- Membership departure must not rewrite immutable match results.
    update public.arena_room_players set left_at = leave_time,
      presence_status = 'left', presence_updated_at = leave_time,
      lobby_ready = false, is_ready = false
    where id = current_player.id;
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
$function$;

CREATE OR REPLACE FUNCTION public.change_waiting_arena_album(target_room_id uuid, new_album_id text DEFAULT NULL::text, new_album_name text DEFAULT NULL::text, new_artist_name text DEFAULT NULL::text, new_artwork_url text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  if nullif(btrim(new_album_id), '') is null or nullif(btrim(new_album_name), '') is null then
    raise exception 'Select a valid album.';
  end if;
  -- Serialize album selection with joins, starts and readiness updates.
  perform 1 from public.arena_rooms where id = target_room_id for update;

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
    and status = 'waiting'
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
$function$;

CREATE OR REPLACE FUNCTION public.forfeit_arena_room(target_room_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
declare
  target_room public.arena_rooms%rowtype;
  caller_id uuid := auth.uid();
  current_player public.arena_room_players%rowtype;
  finish_time timestamptz := clock_timestamp();
  question_total integer;
begin
  if caller_id is null then raise exception 'Authentication is required.'; end if;
  select * into target_room from public.arena_rooms where id = target_room_id for update;
  select * into current_player from public.arena_room_players
    where room_id = target_room_id and user_id = caller_id and left_at is null for update;
  if current_player.id is null then
    raise exception 'Room membership is required.';
  end if;
  -- Repeated clicks must not resolve a completed game twice.
  if target_room.status = 'finished' then return true; end if;
  if target_room.status <> 'active' then raise exception 'This Arena game is not active.'; end if;
  if target_room.mode = 'party_mode' and target_room.host_user_id = caller_id then
    raise exception 'The Party host must use End Party.';
  end if;
  if current_player.finished_at is not null then return true; end if;
  question_total := coalesce(jsonb_array_length(target_room.quiz_questions), 0);
  -- Same stored authoritative values as voluntary departure, but never mark
  -- membership LEFT or transfer ownership. No temporary rejoin/maintenance bypass.
  update public.arena_room_players set
    final_score = greatest(final_score, current_score),
    correct_answers = greatest(correct_answers, current_correct_answers),
    total_questions = greatest(total_questions, question_total),
    finished_at = finish_time, forfeited_at = finish_time,
    lobby_ready = false, is_ready = false, result_status = 'forfeit'
  where id = current_player.id;
  if target_room.mode = 'duel' then
    update public.arena_room_players set
      final_score = greatest(final_score, current_score),
      correct_answers = greatest(correct_answers, current_correct_answers),
      total_questions = greatest(total_questions, question_total),
      finished_at = coalesce(finished_at, finish_time),
      result_status = case when result_status = 'completed' then result_status else 'win_by_forfeit' end
    where room_id = target_room_id and user_id <> caller_id and left_at is null;
  end if;
  if target_room.mode = 'duel' or not exists (
    select 1 from public.arena_room_players
    where room_id = target_room_id and left_at is null and finished_at is null
      and (target_room.mode <> 'party_mode' or user_id <> target_room.host_user_id)
      and coalesce(result_status, 'active') not in ('cancelled','left','forfeit')
  ) then
    update public.arena_rooms set status = 'finished', finished_at = coalesce(finished_at, finish_time),
      rematch_requested_by = null, rematch_requested_at = null
    where id = target_room_id;
  end if;
  return true;
end;
$function$;

revoke all on function public.change_waiting_arena_album(uuid,text,text,text,text) from public, anon;
grant execute on function public.change_waiting_arena_album(uuid,text,text,text,text) to authenticated;
revoke all on function public.forfeit_arena_room(uuid) from public, anon;
grant execute on function public.forfeit_arena_room(uuid) to authenticated;

-- A guest may cause a trusted room-completion trigger to save OTHER players'
-- results. Suppress the guest's rows, not every row in that transaction.
-- Existing ownership RLS and authoritative result guards remain unchanged.
create or replace function public.block_anonymous_progression_write()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (new.user_id = auth.uid() and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false))
    or exists (select 1 from auth.users au
      where au.id = new.user_id and coalesce(au.is_anonymous, false))
  then return null; end if;
  return new;
end;
$$;

commit;


begin;

alter table public.arena_room_players
  add column if not exists lobby_ready boolean not null default false,
  add column if not exists presence_status text not null default 'connected',
  add column if not exists presence_updated_at timestamptz not null default clock_timestamp();

alter table public.arena_room_players
  drop constraint if exists arena_room_players_presence_status_check;
alter table public.arena_room_players
  add constraint arena_room_players_presence_status_check
  check (presence_status in ('connected', 'reconnecting', 'left'));

alter table public.arena_rooms
  add column if not exists host_is_choosing_album boolean not null default false,
  add column if not exists close_reason text;

create index if not exists arena_room_players_room_presence_idx
  on public.arena_room_players (room_id, presence_updated_at)
  where left_at is null;

create or replace function public.set_arena_lobby_ready(
  target_room_id uuid,
  target_ready boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
  required_count integer;
  ready_count integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  select * into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby')
    and status = 'waiting'
  for update;

  if target_room.id is null then
    raise exception 'This lobby is no longer waiting.';
  end if;

  update public.arena_room_players
  set
    lobby_ready = target_ready,
    is_ready = false,
    presence_status = 'connected',
    presence_updated_at = clock_timestamp()
  where room_id = target_room_id
    and user_id = auth.uid()
    and left_at is null
    and finished_at is null
    and coalesce(result_status, 'active') not in ('cancelled', 'left', 'forfeit');

  if not found then
    raise exception 'Only current lobby players can change readiness.';
  end if;

  select
    count(*)::integer,
    count(*) filter (where lobby_ready)::integer
  into required_count, ready_count
  from public.arena_room_players
  where room_id = target_room_id
    and left_at is null
    and finished_at is null
    and coalesce(result_status, 'active') not in ('cancelled', 'left', 'forfeit');

  return jsonb_build_object(
    'ready', target_ready,
    'requiredCount', required_count,
    'readyCount', ready_count,
    'allReady', required_count > 0 and ready_count = required_count
  );
end;
$$;

create or replace function public.heartbeat_arena_room_presence(
  target_room_id uuid
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

  update public.arena_room_players player
  set
    presence_status = 'connected',
    presence_updated_at = clock_timestamp()
  from public.arena_rooms room
  where player.room_id = target_room_id
    and player.user_id = auth.uid()
    and player.left_at is null
    and room.id = player.room_id
    and room.status in ('waiting', 'starting', 'active');

  return found;
end;
$$;

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
  departed_count integer := 0;
  reconnecting_count integer := 0;
  remaining_count integer := 0;
  minimum_players integer := 0;
begin
  select * into target_room
  from public.arena_rooms
  where id = target_room_id
    and status in ('waiting', 'starting')
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
    update public.arena_rooms
    set
      status = 'cancelled',
      finished_at = coalesce(finished_at, server_now),
      rematch_requested_by = null,
      rematch_requested_at = null,
      host_is_choosing_album = false,
      close_reason = 'host_disconnected'
    where id = target_room_id;

    update public.arena_room_players
    set
      lobby_ready = false,
      is_ready = false,
      presence_status = 'left',
      left_at = coalesce(left_at, server_now),
      result_status = case
        when result_status in ('completed', 'forfeit', 'win_by_forfeit')
          then result_status
        else 'cancelled'
      end
    where room_id = target_room_id
      and left_at is null;

    return jsonb_build_object(
      'changed', true,
      'hostClosed', true,
      'reason', 'host_disconnect_timeout'
    );
  end if;

  update public.arena_room_players
  set presence_status = 'reconnecting'
  where room_id = target_room_id
    and left_at is null
    and presence_status = 'connected'
    and presence_updated_at <= server_now - interval '12 seconds';
  get diagnostics reconnecting_count = row_count;

  update public.arena_room_players
  set
    lobby_ready = false,
    is_ready = false,
    presence_status = 'left',
    left_at = coalesce(left_at, server_now),
    result_status = 'left'
  where room_id = target_room_id
    and user_id <> target_room.host_user_id
    and left_at is null
    and presence_updated_at <= server_now - interval '45 seconds';
  get diagnostics departed_count = row_count;

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
    set
      status = 'waiting',
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
    where room_id = target_room_id
      and left_at is null;
  end if;

  return jsonb_build_object(
    'changed', departed_count > 0 or reconnecting_count > 0,
    'hostClosed', false,
    'reconnectingCount', reconnecting_count,
    'departedCount', departed_count,
    'remainingCount', remaining_count
  );
end;
$$;

create or replace function public.reconcile_arena_room_presence(
  target_room_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.arena_room_players player
    where player.room_id = target_room_id
      and player.user_id = auth.uid()
      and player.left_at is null
  ) then
    raise exception 'Only current room players can reconcile presence.';
  end if;

  return public.reconcile_arena_room_presence_internal(
    target_room_id,
    clock_timestamp()
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
    select id
    from public.arena_rooms
    where status in ('waiting', 'starting')
  loop
    result := public.reconcile_arena_room_presence_internal(
      target.id,
      clock_timestamp()
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

create or replace function public.set_arena_host_album_selection(
  target_room_id uuid,
  target_is_choosing boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.arena_rooms
  set host_is_choosing_album = target_is_choosing
  where id = target_room_id
    and host_user_id = auth.uid()
    and status = 'finished';

  if not found then
    raise exception 'Only the host can change the rematch album.';
  end if;

  return true;
end;
$$;

create or replace function public.guard_arena_lobby_start_readiness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  required_count integer;
  ready_count integer;
  connected_count integer;
  minimum_players integer;
begin
  if old.status = 'waiting'
    and new.status in ('starting', 'active')
    and new.mode in ('duel', 'group_lobby')
  then
    select
      count(*)::integer,
      count(*) filter (where lobby_ready)::integer,
      count(*) filter (
        where presence_status = 'connected'
          and presence_updated_at > clock_timestamp() - interval '20 seconds'
      )::integer
    into required_count, ready_count, connected_count
    from public.arena_room_players
    where room_id = new.id
      and left_at is null
      and finished_at is null
      and coalesce(result_status, 'active') not in (
        'cancelled', 'left', 'forfeit'
      );

    minimum_players := case when new.mode = 'duel' then 2 else 3 end;

    if required_count < minimum_players
      or (new.mode = 'duel' and required_count <> 2)
      or ready_count <> required_count
      or connected_count <> required_count
    then
      raise exception 'Every current player must ready up before the host can start.';
    end if;
  end if;

  if new.status <> 'finished' then
    new.host_is_choosing_album := false;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_arena_lobby_start_readiness
  on public.arena_rooms;
create trigger guard_arena_lobby_start_readiness
before update of status, round_number on public.arena_rooms
for each row execute function public.guard_arena_lobby_start_readiness();

create or replace function public.clear_arena_ready_on_new_generation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.round_number is distinct from old.round_number then
    update public.arena_room_players
    set
      lobby_ready = false,
      is_ready = false,
      presence_status = 'connected',
      presence_updated_at = clock_timestamp()
    where room_id = new.id
      and left_at is null;
  end if;
  return null;
end;
$$;

drop trigger if exists clear_arena_ready_on_new_generation
  on public.arena_rooms;
create trigger clear_arena_ready_on_new_generation
after update of round_number on public.arena_rooms
for each row execute function public.clear_arena_ready_on_new_generation();

create or replace function public.normalize_arena_player_rejoin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.left_at is not null and new.left_at is null then
    new.lobby_ready := false;
    new.is_ready := false;
    new.presence_status := 'connected';
    new.presence_updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_arena_player_rejoin
  on public.arena_room_players;
create trigger normalize_arena_player_rejoin
before update of left_at on public.arena_room_players
for each row execute function public.normalize_arena_player_rejoin();

-- Intentional host departure closes the room. Ownership never migrates.
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
begin
  if caller_id is null then
    raise exception 'Authentication is required.';
  end if;

  select * into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode in ('duel', 'group_lobby', 'party_mode')
  for update;

  if target_room.id is null then
    return true;
  end if;

  select * into current_player
  from public.arena_room_players
  where room_id = target_room_id
    and user_id = caller_id
  for update;

  if current_player.id is null or current_player.left_at is not null then
    return true;
  end if;

  if target_room.host_user_id = caller_id then
    update public.arena_rooms
    set
      status = 'cancelled',
      finished_at = coalesce(finished_at, clock_timestamp()),
      rematch_requested_by = null,
      rematch_requested_at = null,
      host_is_choosing_album = false,
      close_reason = 'host_ended'
    where id = target_room_id;

    update public.arena_room_players
    set
      lobby_ready = false,
      is_ready = false,
      presence_status = 'left',
      left_at = coalesce(left_at, clock_timestamp()),
      result_status = case
        when user_id = caller_id and target_room.status = 'active' then 'forfeit'
        when result_status in ('completed', 'forfeit', 'win_by_forfeit') then result_status
        else 'cancelled'
      end
    where room_id = target_room_id
      and left_at is null;

    return true;
  end if;

  question_total := coalesce(jsonb_array_length(target_room.quiz_questions), 0);

  update public.arena_room_players
  set
    final_score = case
      when target_room.status = 'active' then greatest(final_score, current_score)
      else final_score
    end,
    correct_answers = case
      when target_room.status = 'active' then greatest(correct_answers, current_correct_answers)
      else correct_answers
    end,
    total_questions = case
      when target_room.status = 'active' then greatest(total_questions, question_total)
      else total_questions
    end,
    finished_at = case
      when target_room.status = 'active' then coalesce(finished_at, clock_timestamp())
      else finished_at
    end,
    forfeited_at = case
      when target_room.status = 'active' then coalesce(forfeited_at, clock_timestamp())
      else forfeited_at
    end,
    left_at = coalesce(left_at, clock_timestamp()),
    lobby_ready = false,
    is_ready = false,
    presence_status = 'left',
    result_status = case when target_room.status = 'active' then 'forfeit' else 'left' end
  where id = current_player.id;

  if target_room.status = 'active' and target_room.mode = 'duel' then
    update public.arena_room_players
    set
      final_score = greatest(final_score, current_score),
      correct_answers = greatest(correct_answers, current_correct_answers),
      total_questions = greatest(total_questions, question_total),
      finished_at = coalesce(finished_at, clock_timestamp()),
      result_status = case
        when result_status = 'completed' then result_status
        else 'win_by_forfeit'
      end
    where room_id = target_room_id
      and user_id <> caller_id
      and left_at is null;

    update public.arena_rooms
    set status = 'finished', finished_at = coalesce(finished_at, clock_timestamp())
    where id = target_room_id;
  elsif target_room.status = 'active' then
    select count(*)::integer into remaining_active_count
    from public.arena_room_players
    where room_id = target_room_id
      and left_at is null
      and finished_at is null;

    if remaining_active_count = 0 then
      update public.arena_rooms
      set status = 'finished', finished_at = coalesce(finished_at, clock_timestamp())
      where id = target_room_id;
    end if;
  end if;

  return true;
end;
$$;

create or replace function public.end_arena_room(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.arena_rooms
  set
    status = 'cancelled',
    finished_at = coalesce(finished_at, clock_timestamp()),
    rematch_requested_by = null,
    rematch_requested_at = null,
    host_is_choosing_album = false,
    close_reason = 'host_ended'
  where id = target_room_id
    and mode in ('duel', 'group_lobby', 'party_mode')
    and host_user_id = auth.uid()
    and status in ('waiting', 'starting', 'active', 'finished');

  if not found then
    raise exception 'Only the host can end this Arena room.';
  end if;

  update public.arena_room_players
  set
    lobby_ready = false,
    is_ready = false,
    presence_status = 'left',
    left_at = coalesce(left_at, clock_timestamp()),
    result_status = case
      when result_status in ('completed', 'forfeit', 'win_by_forfeit')
        then result_status
      else 'cancelled'
    end
  where room_id = target_room_id
    and left_at is null;

  return true;
end;
$$;

create or replace function public.leave_waiting_arena_room(target_room_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select public.leave_arena_room(target_room_id);
$$;

revoke all on function public.set_arena_lobby_ready(uuid, boolean)
  from public, anon;
revoke all on function public.heartbeat_arena_room_presence(uuid)
  from public, anon;
revoke all on function public.reconcile_arena_room_presence(uuid)
  from public, anon;
revoke all on function public.cleanup_stale_arena_presence()
  from public, anon;
revoke all on function public.set_arena_host_album_selection(uuid, boolean)
  from public, anon;
revoke all on function public.end_arena_room(uuid)
  from public, anon;
revoke all on function public.reconcile_arena_room_presence_internal(uuid, timestamptz)
  from public, anon, authenticated;

grant execute on function public.set_arena_lobby_ready(uuid, boolean)
  to authenticated;
grant execute on function public.heartbeat_arena_room_presence(uuid)
  to authenticated;
grant execute on function public.reconcile_arena_room_presence(uuid)
  to authenticated;
grant execute on function public.cleanup_stale_arena_presence()
  to authenticated;
grant execute on function public.set_arena_host_album_selection(uuid, boolean)
  to authenticated;
grant execute on function public.leave_arena_room(uuid)
  to authenticated;
grant execute on function public.leave_waiting_arena_room(uuid)
  to authenticated;
grant execute on function public.end_arena_room(uuid)
  to authenticated;

commit;

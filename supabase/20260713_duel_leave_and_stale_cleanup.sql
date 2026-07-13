alter table public.arena_rooms
  add column if not exists expires_at timestamptz;

alter table public.arena_room_players
  add column if not exists current_score integer not null default 0,
  add column if not exists current_correct_answers integer not null default 0,
  add column if not exists current_question_index integer not null default 0,
  add column if not exists current_streak integer not null default 0,
  add column if not exists left_at timestamptz,
  add column if not exists forfeited_at timestamptz,
  add column if not exists result_status text not null default 'active';

create or replace function public.cancel_stale_duel_rooms()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cancelled_count integer;
  active_cancelled_count integer;
begin
  update public.arena_rooms
  set
    status = 'cancelled',
    finished_at = coalesce(finished_at, now())
  where mode = 'duel'
    and status = 'waiting'
    and coalesce(expires_at, created_at + interval '2 hours') < now();

  get diagnostics cancelled_count = row_count;

  update public.arena_rooms
  set
    status = 'cancelled',
    finished_at = coalesce(finished_at, now())
  where mode = 'duel'
    and status = 'active'
    and coalesce(started_at, created_at) < now() - interval '90 minutes';

  get diagnostics active_cancelled_count = row_count;
  cancelled_count := cancelled_count + active_cancelled_count;

  return cancelled_count;
end;
$$;

create or replace function public.close_duel_room(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.arena_rooms
  set
    status = 'cancelled',
    finished_at = coalesce(finished_at, now())
  where id = target_room_id
    and mode = 'duel'
    and status in ('waiting', 'starting')
    and host_user_id = auth.uid();

  if not found then
    raise exception 'Only the host can close a waiting Duel lobby.';
  end if;

  update public.arena_room_players
  set
    left_at = coalesce(left_at, now()),
    result_status = 'cancelled'
  where room_id = target_room_id
    and left_at is null;

  return true;
end;
$$;

create or replace function public.leave_waiting_duel_room(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.arena_rooms
    where id = target_room_id
      and mode = 'duel'
      and status in ('waiting', 'starting')
  ) then
    raise exception 'This Duel lobby is not waiting.';
  end if;

  update public.arena_room_players
  set
    left_at = coalesce(left_at, now()),
    result_status = 'left'
  where room_id = target_room_id
    and user_id = auth.uid()
    and left_at is null;

  if not found then
    raise exception 'You are not in this Duel lobby.';
  end if;

  return true;
end;
$$;

create or replace function public.forfeit_duel_room(target_room_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  question_total integer;
begin
  select coalesce(jsonb_array_length(quiz_questions), 0)
  into question_total
  from public.arena_rooms
  where id = target_room_id
    and mode = 'duel'
    and status = 'active';

  if question_total is null then
    raise exception 'This Duel is not active.';
  end if;

  update public.arena_room_players
  set
    final_score = greatest(final_score, current_score),
    correct_answers = greatest(correct_answers, current_correct_answers),
    total_questions = greatest(total_questions, question_total),
    finished_at = coalesce(finished_at, now()),
    forfeited_at = coalesce(forfeited_at, now()),
    left_at = coalesce(left_at, now()),
    result_status = 'forfeit'
  where room_id = target_room_id
    and user_id = auth.uid();

  if not found then
    raise exception 'You are not in this Duel.';
  end if;

  update public.arena_room_players
  set
    final_score = greatest(final_score, current_score),
    correct_answers = greatest(correct_answers, current_correct_answers),
    total_questions = greatest(total_questions, question_total),
    finished_at = coalesce(finished_at, now()),
    result_status = 'win_by_forfeit'
  where room_id = target_room_id
    and user_id <> auth.uid()
    and left_at is null;

  update public.arena_rooms
  set
    status = 'finished',
    finished_at = coalesce(finished_at, now())
  where id = target_room_id
    and mode = 'duel';

  return true;
end;
$$;

grant execute on function public.cancel_stale_duel_rooms() to authenticated;
grant execute on function public.close_duel_room(uuid) to authenticated;
grant execute on function public.leave_waiting_duel_room(uuid) to authenticated;
grant execute on function public.forfeit_duel_room(uuid) to authenticated;

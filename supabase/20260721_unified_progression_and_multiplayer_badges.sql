-- Unify Single Player and Arena progression in quiz_results.

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
  check (game_mode in ('single_player', 'duel', 'group_lobby', 'party_mode', 'championship'));

create unique index if not exists quiz_results_arena_round_user_unique_idx
  on public.quiz_results (arena_room_id, arena_round_number, user_id)
  where arena_room_id is not null;

create index if not exists quiz_results_user_mode_played_idx
  on public.quiz_results (user_id, game_mode, played_at desc);

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
  select *
  into target_room
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
  ),
  ranked as (
    select
      candidates.*,
      rank() over (
        order by
          result_rank desc,
          final_score desc,
          accuracy desc,
          average_answer_time asc
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
    user_id,
    album_name,
    artist_name,
    total_questions,
    correct_answers,
    accuracy,
    final_points,
    average_answer_time,
    played_at,
    game_mode,
    arena_room_id,
    arena_round_number,
    is_private,
    is_winner,
    was_host,
    player_count,
    placement,
    score_margin,
    result_status
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
          (
            select max(opponent.final_score)
            from candidates opponent
            where opponent.user_id <> resolved.user_id
          ),
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

revoke all on function public.sync_arena_progression_for_room(uuid) from public;
revoke all on function public.sync_arena_progression_for_room(uuid) from anon;
revoke all on function public.sync_arena_progression_for_room(uuid) from authenticated;

create or replace function public.sync_arena_progression_when_finished()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'finished' and old.status is distinct from new.status then
    perform public.sync_arena_progression_for_room(new.id);
  end if;

  return new;
end;
$$;

revoke all on function public.sync_arena_progression_when_finished() from public;
revoke all on function public.sync_arena_progression_when_finished() from anon;
revoke all on function public.sync_arena_progression_when_finished() from authenticated;

drop trigger if exists arena_rooms_sync_progression on public.arena_rooms;
create trigger arena_rooms_sync_progression
  after update of status on public.arena_rooms
  for each row
  execute function public.sync_arena_progression_when_finished();

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
  qr.game_mode,
  qr.is_private,
  qr.is_winner,
  qr.was_host,
  qr.player_count,
  qr.placement,
  qr.score_margin,
  qr.result_status
from public.quiz_results qr
join public.profiles p on p.id = qr.user_id
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
  coalesce(nullif(p.display_name, ''), nullif(p.username, ''), 'Unknown Player') as player_name,
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

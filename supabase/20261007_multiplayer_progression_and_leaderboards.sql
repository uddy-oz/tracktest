begin;

-- Competitive progression is derived only from authoritative, finished Arena
-- rooms. Legacy point-based Duel/Group rows remain intact but are deliberately
-- ineligible for the new round-based career statistics.
alter table public.quiz_results
  add column if not exists multiplayer_outcome text,
  add column if not exists competitive_progression_eligible boolean not null default false,
  add column if not exists clean_sheet boolean not null default false,
  add column if not exists opponent_round_wins integer not null default 0,
  add column if not exists opponents_defeated integer not null default 0,
  add column if not exists comeback_win boolean not null default false,
  add column if not exists dominant_win boolean not null default false;

alter table public.quiz_results
  drop constraint if exists quiz_results_multiplayer_outcome_check;

alter table public.quiz_results
  add constraint quiz_results_multiplayer_outcome_check
  check (multiplayer_outcome is null or multiplayer_outcome in ('win', 'loss', 'draw'));

create index if not exists quiz_results_competitive_progression_idx
  on public.quiz_results (competitive_progression_eligible, played_at desc)
  where competitive_progression_eligible;

create index if not exists quiz_results_competitive_user_idx
  on public.quiz_results (user_id, played_at desc)
  where competitive_progression_eligible;

-- This trigger is the trust boundary for competitive career data. Even if a
-- browser attempts to insert a quiz_result directly, the row only qualifies
-- when it matches a finished authoritative room and a registered room member.
create or replace function public.derive_competitive_progression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_room public.arena_rooms%rowtype;
  target_player public.arena_room_players%rowtype;
  participant_count integer := 0;
  minimum_participants integer := 0;
  opponent_wins integer := 0;
  scored_rounds integer := 0;
  was_behind_by_two boolean := false;
  resolved_placement integer := 0;
  top_tie_count integer := 0;
  opponent_score integer := 0;
  is_existing_result boolean := tg_op = 'UPDATE';
begin
  -- Existing result rows are immutable match records. Backfills may update only
  -- derived progression fields; they must never rewrite a rematch generation or
  -- replace an older score/timestamp with the room's latest player snapshot.
  if is_existing_result then
    new.id := old.id;
    new.user_id := old.user_id;
    new.album_name := old.album_name;
    new.artist_name := old.artist_name;
    new.total_questions := old.total_questions;
    new.correct_answers := old.correct_answers;
    new.accuracy := old.accuracy;
    new.final_points := old.final_points;
    new.average_answer_time := old.average_answer_time;
    new.played_at := old.played_at;
    new.game_mode := old.game_mode;
    new.arena_room_id := old.arena_room_id;
    new.arena_round_number := old.arena_round_number;
    new.is_private := old.is_private;
    new.is_winner := old.is_winner;
    new.was_host := old.was_host;
    new.player_count := old.player_count;
    new.placement := old.placement;
    new.score_margin := old.score_margin;
    new.result_status := old.result_status;
    new.scoring_model := old.scoring_model;
    new.round_points := old.round_points;
    new.rounds_won := old.rounds_won;
    new.rounds_played := old.rounds_played;
    new.average_winning_response_time := old.average_winning_response_time;
    new.fastest_winning_response_time := old.fastest_winning_response_time;
  end if;

  new.multiplayer_outcome := null;
  new.competitive_progression_eligible := false;
  new.clean_sheet := false;
  new.opponent_round_wins := 0;
  new.opponents_defeated := 0;
  new.comeback_win := false;
  new.dominant_win := false;

  if new.game_mode = 'single_player' or new.arena_room_id is null then
    return new;
  end if;

  select * into target_room
  from public.arena_rooms
  where id = new.arena_room_id;

  if target_room.id is null then
    return new;
  end if;

  if not is_existing_result and target_room.status <> 'finished' then
    return new;
  end if;

  if exists (
    select 1 from auth.users registered_user
    where registered_user.id = new.user_id
      and coalesce(registered_user.is_anonymous, false)
  ) then
    return new;
  end if;

  if is_existing_result then
    participant_count := greatest(coalesce(new.player_count, 0), 0);
    minimum_participants := case new.game_mode
      when 'duel' then 2
      when 'group_lobby' then 3
      when 'party_mode' then 1
      else 2
    end;

    -- Point-era Duel/Group rows remain stored but cannot be translated into the
    -- authoritative round model. Compatible generations retain their original
    -- result data and receive derived progression only.
    if participant_count < minimum_participants or (
      new.game_mode in ('duel', 'group_lobby') and (
        new.scoring_model <> 'round_points' or new.rounds_played <= 0
      )
    ) then
      return new;
    end if;

    new.competitive_progression_eligible := true;
    new.multiplayer_outcome := case
      when new.is_winner then 'win'
      when coalesce(new.placement, 0) = 1 then 'draw'
      else 'loss'
    end;

    if new.scoring_model = 'round_points' then
      select count(*) filter (
        where answer.is_round_winner and answer.user_id <> new.user_id
      )::integer
      into opponent_wins
      from public.arena_competitive_answers answer
      where answer.room_id = new.arena_room_id
        and answer.room_round_number = new.arena_round_number;

      -- Older compatible deployments may have retained result rows after their
      -- answer detail was pruned. Fall back to same-generation result records,
      -- never to the room's latest arena_room_players state.
      if opponent_wins = 0 then
        select coalesce(sum(greatest(result.rounds_won, 0)), 0)::integer
        into opponent_wins
        from public.quiz_results result
        where result.arena_room_id = new.arena_room_id
          and result.arena_round_number = new.arena_round_number
          and result.user_id <> new.user_id
          and coalesce(result.result_status, 'active') not in ('cancelled', 'left');
      end if;

      new.opponent_round_wins := coalesce(opponent_wins, 0);
      scored_rounds := greatest(new.rounds_won, 0) + new.opponent_round_wins;
      new.clean_sheet := new.multiplayer_outcome = 'win'
        and new.rounds_won > 0
        and new.opponent_round_wins = 0;
      new.dominant_win := new.multiplayer_outcome = 'win'
        and scored_rounds > 0
        and new.rounds_won::numeric / scored_rounds >= 0.75;

      with per_question as (
        select
          answer.question_index,
          count(*) filter (
            where answer.is_round_winner and answer.user_id = new.user_id
          )::integer as own_win,
          count(*) filter (
            where answer.is_round_winner and answer.user_id <> new.user_id
          )::integer as opponent_win
        from public.arena_competitive_answers answer
        where answer.room_id = new.arena_room_id
          and answer.room_round_number = new.arena_round_number
        group by answer.question_index
      ), scoreline as (
        select
          sum(own_win) over (order by question_index) as own_total,
          sum(opponent_win) over (order by question_index) as opponent_total
        from per_question
      )
      select coalesce(bool_or(opponent_total - own_total >= 2), false)
      into was_behind_by_two
      from scoreline;

      new.comeback_win := new.multiplayer_outcome = 'win' and was_behind_by_two;
    end if;

    new.opponents_defeated := case
      when new.multiplayer_outcome = 'win' then greatest(participant_count - 1, 0)
      when new.multiplayer_outcome = 'draw' then 0
      else greatest(participant_count - coalesce(new.placement, participant_count), 0)
    end;

    return new;
  end if;

  select * into target_player
  from public.arena_room_players
  where room_id = target_room.id
    and user_id = new.user_id
    and coalesce(result_status, 'active') not in ('cancelled', 'left');

  if target_player.id is null then
    return new;
  end if;

  select count(*)::integer into participant_count
  from public.arena_room_players player
  where player.room_id = target_room.id
    and coalesce(player.result_status, 'active') not in ('cancelled', 'left')
    and (target_room.mode <> 'party_mode' or player.user_id <> target_room.host_user_id);

  minimum_participants := case target_room.mode
    when 'duel' then 2
    when 'group_lobby' then 3
    when 'party_mode' then 1
    else 2
  end;

  if participant_count < minimum_participants then
    return new;
  end if;

  -- Never trust competitive values supplied by the browser. Rebuild the row
  -- from the authoritative room and room-player snapshots before evaluating it.
  new.album_name := coalesce(nullif(target_room.album_name, ''), 'Arena Album');
  new.artist_name := coalesce(nullif(target_room.artist_name, ''), 'Unknown Artist');
  new.played_at := coalesce(
    target_player.finished_at,
    target_room.finished_at,
    clock_timestamp()
  );
  new.game_mode := target_room.mode;
  new.arena_round_number := coalesce(target_room.round_number, 1);
  new.is_private := coalesce(target_room.is_private, false);
  new.was_host := new.user_id = target_room.host_user_id;
  new.player_count := participant_count;
  new.final_points := greatest(coalesce(target_player.final_score, 0), 0);
  new.correct_answers := greatest(coalesce(target_player.correct_answers, 0), 0);
  new.total_questions := greatest(coalesce(target_player.total_questions, 0), 0);
  new.accuracy := case
    when new.total_questions > 0
      then round(new.correct_answers::numeric / new.total_questions * 100, 2)
    else 0
  end;
  new.average_answer_time := greatest(
    coalesce(target_player.average_answer_time, 0),
    0
  );
  new.round_points := greatest(coalesce(target_player.round_points, 0), 0);
  new.rounds_won := greatest(coalesce(target_player.rounds_won, 0), 0);
  new.rounds_played := greatest(coalesce(target_player.rounds_played, 0), 0);
  new.average_winning_response_time :=
    greatest(coalesce(target_player.average_winning_response_ms, 0), 0)::numeric / 1000;
  new.fastest_winning_response_time := case
    when target_player.fastest_winning_response_ms is null then null
    else greatest(target_player.fastest_winning_response_ms, 0)::numeric / 1000
  end;
  new.result_status := coalesce(target_player.result_status, 'completed');
  new.scoring_model := case
    when target_room.mode in ('duel', 'group_lobby') and new.rounds_played > 0
      then 'round_points'
    else 'legacy'
  end;

  with candidates as (
    select
      player.user_id,
      greatest(coalesce(player.final_score, 0), 0)::integer as final_score,
      greatest(coalesce(player.round_points, 0), 0)::integer as round_points,
      greatest(coalesce(player.average_winning_response_ms, 0), 0)::numeric as response_ms,
      greatest(coalesce(player.average_answer_time, 0), 0)::numeric as answer_time,
      case
        when coalesce(player.total_questions, 0) > 0 then
          coalesce(player.correct_answers, 0)::numeric / player.total_questions
        else 0
      end as accuracy,
      case coalesce(player.result_status, 'completed')
        when 'win_by_forfeit' then 3
        when 'completed' then 2
        when 'active' then 1
        when 'forfeit' then -1
        else 0
      end as result_rank
    from public.arena_room_players player
    where player.room_id = target_room.id
      and coalesce(player.result_status, 'active') not in ('cancelled', 'left')
      and (target_room.mode <> 'party_mode' or player.user_id <> target_room.host_user_id)
  ), ranked as (
    select
      candidates.*,
      rank() over (
        order by
          result_rank desc,
          final_score desc,
          case when target_room.mode in ('duel', 'group_lobby') then response_ms else 0 end asc,
          case when target_room.mode = 'party_mode' then accuracy else 0 end desc,
          case when target_room.mode = 'party_mode' then answer_time else 0 end asc
      )::integer as placement
    from candidates
  ), resolved as (
    select
      ranked.*,
      count(*) filter (where placement = 1) over ()::integer as tie_count
    from ranked
  )
  select placement, tie_count
  into resolved_placement, top_tie_count
  from resolved
  where user_id = new.user_id;

  new.placement := resolved_placement;
  new.is_winner := resolved_placement = 1 and top_tie_count = 1;

  select coalesce(max(
    case
      when target_room.mode in ('duel', 'group_lobby') then player.round_points
      else player.final_score
    end
  ), 0)::integer
  into opponent_score
  from public.arena_room_players player
  where player.room_id = target_room.id
    and player.user_id <> new.user_id
    and coalesce(player.result_status, 'active') not in ('cancelled', 'left')
    and (target_room.mode <> 'party_mode' or player.user_id <> target_room.host_user_id);

  new.score_margin := case
    when new.is_winner then greatest(
      (case when new.scoring_model = 'round_points' then new.round_points else new.final_points end)
        - opponent_score,
      0
    )
    else 0
  end;

  -- Duel and Group career records begin with the authoritative round model.
  -- Old point-model records are preserved but intentionally do not qualify.
  if target_room.mode in ('duel', 'group_lobby')
    and (new.scoring_model <> 'round_points' or new.rounds_played <= 0)
  then
    return new;
  end if;

  new.competitive_progression_eligible := true;
  new.multiplayer_outcome := case
    when new.is_winner then 'win'
    when coalesce(new.placement, 0) = 1 then 'draw'
    else 'loss'
  end;

  if new.scoring_model = 'round_points' then
    select coalesce(sum(greatest(player.rounds_won, 0)), 0)::integer
    into opponent_wins
    from public.arena_room_players player
    where player.room_id = target_room.id
      and player.user_id <> new.user_id
      and coalesce(player.result_status, 'active') not in ('cancelled', 'left');

    new.opponent_round_wins := opponent_wins;
    scored_rounds := greatest(new.rounds_won, 0) + opponent_wins;
    new.clean_sheet := new.multiplayer_outcome = 'win'
      and new.rounds_won > 0
      and opponent_wins = 0;
    new.dominant_win := new.multiplayer_outcome = 'win'
      and scored_rounds > 0
      and new.rounds_won::numeric / scored_rounds >= 0.75;

    with per_question as (
      select
        answer.question_index,
        count(*) filter (
          where answer.is_round_winner and answer.user_id = new.user_id
        )::integer as own_win,
        count(*) filter (
          where answer.is_round_winner and answer.user_id <> new.user_id
        )::integer as opponent_win
      from public.arena_competitive_answers answer
      where answer.room_id = target_room.id
        and answer.room_round_number = coalesce(new.arena_round_number, target_room.round_number, 1)
      group by answer.question_index
    ), scoreline as (
      select
        sum(own_win) over (order by question_index) as own_total,
        sum(opponent_win) over (order by question_index) as opponent_total
      from per_question
    )
    select coalesce(bool_or(opponent_total - own_total >= 2), false)
    into was_behind_by_two
    from scoreline;

    new.comeback_win := new.multiplayer_outcome = 'win' and was_behind_by_two;
  end if;

  new.opponents_defeated := case
    when new.multiplayer_outcome = 'win' then greatest(participant_count - 1, 0)
    when new.multiplayer_outcome = 'draw' then 0
    else greatest(participant_count - coalesce(new.placement, participant_count), 0)
  end;

  return new;
end;
$$;

drop trigger if exists derive_competitive_progression_on_quiz_result
  on public.quiz_results;
create trigger derive_competitive_progression_on_quiz_result
before insert or update on public.quiz_results
for each row execute function public.derive_competitive_progression();

revoke all on function public.derive_competitive_progression()
  from public, anon, authenticated;

-- Re-evaluate compatible historical room results. The update is idempotent and
-- leaves Solo rows and obsolete point-based multiplayer values untouched.
update public.quiz_results
set competitive_progression_eligible = competitive_progression_eligible
where arena_room_id is not null;

create or replace view public.multiplayer_career_stats as
with eligible as (
  select
    result.*,
    sum(case when result.multiplayer_outcome = 'win' then 0 else 1 end) over (
      partition by result.user_id order by result.played_at, result.id
    ) as streak_group,
    sum(case when result.multiplayer_outcome = 'win' then 0 else 1 end) over (
      partition by result.user_id order by result.played_at desc, result.id desc
    ) as reverse_streak_breaks
  from public.quiz_results result
  where result.competitive_progression_eligible
), streaks as (
  select user_id, streak_group, count(*)::integer as streak_length
  from eligible
  where multiplayer_outcome = 'win'
  group by user_id, streak_group
), aggregated as (
  select
    result.user_id,
    count(*)::integer as matches_played,
    count(*) filter (where result.multiplayer_outcome = 'win')::integer as wins,
    count(*) filter (where result.multiplayer_outcome = 'loss')::integer as losses,
    count(*) filter (where result.multiplayer_outcome = 'draw')::integer as draws,
    coalesce(round(
      count(*) filter (where result.multiplayer_outcome = 'win')::numeric /
      nullif(count(*), 0) * 100, 1
    ), 0) as win_percentage,
    coalesce(sum(result.rounds_won), 0)::integer as rounds_won,
    coalesce(sum(result.opponent_round_wins), 0)::integer as rounds_lost,
    coalesce(round(
      sum(result.rounds_won)::numeric /
      nullif(sum(result.rounds_won) + sum(result.opponent_round_wins), 0) * 100, 1
    ), 0) as round_win_percentage,
    count(*) filter (where result.clean_sheet)::integer as clean_sheets,
    coalesce(round(
      sum(result.average_winning_response_time * result.rounds_won)::numeric /
      nullif(sum(result.rounds_won), 0), 3
    ), 0) as average_winning_response_time,
    min(result.fastest_winning_response_time) filter (
      where result.fastest_winning_response_time > 0
    ) as fastest_winning_response_time,
    count(*) filter (where result.game_mode = 'duel')::integer as duel_matches,
    count(*) filter (
      where result.game_mode = 'duel' and result.multiplayer_outcome = 'win'
    )::integer as duel_wins,
    count(*) filter (where result.game_mode = 'group_lobby')::integer as group_matches,
    count(*) filter (
      where result.game_mode = 'group_lobby' and result.multiplayer_outcome = 'win'
    )::integer as group_wins,
    count(*) filter (where result.game_mode = 'party_mode')::integer as party_matches,
    count(*) filter (
      where result.game_mode = 'party_mode' and result.multiplayer_outcome = 'win'
    )::integer as party_wins,
    coalesce(sum(result.opponents_defeated), 0)::integer as opponents_defeated,
    count(*) filter (where result.comeback_win)::integer as comeback_wins,
    count(*) filter (where result.dominant_win)::integer as dominant_wins,
    count(*) filter (
      where result.multiplayer_outcome = 'win' and result.score_margin = 1
    )::integer as photo_finish_wins,
    count(*) filter (
      where result.fastest_winning_response_time > 0
        and result.fastest_winning_response_time < 2
    )::integer as quick_draws,
    count(*) filter (
      where result.fastest_winning_response_time > 0
        and result.fastest_winning_response_time < 1
    )::integer as lightning_wins,
    max(result.played_at) as last_played_at
  from eligible result
  group by result.user_id
), streak_summary as (
  select user_id, max(streak_length)::integer as best_win_streak
  from streaks
  group by user_id
), current_streak as (
  select
    user_id,
    count(*) filter (
      where multiplayer_outcome = 'win' and reverse_streak_breaks = 0
    )::integer as current_win_streak
  from eligible
  group by user_id
)
select
  aggregated.*,
  coalesce(current_streak.current_win_streak, 0)::integer as current_win_streak,
  coalesce(streak_summary.best_win_streak, 0)::integer as best_win_streak
from aggregated
left join current_streak using (user_id)
left join streak_summary using (user_id);

create or replace view public.public_multiplayer_career_stats as
select
  career.*,
  profile.username,
  coalesce(
    nullif(profile.display_name, ''),
    nullif(profile.username, ''),
    'Unknown Player'
  ) as player_name
from public.multiplayer_career_stats career
join public.profiles profile on profile.id = career.user_id
where profile.username is not null;

grant select on public.public_multiplayer_career_stats to anon, authenticated;

create or replace function public.get_multiplayer_leaderboard(
  category text,
  page_size integer default 10,
  page_offset integer default 0
)
returns table (
  rank bigint,
  user_id uuid,
  player_name text,
  username text,
  value numeric,
  matches_played integer,
  wins integer,
  rounds_won integer,
  is_current_user boolean,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with qualified as (
    select career.*
    from public.public_multiplayer_career_stats career
    where case
      when category = 'best_win_rate' then career.matches_played >= 5
      when category = 'fastest_players' then career.rounds_won >= 5
      else true
    end
  ), ranked as (
    select
      row_number() over (
        order by
          case when category = 'fastest_players' then average_winning_response_time end asc nulls last,
          case category
            when 'most_wins' then wins
            when 'best_win_rate' then win_percentage
            when 'longest_win_streak' then best_win_streak
            when 'most_clean_sheets' then clean_sheets
            when 'most_rounds_won' then rounds_won
            when 'duel_wins' then duel_wins
            when 'group_lobby_wins' then group_wins
            when 'matches_played' then matches_played
          end desc nulls last,
          wins desc,
          matches_played desc,
          user_id
      ) as rank,
      qualified.*,
      count(*) over () as total_count
    from qualified
    where category in (
      'most_wins', 'best_win_rate', 'fastest_players',
      'longest_win_streak', 'most_clean_sheets', 'most_rounds_won',
      'duel_wins', 'group_lobby_wins', 'matches_played'
    )
  ), selected as (
    select * from ranked
    where rank > greatest(page_offset, 0)
      and rank <= greatest(page_offset, 0) + least(greatest(page_size, 1), 50)
    union
    select * from ranked
    where user_id = auth.uid()
  )
  select
    selected.rank,
    selected.user_id,
    selected.player_name,
    selected.username,
    case category
      when 'most_wins' then selected.wins
      when 'best_win_rate' then selected.win_percentage
      when 'fastest_players' then selected.average_winning_response_time
      when 'longest_win_streak' then selected.best_win_streak
      when 'most_clean_sheets' then selected.clean_sheets
      when 'most_rounds_won' then selected.rounds_won
      when 'duel_wins' then selected.duel_wins
      when 'group_lobby_wins' then selected.group_wins
      when 'matches_played' then selected.matches_played
    end::numeric as value,
    selected.matches_played,
    selected.wins,
    selected.rounds_won,
    selected.user_id = auth.uid() as is_current_user,
    selected.total_count
  from selected
  order by selected.rank;
$$;

revoke all on function public.get_multiplayer_leaderboard(text, integer, integer)
  from public;
grant execute on function public.get_multiplayer_leaderboard(text, integer, integer)
  to anon, authenticated;

create or replace function public.get_multiplayer_leaderboard_summary(
  page_size integer default 10
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(categories.category, categories.entries), '{}'::jsonb)
  from (
    select
      requested.category,
      coalesce(jsonb_agg(to_jsonb(board) order by board.rank)
        filter (where board.user_id is not null), '[]'::jsonb) as entries
    from unnest(array[
      'most_wins', 'best_win_rate', 'fastest_players',
      'longest_win_streak', 'most_clean_sheets', 'most_rounds_won',
      'duel_wins', 'group_lobby_wins', 'matches_played'
    ]) requested(category)
    left join lateral public.get_multiplayer_leaderboard(
      requested.category, least(greatest(page_size, 1), 10), 0
    ) board on true
    group by requested.category
  ) categories;
$$;

revoke all on function public.get_multiplayer_leaderboard_summary(integer)
  from public;
grant execute on function public.get_multiplayer_leaderboard_summary(integer)
  to anon, authenticated;

-- Append the derived fields used by public profiles using display identity only.
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
  coalesce(ar.mode, qr.game_mode, 'single_player') as game_mode,
  qr.is_private,
  qr.is_winner,
  qr.was_host,
  qr.player_count,
  qr.placement,
  qr.score_margin,
  qr.result_status,
  qr.scoring_model,
  qr.round_points,
  qr.rounds_won,
  qr.rounds_played,
  qr.average_winning_response_time,
  qr.fastest_winning_response_time,
  qr.multiplayer_outcome,
  qr.competitive_progression_eligible,
  qr.clean_sheet,
  qr.opponent_round_wins,
  qr.opponents_defeated,
  qr.comeback_win,
  qr.dominant_win
from public.quiz_results qr
join public.profiles p on p.id = qr.user_id
left join public.arena_rooms ar on ar.id = qr.arena_room_id
where p.username is not null;

grant select on public.public_profile_recent_results to anon, authenticated;

commit;

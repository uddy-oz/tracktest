alter table public.profiles
  add column if not exists featured_badge_ids text[] not null default '{}';

drop view if exists public.public_profile_summary;
create or replace view public.public_profile_summary as
with quiz_summary as (
  select
    qr.user_id,
    count(*)::integer as total_quizzes_played,
    coalesce(sum(qr.correct_answers), 0)::integer as total_correct_answers,
    coalesce(sum(qr.total_questions), 0)::integer as total_questions_answered,
    coalesce(round((sum(qr.correct_answers)::numeric / nullif(sum(qr.total_questions), 0)) * 100), 0)::integer as overall_accuracy,
    coalesce(sum(qr.final_points), 0)::integer as total_points,
    coalesce(max(qr.final_points), 0)::integer as best_score,
    coalesce(
      sum(qr.average_answer_time * qr.total_questions) / nullif(sum(qr.total_questions), 0),
      0
    ) as average_answer_time,
    max(qr.played_at) as last_played_at
  from public.quiz_results qr
  group by qr.user_id
),
played_days as (
  select distinct
    qr.user_id,
    qr.played_at::date as played_day
  from public.quiz_results qr
),
streak_starts as (
  select
    qs.user_id,
    case
      when exists (
        select 1
        from played_days pd
        where pd.user_id = qs.user_id
          and pd.played_day = current_date
      ) then current_date
      when exists (
        select 1
        from played_days pd
        where pd.user_id = qs.user_id
          and pd.played_day = current_date - interval '1 day'
      ) then current_date - interval '1 day'
      else null
    end::date as streak_start
  from quiz_summary qs
),
daily_streaks as (
  select
    ss.user_id,
    case
      when ss.streak_start is null then 0
      else (
        select count(*)::integer
        from generate_series(ss.streak_start - interval '365 days', ss.streak_start, interval '1 day') as days(day)
        where exists (
          select 1
          from played_days pd
          where pd.user_id = ss.user_id
            and pd.played_day = days.day::date
        )
          and not exists (
            select 1
            from generate_series(days.day::date, ss.streak_start, interval '1 day') as required_days(required_day)
            where not exists (
              select 1
              from played_days pd
              where pd.user_id = ss.user_id
                and pd.played_day = required_days.required_day::date
            )
          )
      )
    end as current_daily_streak
  from streak_starts ss
)
select
  p.id as user_id,
  coalesce(nullif(p.display_name, ''), nullif(p.username, ''), 'Unknown Player') as display_name,
  p.username,
  p.featured_badge_ids,
  coalesce(qs.total_quizzes_played, 0) as total_quizzes_played,
  coalesce(qs.total_correct_answers, 0) as total_correct_answers,
  coalesce(qs.total_questions_answered, 0) as total_questions_answered,
  coalesce(qs.overall_accuracy, 0) as overall_accuracy,
  coalesce(qs.total_points, 0) as total_points,
  coalesce(qs.best_score, 0) as best_score,
  coalesce(qs.average_answer_time, 0) as average_answer_time,
  coalesce(ds.current_daily_streak, 0) as current_daily_streak,
  coalesce(qs.last_played_at::date::text, '') as last_played_date
from public.profiles p
left join quiz_summary qs on qs.user_id = p.id
left join daily_streaks ds on ds.user_id = p.id
where p.username is not null;

grant select on public.public_profile_summary to anon, authenticated;

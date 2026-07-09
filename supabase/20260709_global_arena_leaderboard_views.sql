create or replace view public.global_overall_points as
select
  qr.user_id,
  coalesce(nullif(p.display_name, ''), nullif(p.username, ''), 'Unknown Player') as player_name,
  p.username,
  sum(qr.final_points)::integer as total_points,
  count(*)::integer as quizzes_played,
  max(qr.final_points)::integer as best_score,
  round(avg(qr.accuracy), 1) as average_accuracy
from public.quiz_results qr
left join public.profiles p on p.id = qr.user_id
group by qr.user_id, p.display_name, p.username;

create or replace view public.global_best_accuracy as
select
  qr.user_id,
  coalesce(nullif(p.display_name, ''), nullif(p.username, ''), 'Unknown Player') as player_name,
  p.username,
  round((sum(qr.correct_answers)::numeric / nullif(sum(qr.total_questions), 0)) * 100, 1) as accuracy,
  sum(qr.total_questions)::integer as total_questions,
  count(*)::integer as quizzes_played,
  sum(qr.final_points)::integer as total_points
from public.quiz_results qr
left join public.profiles p on p.id = qr.user_id
group by qr.user_id, p.display_name, p.username
having count(*) >= 3 and sum(qr.total_questions) >= 20;

create or replace view public.global_album_scores as
select
  qr.user_id,
  coalesce(nullif(p.display_name, ''), nullif(p.username, ''), 'Unknown Player') as player_name,
  p.username,
  qr.album_name,
  qr.artist_name,
  max(qr.final_points)::integer as best_score,
  max(qr.accuracy) as best_accuracy,
  max(qr.played_at) as last_played_at
from public.quiz_results qr
left join public.profiles p on p.id = qr.user_id
group by qr.user_id, p.display_name, p.username, qr.album_name, qr.artist_name;

create or replace view public.global_artist_masters as
select
  ast.user_id,
  coalesce(nullif(p.display_name, ''), nullif(p.username, ''), 'Unknown Player') as player_name,
  p.username,
  ast.artist_name,
  ast.quizzes_played,
  ast.accuracy,
  ast.total_points,
  ast.best_score,
  ast.updated_at
from public.artist_stats ast
left join public.profiles p on p.id = ast.user_id;

create or replace view public.global_perfect_runs as
select
  qr.id,
  qr.user_id,
  coalesce(nullif(p.display_name, ''), nullif(p.username, ''), 'Unknown Player') as player_name,
  p.username,
  qr.album_name,
  qr.artist_name,
  qr.total_questions,
  qr.final_points,
  qr.played_at
from public.quiz_results qr
left join public.profiles p on p.id = qr.user_id
where qr.accuracy = 100;

grant select on public.global_overall_points to anon, authenticated;
grant select on public.global_best_accuracy to anon, authenticated;
grant select on public.global_album_scores to anon, authenticated;
grant select on public.global_artist_masters to anon, authenticated;
grant select on public.global_perfect_runs to anon, authenticated;

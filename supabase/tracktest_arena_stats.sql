create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quiz_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  album_name text not null,
  artist_name text not null,
  total_questions integer not null check (total_questions >= 0),
  correct_answers integer not null check (correct_answers >= 0),
  accuracy numeric not null check (accuracy >= 0 and accuracy <= 100),
  final_points integer not null check (final_points >= 0),
  average_answer_time numeric not null check (average_answer_time >= 0),
  played_at timestamptz not null default now()
);

create table if not exists public.artist_stats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  artist_name text not null,
  quizzes_played integer not null default 0 check (quizzes_played >= 0),
  correct_answers integer not null default 0 check (correct_answers >= 0),
  total_questions integer not null default 0 check (total_questions >= 0),
  accuracy numeric not null default 0 check (accuracy >= 0 and accuracy <= 100),
  total_points integer not null default 0 check (total_points >= 0),
  best_score integer not null default 0 check (best_score >= 0),
  average_answer_time numeric not null default 0 check (average_answer_time >= 0),
  updated_at timestamptz not null default now(),
  constraint artist_stats_user_artist_unique unique (user_id, artist_name)
);

create table if not exists public.album_stats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  album_name text not null,
  artist_name text not null,
  times_played integer not null default 0 check (times_played >= 0),
  best_score integer not null default 0 check (best_score >= 0),
  best_accuracy numeric not null default 0 check (best_accuracy >= 0 and best_accuracy <= 100),
  last_played_at timestamptz not null default now(),
  constraint album_stats_user_artist_album_unique unique (user_id, artist_name, album_name)
);

alter table public.profiles enable row level security;
alter table public.quiz_results enable row level security;
alter table public.artist_stats enable row level security;
alter table public.album_stats enable row level security;

drop policy if exists "Profiles are readable by owner" on public.profiles;
drop policy if exists "Profiles are insertable by owner" on public.profiles;
drop policy if exists "Profiles are updatable by owner" on public.profiles;
drop policy if exists "Quiz results are readable by owner" on public.quiz_results;
drop policy if exists "Quiz results are insertable by owner" on public.quiz_results;
drop policy if exists "Quiz results are updatable by owner" on public.quiz_results;
drop policy if exists "Artist stats are readable by owner" on public.artist_stats;
drop policy if exists "Artist stats are insertable by owner" on public.artist_stats;
drop policy if exists "Artist stats are updatable by owner" on public.artist_stats;
drop policy if exists "Album stats are readable by owner" on public.album_stats;
drop policy if exists "Album stats are insertable by owner" on public.album_stats;
drop policy if exists "Album stats are updatable by owner" on public.album_stats;

create policy "Profiles are readable by owner"
  on public.profiles
  for select
  using (auth.uid() = id);

create policy "Profiles are insertable by owner"
  on public.profiles
  for insert
  with check (auth.uid() = id);

create policy "Profiles are updatable by owner"
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Quiz results are readable by owner"
  on public.quiz_results
  for select
  using (auth.uid() = user_id);

create policy "Quiz results are insertable by owner"
  on public.quiz_results
  for insert
  with check (auth.uid() = user_id);

create policy "Quiz results are updatable by owner"
  on public.quiz_results
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Artist stats are readable by owner"
  on public.artist_stats
  for select
  using (auth.uid() = user_id);

create policy "Artist stats are insertable by owner"
  on public.artist_stats
  for insert
  with check (auth.uid() = user_id);

create policy "Artist stats are updatable by owner"
  on public.artist_stats
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Album stats are readable by owner"
  on public.album_stats
  for select
  using (auth.uid() = user_id);

create policy "Album stats are insertable by owner"
  on public.album_stats
  for insert
  with check (auth.uid() = user_id);

create policy "Album stats are updatable by owner"
  on public.album_stats
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists quiz_results_user_played_at_idx
  on public.quiz_results (user_id, played_at desc);

create index if not exists artist_stats_user_points_idx
  on public.artist_stats (user_id, total_points desc);

create index if not exists album_stats_user_best_score_idx
  on public.album_stats (user_id, best_score desc);

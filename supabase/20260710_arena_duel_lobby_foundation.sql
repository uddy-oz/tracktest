create extension if not exists pgcrypto;

create table if not exists public.arena_rooms (
  id uuid primary key default gen_random_uuid(),
  host_user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null default 'duel',
  status text not null default 'waiting',
  album_id text,
  album_name text,
  artist_name text,
  artwork_url text,
  max_players integer not null default 2 check (max_players > 0),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  constraint arena_rooms_mode_check
    check (mode in ('duel', 'group_lobby', 'party_mode', 'championship')),
  constraint arena_rooms_status_check
    check (status in ('waiting', 'starting', 'active', 'finished', 'cancelled'))
);

create table if not exists public.arena_room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.arena_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  username text,
  joined_at timestamptz not null default now(),
  final_score integer not null default 0 check (final_score >= 0),
  correct_answers integer not null default 0 check (correct_answers >= 0),
  total_questions integer not null default 0 check (total_questions >= 0),
  average_answer_time numeric not null default 0 check (average_answer_time >= 0),
  constraint arena_room_players_room_user_unique unique (room_id, user_id)
);

alter table public.arena_rooms enable row level security;
alter table public.arena_room_players enable row level security;

drop policy if exists "Authenticated users can create arena rooms" on public.arena_rooms;
drop policy if exists "Authenticated users can read waiting arena rooms" on public.arena_rooms;
drop policy if exists "Room hosts can read their arena rooms" on public.arena_rooms;
drop policy if exists "Room hosts can update their arena rooms" on public.arena_rooms;
drop policy if exists "Authenticated users can join arena rooms" on public.arena_room_players;
drop policy if exists "Authenticated users can read waiting room players" on public.arena_room_players;
drop policy if exists "Players can read their arena room player rows" on public.arena_room_players;

create policy "Authenticated users can create arena rooms"
  on public.arena_rooms
  for insert
  to authenticated
  with check (auth.uid() = host_user_id);

create policy "Authenticated users can read waiting arena rooms"
  on public.arena_rooms
  for select
  to authenticated
  using (status = 'waiting');

create policy "Room hosts can read their arena rooms"
  on public.arena_rooms
  for select
  to authenticated
  using (auth.uid() = host_user_id);

create policy "Room hosts can update their arena rooms"
  on public.arena_rooms
  for update
  to authenticated
  using (auth.uid() = host_user_id)
  with check (auth.uid() = host_user_id);

create policy "Authenticated users can join arena rooms"
  on public.arena_room_players
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.arena_rooms ar
      where ar.id = room_id
        and ar.status = 'waiting'
    )
  );

create policy "Authenticated users can read waiting room players"
  on public.arena_room_players
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.arena_rooms ar
      where ar.id = room_id
        and ar.status = 'waiting'
    )
  );

create policy "Players can read their arena room player rows"
  on public.arena_room_players
  for select
  to authenticated
  using (auth.uid() = user_id);

create index if not exists arena_rooms_status_idx
  on public.arena_rooms (status);

create index if not exists arena_rooms_mode_idx
  on public.arena_rooms (mode);

create index if not exists arena_rooms_created_at_idx
  on public.arena_rooms (created_at desc);

create index if not exists arena_rooms_mode_status_created_at_idx
  on public.arena_rooms (mode, status, created_at desc);

create index if not exists arena_room_players_room_id_idx
  on public.arena_room_players (room_id);

create index if not exists arena_room_players_user_id_idx
  on public.arena_room_players (user_id);

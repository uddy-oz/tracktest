alter table public.arena_rooms
  add column if not exists quiz_questions jsonb not null default '[]'::jsonb;

alter table public.arena_room_players
  add column if not exists is_ready boolean not null default false,
  add column if not exists finished_at timestamptz;

drop policy if exists "Room players can update joined arena rooms" on public.arena_rooms;
drop policy if exists "Room players can read joined arena rooms" on public.arena_rooms;
drop policy if exists "Authenticated users can read arena room players" on public.arena_room_players;
drop policy if exists "Players can update their arena room player rows" on public.arena_room_players;

create policy "Room players can read joined arena rooms"
  on public.arena_rooms
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.arena_room_players arp
      where arp.room_id = arena_rooms.id
        and arp.user_id = auth.uid()
    )
  );

create policy "Room players can update joined arena rooms"
  on public.arena_rooms
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.arena_room_players arp
      where arp.room_id = arena_rooms.id
        and arp.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.arena_room_players arp
      where arp.room_id = arena_rooms.id
        and arp.user_id = auth.uid()
    )
  );

create policy "Authenticated users can read arena room players"
  on public.arena_room_players
  for select
  to authenticated
  using (true);

create policy "Players can update their arena room player rows"
  on public.arena_room_players
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists arena_room_players_room_ready_idx
  on public.arena_room_players (room_id, is_ready);

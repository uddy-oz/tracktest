create or replace function public.is_arena_room_player(
  target_room_id uuid,
  target_user_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.arena_room_players arp
    where arp.room_id = target_room_id
      and arp.user_id = target_user_id
  );
$$;

create or replace function public.is_arena_room_waiting(target_room_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.arena_rooms ar
    where ar.id = target_room_id
      and ar.status = 'waiting'
  );
$$;

alter table public.arena_rooms enable row level security;
alter table public.arena_room_players enable row level security;

drop policy if exists "Authenticated users can create arena rooms" on public.arena_rooms;
drop policy if exists "Authenticated users can read waiting arena rooms" on public.arena_rooms;
drop policy if exists "Room hosts can read their arena rooms" on public.arena_rooms;
drop policy if exists "Room players can read joined arena rooms" on public.arena_rooms;
drop policy if exists "Room hosts can update their arena rooms" on public.arena_rooms;
drop policy if exists "Room players can update joined arena rooms" on public.arena_rooms;

drop policy if exists "Authenticated users can join arena rooms" on public.arena_room_players;
drop policy if exists "Authenticated users can read waiting room players" on public.arena_room_players;
drop policy if exists "Authenticated users can read arena room players" on public.arena_room_players;
drop policy if exists "Players can read their arena room player rows" on public.arena_room_players;
drop policy if exists "Players can update their arena room player rows" on public.arena_room_players;

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

create policy "Room players can read joined arena rooms"
  on public.arena_rooms
  for select
  to authenticated
  using (public.is_arena_room_player(id, auth.uid()));

create policy "Room hosts can update their arena rooms"
  on public.arena_rooms
  for update
  to authenticated
  using (auth.uid() = host_user_id)
  with check (auth.uid() = host_user_id);

-- Duel MVP: either joined player may start/finish the room after both players
-- are ready. Membership is checked through a security definer helper to avoid
-- arena_rooms <-> arena_room_players policy recursion.
create policy "Room players can update joined arena rooms"
  on public.arena_rooms
  for update
  to authenticated
  using (public.is_arena_room_player(id, auth.uid()))
  with check (public.is_arena_room_player(id, auth.uid()));

create policy "Authenticated users can join arena rooms"
  on public.arena_room_players
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and public.is_arena_room_waiting(room_id)
  );

-- Player rows contain display names/usernames and Duel scores only, not email.
-- Keeping these readable to authenticated users avoids recursive room lookups
-- while still supporting open-room player counts and Duel result screens.
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

grant execute on function public.is_arena_room_player(uuid, uuid) to authenticated;
grant execute on function public.is_arena_room_waiting(uuid) to authenticated;

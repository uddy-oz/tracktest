-- Make the Party Mode host authoritative for per-question audio availability.
-- Run after 20260721_unified_progression_and_multiplayer_badges.sql.

alter table public.arena_rooms
  add column if not exists party_audio_question_index integer,
  add column if not exists party_audio_status text not null default 'idle',
  add column if not exists party_audio_updated_at timestamptz;

alter table public.arena_rooms
  drop constraint if exists arena_rooms_party_audio_status_check;

alter table public.arena_rooms
  add constraint arena_rooms_party_audio_status_check
  check (party_audio_status in ('idle', 'pending', 'playing', 'skipped'));

create or replace function public.prepare_party_audio_state()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.mode <> 'party_mode' then
    new.party_audio_question_index := null;
    new.party_audio_status := 'idle';
    new.party_audio_updated_at := null;
    return new;
  end if;

  if new.status = 'active'
    and (
      old.status is distinct from new.status
      or old.round_number is distinct from new.round_number
    )
  then
    new.party_audio_question_index := 0;
    new.party_audio_status := 'pending';
    new.party_audio_updated_at := now();
  elsif new.status in ('waiting', 'finished', 'cancelled')
    and old.status is distinct from new.status
  then
    new.party_audio_question_index := null;
    new.party_audio_status := 'idle';
    new.party_audio_updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists arena_rooms_prepare_party_audio on public.arena_rooms;
create trigger arena_rooms_prepare_party_audio
  before update of status, round_number on public.arena_rooms
  for each row
  execute function public.prepare_party_audio_state();

create or replace function public.set_party_audio_state(
  target_room_id uuid,
  target_round_number integer,
  target_question_index integer,
  target_status text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_room public.arena_rooms%rowtype;
  question_total integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if target_status not in ('pending', 'playing', 'skipped') then
    raise exception 'Invalid Party audio state.';
  end if;

  select *
  into target_room
  from public.arena_rooms
  where id = target_room_id
    and mode = 'party_mode'
    and status = 'active'
    and host_user_id = auth.uid()
    and round_number = target_round_number
  for update;

  if target_room.id is null then
    raise exception 'Only the active Party host can control room audio.';
  end if;

  question_total := coalesce(jsonb_array_length(target_room.quiz_questions), 0);

  if target_question_index < 0 or target_question_index >= question_total then
    raise exception 'Invalid Party question index.';
  end if;

  if target_status = 'pending'
    and target_room.party_audio_question_index is not null
    and (
      target_question_index < target_room.party_audio_question_index
      or (
        target_question_index = target_room.party_audio_question_index
        and target_room.party_audio_status <> 'pending'
      )
    )
  then
    raise exception 'Party audio cannot move backwards.';
  end if;

  if target_status = 'playing'
    and (
      target_room.party_audio_question_index is distinct from target_question_index
      or target_room.party_audio_status not in ('pending', 'playing')
    )
  then
    raise exception 'This Party question is not waiting for host audio.';
  end if;

  if target_status = 'skipped'
    and (
      target_room.party_audio_question_index is distinct from target_question_index
      or target_room.party_audio_status not in ('pending', 'playing', 'skipped')
    )
  then
    raise exception 'This Party question cannot be skipped.';
  end if;

  update public.arena_rooms
  set
    party_audio_question_index = target_question_index,
    party_audio_status = target_status,
    party_audio_updated_at = now()
  where id = target_room_id;

  return true;
end;
$$;

revoke all on function public.set_party_audio_state(uuid, integer, integer, text)
  from public, anon;
grant execute on function public.set_party_audio_state(uuid, integer, integer, text)
  to authenticated;

-- Realtime delivers the host audio state quickly. Existing polling remains a
-- fallback when a browser or network cannot maintain the subscription.
do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'arena_rooms'
  ) then
    alter publication supabase_realtime add table public.arena_rooms;
  end if;
end;
$$;

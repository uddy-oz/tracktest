begin;

-- Anonymous Auth users may participate in secured Arena rooms, but permanent
-- progression must only belong to registered accounts.
create or replace function public.block_anonymous_progression_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) or exists (
    select 1 from auth.users au
    where au.id = new.user_id and coalesce(au.is_anonymous, false)
  ) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists block_anonymous_quiz_results on public.quiz_results;
create trigger block_anonymous_quiz_results
before insert or update on public.quiz_results
for each row execute function public.block_anonymous_progression_write();

drop trigger if exists block_anonymous_artist_stats on public.artist_stats;
create trigger block_anonymous_artist_stats
before insert or update on public.artist_stats
for each row execute function public.block_anonymous_progression_write();

drop trigger if exists block_anonymous_album_stats on public.album_stats;
create trigger block_anonymous_album_stats
before insert or update on public.album_stats
for each row execute function public.block_anonymous_progression_write();

revoke all on function public.block_anonymous_progression_write()
  from public, anon, authenticated;

create or replace function public.reset_my_stanzer_progress()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
begin
  if current_user_id is null then
    raise exception 'Authentication is required.';
  end if;

  if exists (
    select 1
    from auth.users au
    where au.id = current_user_id and coalesce(au.is_anonymous, false)
  ) then
    raise exception 'Guest sessions do not have permanent progress to reset.';
  end if;

  if exists (
    select 1
    from public.arena_room_players arp
    join public.arena_rooms ar on ar.id = arp.room_id
    where arp.user_id = current_user_id
      and arp.left_at is null
      and ar.status in ('waiting', 'starting', 'active')
      and coalesce(arp.result_status, 'active') not in ('cancelled', 'left')
  ) then
    raise exception 'Leave or finish your active Arena room before resetting progress.';
  end if;

  delete from public.artist_stats where user_id = current_user_id;
  delete from public.album_stats where user_id = current_user_id;
  delete from public.quiz_results where user_id = current_user_id;

  delete from public.arena_party_answers where user_id = current_user_id;
  delete from public.arena_competitive_answers where user_id = current_user_id;
  delete from public.arena_competitive_audio_readiness
  where user_id = current_user_id;

  delete from public.arena_room_players arp
  using public.arena_rooms ar
  where arp.room_id = ar.id
    and arp.user_id = current_user_id
    and ar.status not in ('waiting', 'starting', 'active');

  update public.profiles
  set featured_badge_ids = '{}'::text[], updated_at = clock_timestamp()
  where id = current_user_id;

  return true;
end;
$$;

revoke all on function public.reset_my_stanzer_progress()
  from public, anon;
grant execute on function public.reset_my_stanzer_progress()
  to authenticated;

-- Intended for a trusted scheduled job/service role only. Supabase Anonymous
-- Sign-Ins should also be protected with CAPTCHA/Turnstile in Auth settings.
create or replace function public.cleanup_stale_stanzer_guests(
  max_guest_age interval default interval '7 days'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  delete from auth.users au
  where coalesce(au.is_anonymous, false)
    and coalesce(au.last_sign_in_at, au.created_at) < clock_timestamp() - max_guest_age
    and not exists (
      select 1
      from public.arena_room_players arp
      join public.arena_rooms ar on ar.id = arp.room_id
      where arp.user_id = au.id
        and arp.left_at is null
        and ar.status in ('waiting', 'starting', 'active')
    );

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_stale_stanzer_guests(interval)
  from public, anon, authenticated;
grant execute on function public.cleanup_stale_stanzer_guests(interval)
  to service_role;

commit;

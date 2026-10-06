begin;

-- Later competitive rounds used to inherit a 12-second readiness window from
-- sync_competitive_arena_timeline. Client preparation is already bounded and
-- reserve questions are available, so keeping a silent/disconnected player in
-- preparing_audio for that long only adds dead time. Clamp every newly staged
-- Duel/Group round to four seconds without changing countdown, scoring, Party
-- Mode, or the existing authoritative timeline function.
create or replace function public.clamp_competitive_audio_ready_deadline()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  maximum_deadline timestamptz := clock_timestamp() + interval '4 seconds';
begin
  if new.mode in ('duel', 'group_lobby')
    and new.status = 'active'
    and new.competitive_round_phase = 'preparing_audio'
    and (
      old.competitive_round_id is distinct from new.competitive_round_id
      or old.competitive_round_phase is distinct from new.competitive_round_phase
    )
  then
    new.competitive_audio_ready_deadline_at := least(
      coalesce(new.competitive_audio_ready_deadline_at, maximum_deadline),
      maximum_deadline
    );
  end if;

  return new;
end;
$$;

drop trigger if exists clamp_competitive_audio_ready_deadline
  on public.arena_rooms;
create trigger clamp_competitive_audio_ready_deadline
before update of
  competitive_round_id,
  competitive_round_phase,
  competitive_audio_ready_deadline_at
on public.arena_rooms
for each row execute function public.clamp_competitive_audio_ready_deadline();

revoke all on function public.clamp_competitive_audio_ready_deadline()
  from public, anon, authenticated;

commit;

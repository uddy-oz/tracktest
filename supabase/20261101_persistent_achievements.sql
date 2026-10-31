begin;

-- Isolated testing only until separately approved. No historical result rewrite.
create table if not exists arena_private.achievement_catalog (
 badge_id text primary key
);
insert into arena_private.achievement_catalog values ('first-track'),('perfect-run'),('flawless-album'),('quick-hands'),('speed-demon'),('accuracy-specialist'),('perfect-five'),('album-scholar'),('untouchable'),('album-demon'),('replay-king'),('album-collector'),('fifty-questions'),('hundred-question-club'),('five-hundred-questions'),('one-thousand-questions'),('artist-master'),('discography-demon'),('deep-discography'),('five-artist-club'),('ten-artist-club'),('album-specialist'),('three-day-listener'),('seven-day-locked-in'),('thirty-day-arena-regular'),('fourteen-day-music-run'),('hundred-day-legend'),('first-blood'),('rival'),('contender'),('arena-veteran'),('arena-legend'),('clean-sheet'),('lockdown'),('multiplayer-untouchable'),('hot-hand'),('on-fire-multiplayer'),('unstoppable'),('quick-draw'),('lightning'),('photo-finish'),('comeback'),('dominant'),('back-to-back-champion'),('three-peat'),('arena-dynasty'),('first-1v1-win'),('close-call'),('dominant-duel'),('first-lobby-win'),('lobby-sweeper'),('party-starter'),('room-controller'),('private-challenger'),('open-arena'),('championship-winner'),('clutch-player'),('comeback-king') on conflict do nothing;
revoke all on arena_private.achievement_catalog from public, anon, authenticated;

create table if not exists public.player_achievements (
 user_id uuid not null references auth.users(id) on delete cascade,
 badge_id text not null references arena_private.achievement_catalog(badge_id),
 definition_version integer not null default 1 check(definition_version=1),
 provenance text not null check(provenance in ('server_verified','legacy_preserved')),
 awarded_at timestamptz,
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(user_id,badge_id),
 check ((provenance='server_verified' and awarded_at is not null)
     or (provenance='legacy_preserved' and awarded_at is null))
);
alter table public.player_achievements enable row level security;
revoke all on public.player_achievements from public, anon, authenticated;
grant select(user_id,badge_id,definition_version,provenance,awarded_at) on public.player_achievements to anon, authenticated;
drop policy if exists public_badge_collection on public.player_achievements;
create policy public_badge_collection on public.player_achievements for select to anon, authenticated using(true);

create table if not exists arena_private.achievement_result_evidence (
 result_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 room_id uuid not null,
 round_number integer not null,
 occurred_at timestamptz not null default clock_timestamp(),
 payload jsonb not null,
 unique(user_id,room_id,round_number)
);
create table if not exists arena_private.achievement_host_events (
 room_id uuid not null,
 round_number integer not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 occurred_at timestamptz not null default clock_timestamp(),
 primary key(room_id,round_number)
);
revoke all on arena_private.achievement_result_evidence, arena_private.achievement_host_events from public, anon, authenticated;
alter table arena_private.achievement_result_evidence enable row level security;
alter table arena_private.achievement_host_events enable row level security;

create or replace function arena_private.award_achievement(p_user uuid,p_badge text)
returns void language sql security definer set search_path='' as $$
 insert into public.player_achievements(user_id,badge_id,provenance,awarded_at)
 select p_user,p_badge,'server_verified',clock_timestamp()
 where exists(select 1 from auth.users u where u.id=p_user and not coalesce(u.is_anonymous,false))
 on conflict(user_id,badge_id) do update
 set provenance='server_verified',awarded_at=excluded.awarded_at
 where player_achievements.provenance='legacy_preserved';
$$;
revoke all on function arena_private.award_achievement(uuid,text) from public,anon,authenticated;

create or replace function arena_private.evaluate_achievements(p_user uuid)
returns void language plpgsql security definer set search_path='' as $$
declare p jsonb; requirement record; streak integer; daily_best integer;
begin
 if not exists(select 1 from auth.users u where u.id=p_user and not coalesce(u.is_anonymous,false)) then return; end if;
 -- Only new, server-captured evidence is used. Old client-reported history is not backfilled.
 with e as (select payload,coalesce((payload->>'is_winner')::boolean,false) as won
 from arena_private.achievement_result_evidence where user_id=p_user)
 select jsonb_build_object(
 'wins',count(*) filter(where won),
 'clean',count(*) filter(where coalesce((payload->>'clean_sheet')::boolean,false)),
 'quick',count(*) filter(where (payload->>'fastest_winning_response_time')::numeric>0 and (payload->>'fastest_winning_response_time')::numeric<2),
 'lightning',count(*) filter(where (payload->>'fastest_winning_response_time')::numeric>0 and (payload->>'fastest_winning_response_time')::numeric<1),
 'photo',count(*) filter(where won and (payload->>'score_margin')::numeric=1),
 'comeback',count(*) filter(where coalesce((payload->>'comeback_win')::boolean,false)),
 'dominant',count(*) filter(where coalesce((payload->>'dominant_win')::boolean,false)),
 'duel',count(*) filter(where won and payload->>'game_mode'='duel'),
 'close',count(*) filter(where won and payload->>'game_mode'='duel' and
   ((payload->>'scoring_model'='round_points' and (payload->>'score_margin')::numeric=1)
   or (payload->>'scoring_model'<>'round_points' and (payload->>'score_margin')::numeric>0 and (payload->>'score_margin')::numeric<=500))),
 'dominant_duel',count(*) filter(where won and payload->>'game_mode'='duel' and coalesce((payload->>'dominant_win')::boolean,false)),
 'lobby',count(*) filter(where won and payload->>'game_mode'='group_lobby'),
 'full_lobby',count(*) filter(where won and payload->>'game_mode'='group_lobby' and (payload->>'player_count')::integer>=10),
 'party_players',coalesce(max((payload->>'player_count')::integer) filter(where payload->>'game_mode'='party_mode'),0),
 'private',count(*) filter(where coalesce((payload->>'is_private')::boolean,false)),
 'public',count(*) filter(where not coalesce((payload->>'is_private')::boolean,false))
 ) into p from e;
 with e as (select *,sum(case when coalesce((payload->>'is_winner')::boolean,false) then 0 else 1 end)
 over(order by occurred_at,result_id) as run from arena_private.achievement_result_evidence where user_id=p_user),
 runs as (select count(*) as n from e where coalesce((payload->>'is_winner')::boolean,false) group by run)
 select coalesce(max(n),0)::integer into streak from runs;
 with days as (select distinct (occurred_at at time zone 'UTC')::date as d from arena_private.achievement_result_evidence where user_id=p_user),
 groups as (select d,d-row_number() over(order by d)::integer as grp from days),
 runs as (select count(*) as n from groups group by grp)
 select coalesce(max(n),0)::integer into daily_best from runs;
 p:=p||jsonb_build_object('streak',streak,'days',daily_best);
 for requirement in select * from (values
 ('first-blood','wins',1),('rival','wins',5),('contender','wins',10),('arena-veteran','wins',25),('arena-legend','wins',50),
 ('clean-sheet','clean',1),('lockdown','clean',5),('multiplayer-untouchable','clean',10),
 ('hot-hand','streak',3),('on-fire-multiplayer','streak',5),('unstoppable','streak',10),
 ('back-to-back-champion','streak',2),('three-peat','streak',3),('arena-dynasty','streak',5),
 ('quick-draw','quick',1),('lightning','lightning',1),('photo-finish','photo',1),('comeback','comeback',1),('dominant','dominant',1),
 ('first-1v1-win','duel',1),('close-call','close',1),('dominant-duel','dominant_duel',1),
 ('first-lobby-win','lobby',1),('lobby-sweeper','full_lobby',1),('room-controller','party_players',10),
 ('private-challenger','private',1),('open-arena','public',1),
 ('three-day-listener','days',3),('seven-day-locked-in','days',7),('fourteen-day-music-run','days',14),
 ('thirty-day-arena-regular','days',30),('hundred-day-legend','days',100)
 ) r(badge_id,field,threshold) loop
 if coalesce((p->>requirement.field)::numeric,0)>=requirement.threshold then
 perform arena_private.award_achievement(p_user,requirement.badge_id); end if;
 end loop;
end;
$$;
revoke all on function arena_private.evaluate_achievements(uuid) from public,anon,authenticated;

create or replace function arena_private.capture_achievement_result()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.arena_room_id is null or not coalesce(new.competitive_progression_eligible,false)
 or coalesce(new.result_status,'')<>'completed' or new.total_questions<=0
 or new.game_mode not in ('duel','group_lobby','party_mode')
 or (new.game_mode in ('duel','group_lobby') and (new.scoring_model<>'round_points' or new.rounds_played<=0))
 or not exists(select 1 from auth.users u where u.id=new.user_id and not coalesce(u.is_anonymous,false))
 then return new; end if;
 insert into arena_private.achievement_result_evidence(result_id,user_id,room_id,round_number,payload)
 values(new.id,new.user_id,new.arena_room_id,new.arena_round_number,to_jsonb(new)) on conflict do nothing;
 perform arena_private.evaluate_achievements(new.user_id);
 return new;
end;
$$;
revoke all on function arena_private.capture_achievement_result() from public,anon,authenticated;
drop trigger if exists capture_achievement_result on public.quiz_results;
create trigger capture_achievement_result after insert on public.quiz_results for each row execute function arena_private.capture_achievement_result();

create or replace function arena_private.capture_party_host_achievement()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.mode<>'party_mode' or old.status<>'active' or new.status<>'finished'
 or new.party_question_phase<>'finished' or jsonb_array_length(coalesce(new.quiz_questions,'[]'))=0
 or new.party_question_index<jsonb_array_length(new.quiz_questions)-1
 or not exists(select 1 from auth.users u where u.id=new.host_user_id and not coalesce(u.is_anonymous,false))
 or not exists(select 1 from public.arena_party_answers a
  join public.arena_room_players p on p.room_id=a.room_id and p.user_id=a.user_id
  where a.room_id=new.id and a.round_number=new.round_number and a.user_id<>new.host_user_id
  and p.left_at is null and coalesce(p.result_status,'active') not in ('forfeit','left','cancelled'))
 then return new; end if;
 insert into arena_private.achievement_host_events(room_id,round_number,user_id) values(new.id,new.round_number,new.host_user_id) on conflict do nothing;
 perform arena_private.award_achievement(new.host_user_id,'party-starter');
 return new;
end;
$$;
revoke all on function arena_private.capture_party_host_achievement() from public,anon,authenticated;
drop trigger if exists capture_party_host_achievement on public.arena_rooms;
create trigger capture_party_host_achievement after update of status on public.arena_rooms for each row execute function arena_private.capture_party_host_achievement();

-- Preserve existing featured claims without pretending they are verified awards.
-- One-time seed, not a broad speculative historical badge backfill.
create table if not exists arena_private.achievement_installations(version integer primary key,installed_at timestamptz not null default clock_timestamp());
revoke all on arena_private.achievement_installations from public,anon,authenticated;
do $$
begin
 if not exists(select 1 from arena_private.achievement_installations where version=1) then
 insert into public.player_achievements(user_id,badge_id,provenance,awarded_at)
 select p.id,b.badge_id,'legacy_preserved',null from public.profiles p
 join auth.users u on u.id=p.id and not coalesce(u.is_anonymous,false)
 cross join lateral unnest(p.featured_badge_ids) selected(badge_id)
 join arena_private.achievement_catalog b on b.badge_id=selected.badge_id
 on conflict do nothing;
 insert into arena_private.achievement_installations(version) values(1);
 end if;
end $$;

create or replace function public.get_achievement_state(target_user_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('schemaVersion',1,'userId',target_user_id,'records',coalesce(jsonb_agg(jsonb_build_object(
 'badgeId',badge_id,'awardedAt',awarded_at,'provenance',provenance) order by awarded_at desc nulls last,badge_id),'[]'::jsonb))
 from public.player_achievements where user_id=target_user_id;
$$;
revoke all on function public.get_achievement_state(uuid) from public,anon,authenticated;
grant execute on function public.get_achievement_state(uuid) to anon,authenticated;
-- Repairs a missed aggregate threshold after reconnect/concurrent result commits.
-- There is no client-supplied badge, score, time or target identity.
create or replace function public.sync_my_achievements()
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid();
begin
 if caller is null or not exists(select 1 from auth.users where id=caller and not coalesce(is_anonymous,false)) then
 raise exception 'A registered account is required.' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text, 724011));
 perform arena_private.evaluate_achievements(caller);
 return public.get_achievement_state(caller);
end;
$$;
revoke all on function public.sync_my_achievements() from public,anon,authenticated;
grant execute on function public.sync_my_achievements() to authenticated;
notify pgrst,'reload schema';
commit;


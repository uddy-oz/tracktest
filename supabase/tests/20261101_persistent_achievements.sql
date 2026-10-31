-- ISOLATED clone only. Privileged fixtures model authoritative database results;
-- authenticated-role assertions exercise the public permission boundary.
begin;
update arena_private.runtime_controls set enabled=false where control_name='multiplayer_maintenance';
insert into auth.users(id,aud,role,email,is_anonymous) values
('91000000-0000-4000-8000-000000000001','authenticated','authenticated','award-host@example.invalid',false),
('91000000-0000-4000-8000-000000000002','authenticated','authenticated','award-player@example.invalid',false),
('91000000-0000-4000-8000-000000000003','authenticated','authenticated',null,true);

do $$ begin
 if has_table_privilege('authenticated','public.player_achievements','insert')
 or has_table_privilege('authenticated','public.player_achievements','update')
 or has_table_privilege('anon','public.player_achievements','delete')
 or has_function_privilege('authenticated','arena_private.award_achievement(uuid,text)','execute')
 or has_function_privilege('service_role','arena_private.evaluate_achievements(uuid)','execute') then
 raise exception 'Untrusted award mutation privilege'; end if;
end $$;

-- Actual result-creation trigger, with room/member/server-answer fixtures.
insert into public.arena_rooms(id,host_user_id,mode,status,album_id,album_name,max_players,round_number)
values('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','duel','waiting','fixture','Award fixture',2,1);
insert into public.arena_room_players(room_id,user_id,display_name,lobby_ready)
values('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','Host',true),
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','Player',true);
update public.arena_rooms set status='active',quiz_questions='[{},{},{},{},{}]' where id='92000000-0000-4000-8000-000000000001';
update public.arena_room_players set result_status='completed',finished_at=clock_timestamp(),total_questions=5,rounds_played=5,
final_score=case when display_name='Host' then 5 else 0 end,round_points=case when display_name='Host' then 5 else 0 end,
rounds_won=case when display_name='Host' then 5 else 0 end,correct_answers=case when display_name='Host' then 5 else 0 end
where room_id='92000000-0000-4000-8000-000000000001';
insert into public.arena_competitive_answers(room_id,room_round_number,round_id,question_index,user_id,is_correct,is_round_winner,response_time_ms)
select '92000000-0000-4000-8000-000000000001',1,md5('award-round-'||n)::uuid,n,'91000000-0000-4000-8000-000000000001',true,true,500 from generate_series(0,4) n;
update public.arena_rooms set status='finished',finished_at=clock_timestamp() where id='92000000-0000-4000-8000-000000000001';
do $$ declare first_date timestamptz; begin
 if not exists(select 1 from public.player_achievements where user_id='91000000-0000-4000-8000-000000000001' and badge_id='first-1v1-win' and awarded_at is not null) then raise exception 'Real result trigger failed to award'; end if;
 select awarded_at into first_date from public.player_achievements where user_id='91000000-0000-4000-8000-000000000001' and badge_id='first-1v1-win';
 perform public.sync_arena_progression_for_room('92000000-0000-4000-8000-000000000001');
 perform arena_private.evaluate_achievements('91000000-0000-4000-8000-000000000001');
 if (select count(*) from arena_private.achievement_result_evidence where room_id='92000000-0000-4000-8000-000000000001')<>2 then raise exception 'Duplicate result evidence'; end if;
 if first_date<>(select awarded_at from public.player_achievements where user_id='91000000-0000-4000-8000-000000000001' and badge_id='first-1v1-win') then raise exception 'Award timestamp overwritten'; end if;
end $$;

-- Party host evidence must come from a real finish, not merely hosting/opening/leaving.
insert into public.arena_rooms(id,host_user_id,mode,status,album_id,album_name,max_players,round_number)
values('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001','party_mode','waiting','fixture','Party fixture',30,1);
insert into public.arena_room_players(room_id,user_id,display_name)
values('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001','Host'),
('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002','Player');
update public.arena_rooms set status='active',quiz_questions='[{}]',party_question_index=0 where id='92000000-0000-4000-8000-000000000002';
do $$ begin
 if exists(select 1 from public.player_achievements where user_id='91000000-0000-4000-8000-000000000001' and badge_id='party-starter') then raise exception 'Awarded for room creation'; end if;
end $$;
insert into public.arena_party_answers(room_id,round_number,question_index,user_id,is_correct,points)
values('92000000-0000-4000-8000-000000000002',1,0,'91000000-0000-4000-8000-000000000002',true,500);
update public.arena_room_players set total_questions=1,correct_answers=1,final_score=500,result_status='completed',finished_at=clock_timestamp()
where room_id='92000000-0000-4000-8000-000000000002' and user_id='91000000-0000-4000-8000-000000000002';
update public.arena_rooms set status='finished',party_question_phase='finished',finished_at=clock_timestamp() where id='92000000-0000-4000-8000-000000000002';
do $$ begin
 if not exists(select 1 from public.player_achievements where user_id='91000000-0000-4000-8000-000000000001' and badge_id='party-starter') then raise exception 'Trusted Party completion did not award host'; end if;
 perform arena_private.award_achievement('91000000-0000-4000-8000-000000000003','first-blood');
 if exists(select 1 from public.player_achievements where user_id='91000000-0000-4000-8000-000000000003') then raise exception 'Guest received permanent award'; end if;
end $$;

-- Privileged attendance fixtures exercise UTC history grouping, not browser claims.
insert into arena_private.achievement_result_evidence(result_id,user_id,room_id,round_number,occurred_at,payload)
select md5('badge-day-result-'||n)::uuid,'91000000-0000-4000-8000-000000000001',md5('badge-day-room-'||n)::uuid,1,
clock_timestamp()-n*interval '1 day',payload from generate_series(1,2) n
cross join lateral (select payload from arena_private.achievement_result_evidence where user_id='91000000-0000-4000-8000-000000000001' limit 1) original;
select arena_private.evaluate_achievements('91000000-0000-4000-8000-000000000001');
do $$ begin
 if not exists(select 1 from public.player_achievements where user_id='91000000-0000-4000-8000-000000000001' and badge_id='three-day-listener') then raise exception 'Verified UTC attendance milestone missing'; end if;
end $$;
savepoint retention_test;
delete from arena_private.achievement_result_evidence where user_id='91000000-0000-4000-8000-000000000001';
select arena_private.evaluate_achievements('91000000-0000-4000-8000-000000000001');
do $$ begin
 if not exists(select 1 from public.player_achievements where user_id='91000000-0000-4000-8000-000000000001' and badge_id='three-day-listener') then raise exception 'Award relocked after evidence/history disappeared'; end if;
end $$;
rollback to savepoint retention_test;

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
select public.sync_my_achievements();
select public.sync_my_achievements();
do $$ begin
 begin
 insert into public.player_achievements(user_id,badge_id,provenance,awarded_at) values(auth.uid(),'rival','server_verified',clock_timestamp());
 raise exception 'Client forged an award'; exception when insufficient_privilege then null; end;
 if jsonb_array_length(public.get_achievement_state(auth.uid())->'records')=0 then raise exception 'Cloud RPC cannot read awards'; end if;
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000003',true);
do $$ begin
 begin perform public.sync_my_achievements(); raise exception 'Guest refreshed permanent awards'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
select public.get_achievement_state('91000000-0000-4000-8000-000000000001');
reset role;
rollback;

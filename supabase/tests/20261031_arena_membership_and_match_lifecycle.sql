-- Isolated database only. Synthetic identities/questions; every write rolls back.
begin;
update arena_private.runtime_controls set enabled=false where control_name='multiplayer_maintenance';
insert into auth.users(id,aud,role,email,is_anonymous) values
('31000000-0000-4000-8000-000000000001','authenticated','authenticated','lifecycle-host@example.invalid',false),
('31000000-0000-4000-8000-000000000002','authenticated','authenticated',null,true);

set local role authenticated;
select set_config('request.jwt.claim.sub','31000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000001","is_anonymous":false,"role":"authenticated"}',true);
select set_config('test.room',public.create_arena_room('duel','itunes:US:1499378108','Test album','Test artist','',2,false,'Host',null)::text,true);
select public.set_arena_lobby_ready(current_setting('test.room')::uuid,true);
select set_config('request.jwt.claim.sub','31000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000002","is_anonymous":true,"role":"authenticated"}',true);
select public.join_public_arena_room(current_setting('test.room')::uuid,'Guest',null);
select public.set_arena_lobby_ready(current_setting('test.room')::uuid,true);
do $$ begin
  begin
    perform public.change_waiting_arena_album(current_setting('test.room')::uuid,'itunes:US:1','Forged',null,null);
    raise exception 'nonhost album change unexpectedly succeeded';
  exception when raise_exception then
    if sqlerrm='nonhost album change unexpectedly succeeded' then raise; end if;
  end;
  begin
    update public.arena_room_players set final_score=999 where room_id=current_setting('test.room')::uuid;
    raise exception 'direct score mutation unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
-- Fixtures activate directly to exercise lifecycle, not trusted catalog generation.
update public.arena_rooms set status='active',started_at=clock_timestamp(),quiz_questions='[{},{},{},{},{}]'
where id=current_setting('test.room')::uuid;
update arena_private.runtime_controls set enabled=true where control_name='multiplayer_maintenance';
set local role authenticated;
select public.forfeit_arena_room(current_setting('test.room')::uuid);
select public.forfeit_arena_room(current_setting('test.room')::uuid);
reset role;
do $$ begin
  if (select status from public.arena_rooms where id=current_setting('test.room')::uuid) <> 'finished' then raise exception 'Forfeit did not finish'; end if;
  if exists(select 1 from public.arena_room_players where room_id=current_setting('test.room')::uuid and left_at is not null) then raise exception 'Forfeit removed membership'; end if;
  if (select count(*) from public.quiz_results where arena_room_id=current_setting('test.room')::uuid) <> 1 then raise exception 'Registered result missing or duplicated'; end if;
  if exists(select 1 from public.quiz_results where arena_room_id=current_setting('test.room')::uuid and user_id='31000000-0000-4000-8000-000000000002') then raise exception 'Guest progression persisted'; end if;
end $$;
update arena_private.runtime_controls set enabled=false where control_name='multiplayer_maintenance';
set local role authenticated;
select set_config('request.jwt.claim.sub','31000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"31000000-0000-4000-8000-000000000001","is_anonymous":false,"role":"authenticated"}',true);
select public.reset_arena_room_for_rematch(current_setting('test.room')::uuid);
select public.change_waiting_arena_album(current_setting('test.room')::uuid,'itunes:US:2','Replacement','Another Artist','');
reset role;
do $$ begin
  if exists(select 1 from public.arena_room_players where room_id=current_setting('test.room')::uuid and (lobby_ready or left_at is not null)) then raise exception 'Rematch membership/readiness invalid'; end if;
  if (select count(*) from public.quiz_results where arena_room_id=current_setting('test.room')::uuid) <> 1 then raise exception 'Historical result lost'; end if;
  if has_function_privilege('anon','public.change_waiting_arena_album(uuid,text,text,text,text)','execute') then raise exception 'Anonymous role has mutation privilege'; end if;
  if has_table_privilege('authenticated','arena_private.question_keys','select') then raise exception 'Answer keys exposed'; end if;
end $$;
rollback;

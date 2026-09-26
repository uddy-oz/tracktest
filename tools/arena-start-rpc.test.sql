-- Integration test for Supabase SQL Editor. Every fixture and result write is
-- rolled back, including on assertion failure. Uses existing inactive accounts;
-- never reads emails or credentials and never commits rooms or progression.
begin;
set local statement_timeout = '20s';
do $$
#variable_conflict use_variable
declare
  permanent_ids uuid[];
  guest_id uuid;
  host_id uuid;
  rival_id uuid;
  member_id uuid;
  room_id uuid;
  round_id uuid;
  previous_round_id uuid;
  scenario text;
  mode_name text;
  questions jsonb;
  response jsonb;
  snapshot public.arena_rooms%rowtype;
  results jsonb := '[]';
begin
  select array_agg(id) into permanent_ids from (
    select u.id from auth.users u
    where not coalesce(u.is_anonymous, false)
      and not exists (select 1 from public.arena_room_players p
        join public.arena_rooms r on r.id=p.room_id
        where p.user_id=u.id and p.left_at is null and r.status in ('waiting','starting','active'))
    order by u.created_at limit 2
  ) available;
  select u.id into guest_id from auth.users u
  where u.is_anonymous and not exists (select 1 from public.arena_room_players p
    join public.arena_rooms r on r.id=p.room_id
    where p.user_id=u.id and p.left_at is null and r.status in ('waiting','starting','active'))
  order by u.created_at desc limit 1;
  assert cardinality(permanent_ids)=2 and guest_id is not null, 'Need two inactive permanent accounts and one inactive guest.';
  host_id := permanent_ids[1];
  select quiz_questions into questions from public.arena_rooms
  where status='finished' and jsonb_array_length(quiz_questions)>=5
  order by created_at desc limit 1;
  assert questions is not null, 'Need a completed quiz fixture.';

  foreach scenario in array array['permanent','guest','double-start','late-join','guest-leaves','reconnect','rematch','new-album','group','party'] loop
    begin
      mode_name := case scenario when 'group' then 'group_lobby' when 'party' then 'party_mode' else 'duel' end;
      rival_id := case scenario when 'permanent' then permanent_ids[2] else guest_id end;
      perform set_config('request.jwt.claims',jsonb_build_object('sub',host_id,'role','authenticated','is_anonymous',false)::text,true);
      execute 'set local role authenticated';
      insert into public.arena_rooms(host_user_id,mode,album_id,album_name,max_players,is_private)
      values(host_id,mode_name,'start-test','Start test',case when mode_name='duel' then 2 else 10 end,false)
      returning id into room_id;
      insert into public.arena_room_players(room_id,user_id,display_name)
      values(room_id,host_id,'Test host');
      perform set_config('request.jwt.claims',jsonb_build_object('sub',rival_id,'role','authenticated','is_anonymous',rival_id=guest_id)::text,true);
      insert into public.arena_room_players(room_id,user_id,display_name)
      values(room_id,rival_id,'Test rival');
      if scenario='group' then
        perform set_config('request.jwt.claims',jsonb_build_object('sub',permanent_ids[2],'role','authenticated')::text,true);
        insert into public.arena_room_players(room_id,user_id,display_name) values(room_id,permanent_ids[2],'Test third');
      end if;
      if scenario='guest-leaves' then
        perform public.leave_arena_room(room_id);
      end if;
      perform set_config('request.jwt.claims',jsonb_build_object('sub',host_id,'role','authenticated','is_anonymous',false)::text,true);
      if scenario='guest-leaves' then
        begin
          perform public.prepare_competitive_arena_room(room_id,questions);
          raise exception 'Unexpected start after guest left';
        exception when others then
          if sqlerrm <> 'Not enough players to start this room.' then raise; end if;
        end;
      elsif scenario='party' then
        perform public.start_party_room(room_id,questions);
        select * into snapshot from public.arena_rooms where id=room_id;
        assert snapshot.status='active' and snapshot.party_question_phase='countdown';
      else
        response := public.prepare_competitive_arena_room(room_id,questions);
        round_id := (response->>'roundId')::uuid;
        assert (response->>'prepared')::boolean and round_id is not null;
        select * into snapshot from public.arena_rooms where id=room_id;
        assert snapshot.status='starting' and snapshot.competitive_round_phase='preparing_audio';
        assert snapshot.quiz_questions=questions and snapshot.competitive_answer_starts_at is null;
        response := public.prepare_competitive_arena_room(room_id,questions);
        assert (response->>'roundId')::uuid=round_id, 'Duplicate preparation must keep round identity';
        response := public.start_prepared_competitive_arena_room(room_id);
        assert not (response->>'started')::boolean, 'Must wait for audio readiness';
        for member_id in select user_id from public.arena_room_players p where p.room_id=room_id loop
          perform set_config('request.jwt.claims',jsonb_build_object('sub',member_id,'role','authenticated','is_anonymous',member_id=guest_id)::text,true);
          response := public.acknowledge_competitive_lobby_audio_ready(room_id,round_id,questions->0->'correctTrack'->>'previewUrl');
          assert (response->>'accepted')::boolean, 'Every current member including guest must acknowledge';
        end loop;
        perform set_config('request.jwt.claims',jsonb_build_object('sub',host_id,'role','authenticated')::text,true);
        response := public.start_prepared_competitive_arena_room(room_id);
        assert (response->>'started')::boolean;
        select * into snapshot from public.arena_rooms where id=room_id;
        assert snapshot.status='active' and snapshot.competitive_round_phase='countdown';
        response := public.start_prepared_competitive_arena_room(room_id);
        assert (response->>'alreadyStarted')::boolean, 'Duplicate start must be idempotent';
        assert (select competitive_answer_starts_at from public.arena_rooms where id=room_id)=snapshot.competitive_answer_starts_at;
        if scenario in ('rematch','new-album') then
          previous_round_id := round_id;
          update public.arena_rooms set status='finished',finished_at=clock_timestamp() where id=room_id;
          perform public.reset_arena_room_for_rematch(room_id,case when scenario='new-album' then 'new-album' end);
          response := public.prepare_competitive_arena_room(room_id,questions);
          assert (response->>'roundId')::uuid<>previous_round_id;
          select * into snapshot from public.arena_rooms where id=room_id;
          assert snapshot.round_number=2 and snapshot.competitive_ready_count=0 and snapshot.status='starting';
          if scenario='new-album' then assert snapshot.album_id='new-album'; end if;
          response := public.acknowledge_competitive_lobby_audio_ready(room_id,previous_round_id,questions->0->'correctTrack'->>'previewUrl');
          assert not (response->>'accepted')::boolean, 'Old generation must not acknowledge';
        end if;
      end if;
      -- Roll back this scenario before moving to the next one.
      raise exception using errcode='Z0001',message='scenario passed';
    exception when sqlstate 'Z0001' then
      results := results || jsonb_build_array(jsonb_build_object('scenario',scenario,'passed',true));
    end;
  end loop;
  perform set_config('stanzer.start_test_results',results::text,true);
end $$;
select current_setting('stanzer.start_test_results') as results;
rollback;

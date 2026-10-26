-- Read-only verification to run against an isolated local/staging Supabase
-- project after applying 20261026_multiplayer_authority_and_atomic_membership.sql.
-- It intentionally performs no room writes and is safe to rerun.
do $$
declare
  target_table regclass;
  target_column record;
  target_function regprocedure;
begin
  if has_schema_privilege('authenticated', 'public', 'CREATE')
     or has_schema_privilege('anon', 'public', 'CREATE') then
    raise exception 'Client roles must not be able to create objects in public.';
  end if;

  foreach target_table in array array[
    'public.arena_rooms'::regclass,
    'public.arena_room_players'::regclass
  ] loop
    if has_table_privilege('authenticated', target_table, 'INSERT')
       or has_table_privilege('authenticated', target_table, 'UPDATE')
       or has_table_privilege('authenticated', target_table, 'DELETE')
       or has_table_privilege('anon', target_table, 'INSERT')
       or has_table_privilege('anon', target_table, 'UPDATE')
       or has_table_privilege('anon', target_table, 'DELETE') then
      raise exception 'Unexpected direct DML table grant remains on %', target_table;
    end if;

    for target_column in
      select a.attname
      from pg_catalog.pg_attribute a
      where a.attrelid = target_table
        and a.attnum > 0
        and not a.attisdropped
    loop
      if has_column_privilege('authenticated', target_table, target_column.attname, 'UPDATE')
         or has_column_privilege('authenticated', target_table, target_column.attname, 'INSERT')
         or has_column_privilege('anon', target_table, target_column.attname, 'UPDATE')
         or has_column_privilege('anon', target_table, target_column.attname, 'INSERT') then
        raise exception 'Unexpected direct DML column grant remains on %.%',
          target_table, target_column.attname;
      end if;
    end loop;
  end loop;

  if exists (
    select 1
    from pg_catalog.pg_policies p
    where p.schemaname = 'public'
      and p.tablename in ('arena_rooms', 'arena_room_players')
      and p.cmd in ('INSERT', 'UPDATE', 'ALL')
      and p.roles && array['public', 'anon', 'authenticated']::name[]
  ) then
    raise exception 'A client RLS policy still permits direct room/player mutation.';
  end if;

  foreach target_function in array array[
    'public.create_arena_room(text,text,text,text,text,integer,boolean,text,text)'::regprocedure,
    'public.join_public_arena_room(uuid,text,text)'::regprocedure,
    'public.join_arena_room_by_invite(text,text,text)'::regprocedure,
    'public.set_arena_guest_display_name(uuid,text)'::regprocedure,
    'public.guard_arena_quiz_result_source()'::regprocedure
  ] loop
    if target_function = 'public.guard_arena_quiz_result_source()'::regprocedure
       and has_function_privilege('authenticated', target_function, 'EXECUTE') then
      raise exception 'Trigger-only guard must not be callable by clients.';
    elsif target_function <> 'public.guard_arena_quiz_result_source()'::regprocedure
       and not has_function_privilege('authenticated', target_function, 'EXECUTE') then
      raise exception 'Authenticated execution missing for %', target_function;
    end if;
    if target_function <> 'public.guard_arena_quiz_result_source()'::regprocedure
       and has_function_privilege('anon', target_function, 'EXECUTE') then
      raise exception 'Anonymous execution unexpectedly allowed for %', target_function;
    end if;
    if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = target_function) then
      raise exception 'RPC must be SECURITY DEFINER: %', target_function;
    end if;
    if target_function = 'public.guard_arena_quiz_result_source()'::regprocedure
       and not exists (
         select 1 from pg_catalog.pg_proc p
         where p.oid = target_function
           and p.proconfig @> array['search_path=""']
       ) then
      raise exception 'Arena result trigger guard must have an empty search path.';
    end if;
  end loop;

  if has_function_privilege(
    'authenticated',
    'public.join_arena_room_internal(uuid,text,text,text)'::regprocedure,
    'EXECUTE'
  ) then
    raise exception 'Internal join helper must not be callable by clients.';
  end if;
end;
$$;

-- Concurrency remains an integration check: from two authenticated staging
-- sessions, submit join_public_arena_room for different users against one
-- waiting room with one open seat. Exactly one call must succeed and the final
-- active membership count must not exceed arena_rooms.max_players.

begin;
set local timezone='America/New_York';
set local role anon;
do $$
declare p jsonb:=public.get_daily_challenge_period();
begin
 if p->>'version'<>'1' or right(p->>'periodStart',1)<>'Z' or right(p->>'periodEnd',1)<>'Z'
 or (p->>'periodEnd')::timestamptz-(p->>'periodStart')::timestamptz<>interval '86400 seconds'
 or (p->>'serverNow')::timestamptz<(p->>'periodStart')::timestamptz
 or (p->>'serverNow')::timestamptz>=(p->>'periodEnd')::timestamptz then raise exception 'Invalid UTC period'; end if;
end $$;
reset role;
do $$ begin
 if not has_function_privilege('authenticated','public.get_daily_challenge_period()','EXECUTE')
 or exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a where p.oid='public.get_daily_challenge_period()'::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE')
 or to_regclass('arena_private.verified_solo_runs') is not null then raise exception 'Release surface is incorrect'; end if;
end $$;
rollback;

begin;

-- Badge Vault release: calendar metadata only. No Solo verifier or awards.
create or replace function public.get_daily_challenge_period()
returns jsonb language sql volatile security invoker set search_path='' as $$
 with clock as(select clock_timestamp() as t), period as(select t,date_trunc('day',t at time zone 'UTC') at time zone 'UTC' as start_at from clock)
 select jsonb_build_object('version',1,
 'serverNow',to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'periodStart',to_char(start_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'periodEnd',to_char((start_at+interval '86400 seconds') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')) from period;
$$;
revoke all on function public.get_daily_challenge_period() from public,anon,authenticated;
grant execute on function public.get_daily_challenge_period() to anon,authenticated;
notify pgrst,'reload schema';

commit;

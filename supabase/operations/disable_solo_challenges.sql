-- Operational kill switch, not a migration. Only use if Challenge RPCs are installed.
begin;
set local lock_timeout = '3s';

revoke execute on function
  public.get_solo_challenge(uuid),
  public.create_solo_challenge(jsonb,integer,integer,jsonb),
  public.begin_solo_challenge(uuid),
  public.open_solo_challenge_question(uuid,integer),
  public.reveal_solo_challenge_answer(uuid,integer)
from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;

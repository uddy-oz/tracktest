begin;

create schema if not exists solo_challenge_private;
revoke all on schema solo_challenge_private from public, anon, authenticated, service_role;

create table solo_challenge_private.challenges (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  album jsonb not null,
  player_name text not null,
  score integer not null,
  correct integer not null,
  questions jsonb not null
);
create index on solo_challenge_private.challenges (creator_id, created_at);

create table solo_challenge_private.attempts (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references solo_challenge_private.challenges(id) on delete cascade,
  player_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  next_index integer not null default 0,
  opened_at timestamptz
);
create index on solo_challenge_private.attempts (player_id, created_at);
create index on solo_challenge_private.attempts (challenge_id);

alter table solo_challenge_private.challenges enable row level security;
alter table solo_challenge_private.attempts enable row level security;
revoke all on all tables in schema solo_challenge_private from public, anon, authenticated, service_role;

create function public.create_solo_challenge(p_album jsonb,p_score integer,p_correct integer,p_questions jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  name text;
  new_id uuid;
  q jsonb;
  option_name jsonb;
  n integer;
  audio_url text;
begin
  if actor is null then raise exception 'Sign in or continue as a guest.'; end if;
  if p_questions is null or octet_length(p_questions::text)>16000 or jsonb_typeof(p_questions) <> 'array' then
    raise exception 'Invalid challenge questions.';
  end if;
  n := jsonb_array_length(p_questions);
  if n not between 5 and 12 or p_correct is null or p_score is null
     or p_correct not between 0 and n or p_score not between 500*p_correct and 1000*p_correct
     or p_album is null or jsonb_typeof(p_album)<>'object' or octet_length(p_album::text)>1500
     or coalesce(p_album->>'id','') !~ '^itunes:[A-Z]{2}:[0-9]{1,20}$'
     or length(coalesce(p_album->>'title','')) not between 1 and 200
     or length(coalesce(p_album->>'artist','')) not between 1 and 200 then
    raise exception 'Invalid challenge details.';
  end if;
  for q in select value from jsonb_array_elements(p_questions) loop
    audio_url := q->>'previewUrl';
    if jsonb_typeof(q) is distinct from 'object'
       or jsonb_typeof(q->'options') is distinct from 'array'
       or coalesce(q->>'correctIndex','') !~ '^[0-3]$'
       or jsonb_typeof(q->'offset') is distinct from 'number'
       or coalesce(audio_url,'') !~ '^https://(audio-ssl\.itunes\.apple\.com|audio\.itunes\.apple\.com|audio-ssl\.mzstatic\.com|audio\.mzstatic\.com)/[A-Za-z0-9._/%~-]+$'
       or length(audio_url)>1000 then raise exception 'Invalid challenge clip.'; end if;
    if jsonb_array_length(q->'options') <> 4 or (q->>'offset')::numeric not between 0 and 30 then
      raise exception 'Invalid challenge options.';
    end if;
    for option_name in select value from jsonb_array_elements(q->'options') loop
      if jsonb_typeof(option_name)<>'string' or length(btrim(option_name#>>'{}')) not between 1 and 250 then
        raise exception 'Invalid answer label.';
      end if;
    end loop;
  end loop;
  perform pg_advisory_xact_lock(69237601, hashtext(actor::text));
  if (select count(*) from solo_challenge_private.challenges where creator_id=actor and created_at>now()-interval '1 day')>=10 then
    raise exception 'Daily challenge sharing limit reached.';
  end if;
  select case when u.is_anonymous then u.raw_user_meta_data->>'guest_name'
              else coalesce(nullif(p.display_name,''),p.username) end into name
  from auth.users u left join public.profiles p on p.id=u.id where u.id=actor;
  insert into solo_challenge_private.challenges(creator_id,album,player_name,score,correct,questions)
  values(actor,jsonb_build_object(
    'id',p_album->>'id','title',p_album->>'title','artist',p_album->>'artist',
    'year',left(coalesce(p_album->>'year',''),4),
    'imageUrl',case when p_album->>'imageUrl' ~ '^https://[A-Za-z0-9-]+\.mzstatic\.com/[A-Za-z0-9._/%~-]+$'
               then p_album->>'imageUrl' else '' end),
    coalesce(nullif(left(btrim(name),48),''),'StanZer player'),p_score,p_correct,p_questions
  ) returning id into new_id;
  return new_id;
end;
$$;

create function public.get_solo_challenge(p_challenge uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id',id,'album',album,'playerName',player_name,'score',score,
    'correct',correct,'questionCount',jsonb_array_length(questions),'expiresAt',expires_at)
  from solo_challenge_private.challenges where id=p_challenge and expires_at>now();
$$;

create function public.begin_solo_challenge(p_challenge uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); new_id uuid;
begin
  if actor is null then raise exception 'Sign in or continue as a guest.'; end if;
  perform pg_advisory_xact_lock(69237602,hashtext(actor::text));
  if (select count(*) from solo_challenge_private.attempts where player_id=actor and created_at>now()-interval '1 day')>=30 then
    raise exception 'Daily challenge attempt limit reached.';
  end if;
  insert into solo_challenge_private.attempts(challenge_id,player_id)
  select id,actor from solo_challenge_private.challenges where id=p_challenge and expires_at>now()
  returning id into new_id;
  if new_id is null then raise exception 'Challenge is unavailable.'; end if;
  return new_id;
end;
$$;

create function public.open_solo_challenge_question(p_attempt uuid,p_index integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q jsonb;
begin
  select c.questions->p_index into q
  from solo_challenge_private.attempts a join solo_challenge_private.challenges c on c.id=a.challenge_id
  where a.id=p_attempt and a.player_id=auth.uid() and a.next_index=p_index
    and a.created_at>now()-interval '1 hour' and c.expires_at>now()
  for update of a;
  if q is null then raise exception 'Question is unavailable.'; end if;
  update solo_challenge_private.attempts set opened_at=coalesce(opened_at,clock_timestamp()) where id=p_attempt;
  return jsonb_build_object('options',q->'options','previewUrl',q->'previewUrl','offset',q->'offset');
end;
$$;

create function public.reveal_solo_challenge_answer(p_attempt uuid,p_index integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare q jsonb;
begin
  select c.questions->p_index into q
  from solo_challenge_private.attempts a join solo_challenge_private.challenges c on c.id=a.challenge_id
  where a.id=p_attempt and a.player_id=auth.uid() and a.next_index=p_index
    and a.opened_at <= clock_timestamp()-interval '2 seconds'
    and a.created_at>now()-interval '1 hour' and c.expires_at>now()
  for update of a;
  if q is null then raise exception 'Answer is unavailable.'; end if;
  update solo_challenge_private.attempts set next_index=next_index+1,opened_at=null where id=p_attempt;
  return (q->>'correctIndex')::integer;
end;
$$;

revoke all on function public.get_solo_challenge(uuid), public.create_solo_challenge(jsonb,integer,integer,jsonb),
  public.begin_solo_challenge(uuid), public.open_solo_challenge_question(uuid,integer),
  public.reveal_solo_challenge_answer(uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.get_solo_challenge(uuid) to anon, authenticated;
grant execute on function public.create_solo_challenge(jsonb,integer,integer,jsonb),public.begin_solo_challenge(uuid),
  public.open_solo_challenge_question(uuid,integer),public.reveal_solo_challenge_answer(uuid,integer) to authenticated;
notify pgrst, 'reload schema';
commit;

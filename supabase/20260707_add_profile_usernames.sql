alter table public.profiles
  add column if not exists username text,
  add column if not exists display_name text;

create unique index if not exists profiles_username_unique_idx
  on public.profiles (username)
  where username is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_username_format_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_username_format_check
      check (username is null or username ~ '^[a-z0-9_]{3,20}$');
  end if;
end $$;

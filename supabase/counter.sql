-- The anonymous count of the apps' users (Android: data/Counter.kt; web app:
-- countOpening in src/main.js). Each phone or browser makes a random id the
-- first time (nothing about the listener) and sends it, with the app's version,
-- once a day when the app is opened. Nothing else is stored: no account, no IP
-- address, nothing listened to. Days are Baghdad's (UTC+3).
--
-- Run once in Supabase → SQL Editor (safe to run again).

create extension if not exists pgcrypto with schema extensions;

-- A phone or browser: when it was first and last opened, on which version
create table if not exists public.app_devices (
  id uuid primary key,
  platform text not null,      -- android, android-play, web-iphone, web-android, web-desktop
  version text,
  first_seen date not null,
  last_seen date not null
);
create index if not exists app_devices_first_seen on public.app_devices (first_seen);
create index if not exists app_devices_last_seen on public.app_devices (last_seen);

-- Each day each of them was opened (for the daily numbers)
create table if not exists public.app_activity (
  day date not null,
  device uuid not null references public.app_devices (id) on delete cascade,
  primary key (day, device)
);

-- Nobody reads or writes them directly: only through the two functions below
alter table public.app_devices enable row level security;
alter table public.app_activity enable row level security;
revoke all on public.app_devices, public.app_activity from anon, authenticated;

-- Called by the apps: "this one was opened today"
create or replace function public.app_ping(p_id uuid, p_platform text, p_version text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Baghdad')::date;
begin
  if p_id is null or p_platform is null then return; end if;
  insert into app_devices (id, platform, version, first_seen, last_seen)
  values (p_id, left(p_platform, 20), left(p_version, 20), today, today)
  on conflict (id) do update
    set last_seen = today, version = excluded.version, platform = excluded.platform;
  insert into app_activity (day, device) values (today, p_id) on conflict do nothing;
end
$$;
revoke execute on function public.app_ping(uuid, text, text) from public;
grant execute on function public.app_ping(uuid, text, text) to anon, authenticated;

-- The numbers, for the stats page: only with the owner's key (its SHA-256 here)
create or replace function public.app_stats(p_key text)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  today date := (now() at time zone 'Asia/Baghdad')::date;
begin
  if encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex') <> '784cc9da21a6ef92e9ad77a12443820f8a215a8a89b1a9e7b74d10b98f9bad28' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return json_build_object(
    'today', today,
    'total', (select count(*) from app_devices),
    'active1', (select count(*) from app_devices where last_seen = today),
    'active7', (select count(*) from app_devices where last_seen > today - 7),
    'active30', (select count(*) from app_devices where last_seen > today - 30),
    'added1', (select count(*) from app_devices where first_seen = today),
    'added7', (select count(*) from app_devices where first_seen > today - 7),
    'platforms', (
      select coalesce(json_agg(p order by p.total desc), '[]'::json) from (
        select platform, count(*) as total, count(*) filter (where last_seen > today - 30) as active30
        from app_devices group by platform
      ) p),
    'days', (
      select json_agg(json_build_object(
        'day', g.day,
        'active', (select count(*) from app_activity a where a.day = g.day),
        'added', (select count(*) from app_devices v where v.first_seen = g.day)
      ) order by g.day)
      from (select today - i as day from generate_series(0, 29) as i) g),
    'versions', (
      select coalesce(json_agg(v order by v.platform, v.devices desc), '[]'::json) from (
        select platform, version, count(*) as devices
        from app_devices where last_seen > today - 30
        group by platform, version
      ) v)
  );
end
$$;
revoke execute on function public.app_stats(text) from public;
grant execute on function public.app_stats(text) to anon, authenticated;

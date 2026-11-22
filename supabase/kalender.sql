-- Tagesplan: Termine aus dem Apple-Kalender über einen iPhone-Kurzbefehl.
-- Einmal im Supabase-Dashboard unter "SQL Editor" einfügen und ausführen ("Run").
-- Voraussetzung: schema.sql wurde bereits ausgeführt. Das Skript kann mehrfach ausgeführt werden.

-- Schlüssel für den Kurzbefehl. Gespeichert wird nur ein Hash, nie der Schlüssel selbst.
create table if not exists public.calendar_tokens (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  last_count   integer
);

-- Vom Kurzbefehl übertragene Termine (nur lesbar für die App).
create table if not exists public.calendar_events (
  user_id     uuid not null references auth.users (id) on delete cascade,
  id          text not null,
  title       text not null,
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  all_day     boolean not null default false,
  calendar    text not null default '',
  location    text not null default '',
  imported_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists calendar_events_user_end_idx on public.calendar_events (user_id, end_at);

alter table public.calendar_tokens enable row level security;
alter table public.calendar_events enable row level security;

revoke all on public.calendar_tokens from anon, authenticated;
revoke all on public.calendar_events from anon, authenticated;
-- Den Hash darf auch der Nutzer selbst nicht lesen, nur den Status.
grant select (user_id, created_at, last_used_at, last_count) on public.calendar_tokens to authenticated;
grant select on public.calendar_events to authenticated;

drop policy if exists "Eigenen Kalender-Status lesen" on public.calendar_tokens;
create policy "Eigenen Kalender-Status lesen" on public.calendar_tokens
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Eigene Kalender-Termine lesen" on public.calendar_events;
create policy "Eigene Kalender-Termine lesen" on public.calendar_events
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Datum aus dem Kurzbefehl lesen: ISO 8601 (empfohlen) oder deutsches Format "22.11.2026, 09:30".
create or replace function public.tp_parse_date(t text, tz text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  m text[];
  y int;
begin
  t := btrim(coalesce(t, ''));
  if t ~ '^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}' then
    if t ~ '(Z|[+-]\d{2}(:?\d{2})?)$' then
      return t::timestamptz;
    end if;
    return t::timestamp at time zone tz;
  elsif t ~ '^\d{4}-\d{2}-\d{2}$' then
    return t::date::timestamp at time zone tz;
  end if;

  m := regexp_match(t, '^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})(?:,?\s*(?:um\s+)?(\d{1,2}):(\d{2}))?');
  if m is null then
    return null;
  end if;
  y := m[3]::int;
  if y < 100 then
    y := y + 2000;
  end if;
  return make_timestamp(y, m[2]::int, m[1]::int, coalesce(m[4]::int, 0), coalesce(m[5]::int, 0), 0) at time zone tz;
exception when others then
  return null;
end;
$$;

-- Neuen Schlüssel für den angemeldeten Nutzer erzeugen (ersetzt einen alten).
create or replace function public.create_calendar_token()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.calendar_tokens (user_id, token_hash)
  values (v_uid, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'))
  on conflict (user_id) do update
    set token_hash = excluded.token_hash, created_at = now(), last_used_at = null, last_count = null;
  return v_token;
end;
$$;

-- Verbindung trennen: Schlüssel und übertragene Termine löschen.
create or replace function public.remove_calendar()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.' using errcode = '28000';
  end if;
  delete from public.calendar_tokens where user_id = auth.uid();
  delete from public.calendar_events where user_id = auth.uid();
end;
$$;

-- Wird vom Kurzbefehl aufgerufen. `events`: eine Zeile pro Termin im Format
--   Startdatum | Enddatum | Ist ganztägig | Kalender | Ort | Titel
-- Ersetzt alle Termine ab heute; ältere bleiben (bis 60 Tage) zum Zurückblättern erhalten.
create or replace function public.import_calendar(token text, events text, tz text default 'Europe/Berlin')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_cutoff timestamptz;
  v_records text[] := '{}';
  v_line text;
  v_buf text;
  v_parts text[];
  v_start timestamptz;
  v_end timestamptz;
  v_title text;
  v_ok int := 0;
  v_bad int := 0;
  v_n int;
begin
  if token is null or length(token) < 32 then
    raise exception 'Schlüssel fehlt oder ist ungültig.' using errcode = '28000';
  end if;
  select t.user_id into v_uid
  from public.calendar_tokens t
  where t.token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex');
  if v_uid is null then
    raise exception 'Unbekannter Schlüssel. Erzeuge in Tagesplan einen neuen.' using errcode = '28000';
  end if;
  if length(coalesce(events, '')) > 1000000 then
    raise exception 'Zu viele Daten auf einmal.';
  end if;
  if tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = tz) then
    tz := 'Europe/Berlin';
  end if;
  v_cutoff := date_trunc('day', now() at time zone tz) at time zone tz; -- heute 00:00

  -- Ein Termin beginnt mit einem Datum oder hat mindestens 4 Trennstriche. Andere Zeilen
  -- (z. B. die zweite Zeile eines mehrzeiligen Orts) gehören zum vorherigen Termin.
  foreach v_line in array regexp_split_to_array(coalesce(events, ''), E'\r?\n') loop
    v_line := btrim(v_line);
    continue when v_line = '';
    if v_buf is null
       or v_line ~ '^(\d{4}-\d{2}-\d{2}|\d{1,2}\.\s*\d{1,2}\.)'
       or length(v_line) - length(replace(v_line, '|', '')) >= 4 then
      if v_buf is not null then
        v_records := v_records || v_buf;
      end if;
      v_buf := v_line;
    else
      v_buf := v_buf || ', ' || v_line;
    end if;
  end loop;
  if v_buf is not null then
    v_records := v_records || v_buf;
  end if;

  delete from public.calendar_events c
  where c.user_id = v_uid and (c.end_at >= v_cutoff or c.end_at < v_cutoff - interval '60 days');

  foreach v_line in array v_records loop
    v_parts := regexp_split_to_array(v_line, '\s*\|\s*');
    if coalesce(array_length(v_parts, 1), 0) < 6 then
      v_bad := v_bad + 1;
      continue;
    end if;
    v_start := public.tp_parse_date(v_parts[1], tz);
    v_end := public.tp_parse_date(v_parts[2], tz);
    if v_start is null or v_end is null then
      v_bad := v_bad + 1;
      continue;
    end if;
    if v_end < v_start then
      v_end := v_start;
    end if;
    continue when v_end < v_cutoff; -- schon vorbei, steht bereits in der Tabelle

    v_title := left(btrim(array_to_string(v_parts[6:], ' | ')), 200);
    if v_title = '' then
      v_title := '(Ohne Titel)';
    end if;

    insert into public.calendar_events (user_id, id, title, start_at, end_at, all_day, calendar, location)
    values (
      v_uid,
      md5(concat_ws('|', v_start::text, v_end::text, btrim(v_parts[4]), v_title)),
      v_title,
      v_start,
      v_end,
      lower(btrim(v_parts[3])) in ('ja', 'yes', 'true', 'wahr', '1'),
      left(btrim(v_parts[4]), 100),
      left(btrim(v_parts[5]), 300)
    )
    on conflict (user_id, id) do nothing;
    get diagnostics v_n = row_count;
    v_ok := v_ok + v_n;
  end loop;

  update public.calendar_tokens set last_used_at = now(), last_count = v_ok where user_id = v_uid;

  return v_ok || case when v_ok = 1 then ' Termin' else ' Termine' end || ' übertragen.'
    || case when v_bad > 0 then ' ' || v_bad || ' Zeile(n) nicht lesbar – bei Start- und Enddatum das Format ISO 8601 wählen.' else '' end;
end;
$$;

-- Wer darf was aufrufen?
revoke all on function public.tp_parse_date(text, text) from public, anon, authenticated;
revoke all on function public.create_calendar_token() from public, anon;
revoke all on function public.remove_calendar() from public, anon;
revoke all on function public.import_calendar(text, text, text) from public;
grant execute on function public.create_calendar_token() to authenticated;
grant execute on function public.remove_calendar() to authenticated;
grant execute on function public.import_calendar(text, text, text) to anon, authenticated;

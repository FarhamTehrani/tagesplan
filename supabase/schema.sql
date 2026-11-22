-- Tagesplan: Tabelle für die gesicherten Einträge.
-- Einmal im Supabase-Dashboard unter "SQL Editor" einfügen und ausführen ("Run").
-- Das Skript kann gefahrlos mehrfach ausgeführt werden.

create table if not exists public.items (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id         text        not null check (char_length(id) between 1 and 100),
  data       jsonb       not null default '{}'::jsonb check (pg_column_size(data) < 16384),
  updated_at timestamptz not null,               -- Änderungszeitpunkt vom Gerät
  deleted    boolean     not null default false, -- Löschmarke, damit Löschungen auf allen Geräten ankommen
  synced_at  timestamptz not null default clock_timestamp(), -- vom Server gesetzt, für "was ist neu?"
  primary key (user_id, id)
);

create index if not exists items_user_synced_idx on public.items (user_id, synced_at);

-- Die neuere Änderung gewinnt: ältere Stände (z. B. von einem Gerät, das lange offline war) werden ignoriert.
create or replace function public.items_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists items_before_write on public.items;
create trigger items_before_write
  before insert or update on public.items
  for each row execute function public.items_before_write();

-- Zugriff: nur angemeldete Nutzer, und jeder sieht und ändert nur seine eigenen Zeilen.
alter table public.items enable row level security;

revoke all on public.items from anon, authenticated;
grant select, insert, update on public.items to authenticated;

drop policy if exists "Eigene Einträge lesen" on public.items;
create policy "Eigene Einträge lesen" on public.items
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Eigene Einträge anlegen" on public.items;
create policy "Eigene Einträge anlegen" on public.items
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Eigene Einträge ändern" on public.items;
create policy "Eigene Einträge ändern" on public.items
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

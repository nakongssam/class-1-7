create table public.relay_strength_map (raw text primary key, tags text[] not null default '{}', updated_at timestamptz not null default now());
alter table public.relay_strength_map enable row level security;
create policy "read strength map" on public.relay_strength_map for select to authenticated using (public.login_pin_ready());
create policy "teacher edits strength map" on public.relay_strength_map for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
alter table public.students add column if not exists relay_reviewed_at timestamptz;
update public.students set revealed = false where revealed;

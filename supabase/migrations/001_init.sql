-- 1-7반 통합 앱 스키마
-- 학번(107xx)을 기준으로 출결·칭찬 릴레이·스터디그룹을 하나로 묶는다.

------------------------------------------------------------
-- 공통: 학생 명단과 로그인
------------------------------------------------------------
create table public.students (
  id uuid primary key default gen_random_uuid(),
  student_no text not null unique check (student_no ~ '^107[0-9]{2}$'),
  name text not null,
  role text not null default 'student' check (role in ('student', 'teacher', 'test')),
  user_id uuid unique references auth.users (id) on delete set null,
  revealed boolean not null default false,        -- 칭찬 릴레이 결과 공개 여부
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 비밀번호(4자리 PIN) 해시와 생년월일. 브라우저에서는 절대 읽을 수 없다(정책 없음).
create table public.login_codes (
  student_no text primary key references public.students (student_no) on update cascade on delete cascade,
  birth text not null check (birth ~ '^[0-9]{6}$'),
  pin_hash text,
  pin_salt text,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  setup_token_hash text,
  setup_expires_at timestamptz,
  last_reset_at timestamptz,
  last_reset_by uuid
);

alter table public.students enable row level security;
alter table public.login_codes enable row level security;

create or replace function public.today_kst() returns date
language sql stable set search_path = public
as $$ select (now() at time zone 'Asia/Seoul')::date $$;

-- 비밀번호가 설정된 계정의 세션인지 (교사가 초기화하면 기존 세션은 즉시 막힌다)
create or replace function public.login_pin_ready() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.students s join public.login_codes c using (student_no)
    where s.user_id = auth.uid() and s.active and c.pin_hash is not null
  )
$$;

create or replace function public.my_student_id() returns uuid
language sql stable security definer set search_path = public
as $$ select id from public.students where user_id = auth.uid() and active and public.login_pin_ready() $$;

create or replace function public.my_student_no() returns text
language sql stable security definer set search_path = public
as $$ select student_no from public.students where user_id = auth.uid() and active and public.login_pin_ready() $$;

create or replace function public.is_teacher() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.students where user_id = auth.uid() and role = 'teacher' and active)
     and public.login_pin_ready()
$$;

-- 로그인 시도 제한: 5번 틀리면 5분 잠금 (서버 함수 전용)
create or replace function public.reserve_login_attempt(_student_no text) returns boolean
language plpgsql security definer set search_path = public
as $$
declare row_code public.login_codes;
begin
  select * into row_code from public.login_codes where student_no = _student_no for update;
  if not found then return false; end if;
  if row_code.locked_until > now() then return false; end if;
  if row_code.locked_until is not null then
    update public.login_codes set failed_attempts = 1, locked_until = null where student_no = _student_no;
  else
    update public.login_codes
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5 then now() + interval '5 minutes' else null end
     where student_no = _student_no;
  end if;
  return true;
end $$;
revoke execute on function public.reserve_login_attempt(text) from public, anon, authenticated;

create policy "signed-in read students" on public.students
  for select to authenticated using (public.login_pin_ready());
create policy "teacher update students" on public.students
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());

-- 교사 화면용: 학생별 비밀번호 상태 (해시는 노출하지 않음)
create or replace function public.teacher_login_status()
returns table (student_no text, pin_set boolean, locked boolean, last_reset_at timestamptz, has_account boolean)
language sql stable security definer set search_path = public
as $$
  select s.student_no, c.pin_hash is not null, coalesce(c.locked_until > now(), false), c.last_reset_at, s.user_id is not null
  from public.students s left join public.login_codes c using (student_no)
  where public.is_teacher()
  order by s.student_no
$$;

------------------------------------------------------------
-- 칭찬 릴레이 (Kindwords)
------------------------------------------------------------
create table public.relay_schedule (
  day date primary key,
  student_id uuid not null references public.students (id) on delete cascade,
  published boolean not null default false
);
create table public.relay_hero_activities (
  day date not null,
  student_id uuid not null references public.students (id) on delete cascade,
  primary key (day, student_id)
);
create table public.relay_messages (
  id uuid primary key default gen_random_uuid(),
  day date not null,
  target_student_id uuid not null references public.students (id) on delete cascade,
  author_student_id uuid not null references public.students (id) on delete cascade,
  strengths text[] not null default '{}',
  body text not null,
  ai_flagged boolean not null default false,
  ai_reason text,
  status text not null default 'approved' check (status in ('approved', 'hidden')),
  teacher_edited boolean not null default false,
  created_at timestamptz not null default now(),
  unique (day, author_student_id, target_student_id)
);
alter table public.relay_schedule enable row level security;
alter table public.relay_hero_activities enable row level security;
alter table public.relay_messages enable row level security;

create or replace function public.relay_record_activity() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.published then
    insert into public.relay_hero_activities (day, student_id) values (new.day, new.student_id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger relay_schedule_activity after insert or update on public.relay_schedule
  for each row execute function public.relay_record_activity();

create policy "read published schedule" on public.relay_schedule
  for select to authenticated using (public.login_pin_ready() and (published or public.is_teacher()));
create policy "teacher manages schedule" on public.relay_schedule
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

create policy "read hero activities" on public.relay_hero_activities
  for select to authenticated using (public.login_pin_ready());

create policy "author inserts message" on public.relay_messages
  for insert to authenticated with check (
    author_student_id = public.my_student_id()
    and day <= public.today_kst()
    and exists (select 1 from public.relay_hero_activities a where a.day = relay_messages.day and a.student_id = relay_messages.target_student_id)
  );
create policy "author reads own" on public.relay_messages
  for select to authenticated using (author_student_id = public.my_student_id());
create policy "teacher manages messages" on public.relay_messages
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

-- 후보: 실제 학생(role=student)만. 교사·테스트 계정은 직접 선택할 때만.
create or replace function public.relay_choose_hero(_day date, _student_id uuid default null) returns uuid
language plpgsql security definer set search_path = public
as $$
declare chosen uuid;
begin
  if not public.is_teacher() then raise exception 'teacher_only'; end if;
  if _day < public.today_kst() then raise exception 'past_day'; end if;
  perform pg_advisory_xact_lock(10735);
  if exists (select 1 from public.relay_schedule where day = _day and published) then raise exception 'already_published'; end if;
  if _student_id is null then
    select s.id into chosen from public.students s
     where s.role = 'student' and s.active
       and not exists (select 1 from public.relay_schedule h where h.student_id = s.id and h.day <> _day)
       and not exists (select 1 from public.relay_hero_activities a where a.student_id = s.id)
     order by random() limit 1;
  else
    select id into chosen from public.students where id = _student_id;
  end if;
  if chosen is null then raise exception 'no_candidate'; end if;
  insert into public.relay_schedule (day, student_id, published) values (_day, chosen, false)
    on conflict (day) do update set student_id = excluded.student_id;
  return chosen;
end $$;

create or replace function public.relay_publish(_day date) returns uuid
language plpgsql security definer set search_path = public
as $$
declare chosen uuid;
begin
  if not public.is_teacher() then raise exception 'teacher_only'; end if;
  update public.relay_schedule set published = true where day = _day returning student_id into chosen;
  if chosen is null then raise exception 'choose_first'; end if;
  return chosen;
end $$;

-- 공개 중인 오늘 주인공을 바꾸거나 한 명 더 추가 (기존 편지는 그대로 유지)
create or replace function public.relay_replace_today(_student_id uuid default null) returns uuid
language plpgsql security definer set search_path = public
as $$
declare _today date := public.today_kst(); _new uuid; _current uuid;
begin
  if not public.is_teacher() then raise exception 'teacher_only'; end if;
  perform pg_advisory_xact_lock(10735);
  select student_id into _current from public.relay_schedule where day = _today for update;
  if _student_id is not null then
    select id into _new from public.students where id = _student_id;
  else
    select s.id into _new from public.students s
     where s.role = 'student' and s.active and s.id is distinct from _current
       and not exists (select 1 from public.relay_schedule sc where sc.student_id = s.id)
       and not exists (select 1 from public.relay_hero_activities a where a.student_id = s.id)
     order by random() limit 1;
  end if;
  if _new is null then raise exception 'no_candidate'; end if;
  insert into public.relay_schedule (day, student_id, published) values (_today, _new, true)
    on conflict (day) do update set student_id = excluded.student_id, published = true;
  return _new;
end $$;

create or replace function public.relay_my_inbox()
returns table (day date, strengths text[], body text)
language sql stable security definer set search_path = public
as $$
  select m.day, m.strengths, m.body
  from public.relay_messages m join public.students s on s.id = m.target_student_id
  where s.id = public.my_student_id() and m.status = 'approved' and (s.revealed or public.is_teacher())
  order by m.created_at
$$;

------------------------------------------------------------
-- 출결 (Attendance Hero)
------------------------------------------------------------
create table public.attendance_reports (
  id uuid primary key default gen_random_uuid(),
  student_no text not null references public.students (student_no) on update cascade,
  student_name text not null,
  report_date date not null,
  kind text not null check (kind in ('지각', '조퇴', '결과', '결석')),
  category text not null check (category in ('질병', '인정', '미인정', '기타')),
  reason text not null default '',
  time_note text not null default '',
  neis_registered boolean not null default false,
  created_by_teacher boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.attendance_reports (student_no, report_date);

create table public.attendance_month_checks (
  month text primary key check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  opened_at timestamptz not null default now()
);
create table public.attendance_month_confirmations (
  month text not null references public.attendance_month_checks (month) on delete cascade,
  student_no text not null references public.students (student_no) on update cascade on delete cascade,
  confirmed_at timestamptz not null default now(),
  primary key (month, student_no)
);
create table public.student_gardens (
  student_no text primary key references public.students (student_no) on update cascade on delete cascade,
  plant_name text not null default '' check (char_length(plant_name) <= 8),
  pot_color text not null default 'terracotta' check (pot_color in ('terracotta', 'cream', 'sage', 'charcoal')),
  prop text not null default 'none' check (prop in ('none', 'stone', 'butterfly', 'snail')),
  updated_at timestamptz not null default now()
);
create table public.class_settings (
  id int primary key default 1 check (id = 1),
  class_name text not null default '1학년 7반'
);
insert into public.class_settings (id) values (1);

alter table public.attendance_reports enable row level security;
alter table public.attendance_month_checks enable row level security;
alter table public.attendance_month_confirmations enable row level security;
alter table public.student_gardens enable row level security;
alter table public.class_settings enable row level security;

-- 학생이 쓴 보고는 이름·학번을 서버가 채운다 (다른 학생 이름으로 보고 불가)
create or replace function public.attendance_fill() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_teacher() then
    new.student_no := public.my_student_no();
    new.neis_registered := false;
    new.created_by_teacher := false;
    if new.student_no is null then raise exception 'not_signed_in'; end if;
  else
    new.created_by_teacher := true;
  end if;
  select name into new.student_name from public.students where student_no = new.student_no;
  if new.kind = '결석' then new.time_note := ''; end if;
  return new;
end $$;
create trigger attendance_fill before insert on public.attendance_reports
  for each row execute function public.attendance_fill();

create policy "student inserts own report" on public.attendance_reports
  for insert to authenticated with check (public.my_student_no() is not null);
create policy "student reads own reports" on public.attendance_reports
  for select to authenticated using (student_no = public.my_student_no());
create policy "teacher manages reports" on public.attendance_reports
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

create policy "read month checks" on public.attendance_month_checks
  for select to authenticated using (public.login_pin_ready());
create policy "teacher manages month checks" on public.attendance_month_checks
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

create policy "student confirms own month" on public.attendance_month_confirmations
  for insert to authenticated with check (student_no = public.my_student_no());
create policy "student reads own confirmations" on public.attendance_month_confirmations
  for select to authenticated using (student_no = public.my_student_no() or public.is_teacher());
create policy "teacher manages confirmations" on public.attendance_month_confirmations
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

create policy "own garden" on public.student_gardens
  for all to authenticated using (student_no = public.my_student_no() or public.is_teacher())
  with check (student_no = public.my_student_no());

create policy "read class settings" on public.class_settings
  for select to authenticated using (public.login_pin_ready());
create policy "teacher updates class settings" on public.class_settings
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());

-- 반 정원: 이름·사유 없이 '익명 번호 + 보고 날짜'만 돌려준다
create or replace function public.attendance_class_garden()
returns table (k int, report_date date)
language sql stable security definer set search_path = public
as $$
  select dense_rank() over (order by r.student_no)::int, r.report_date
  from public.attendance_reports r join public.students s on s.student_no = r.student_no
  where public.login_pin_ready() and s.role = 'student'
$$;

create or replace function public.attendance_meta()
returns table (start_date date, student_count int)
language sql stable security definer set search_path = public
as $$
  select (select min(created_at at time zone 'Asia/Seoul')::date from public.attendance_reports),
         (select count(*)::int from public.students where role = 'student' and active)
  where public.login_pin_ready()
$$;

------------------------------------------------------------
-- 스터디그룹·멘토링 (Pair And Progress)
------------------------------------------------------------
create table public.study_groups (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.students (id) on delete cascade,
  name text not null,
  plan text not null,
  schedule text not null,
  expected_result text not null,
  target_minutes int not null default 600 check (target_minutes > 0),
  status text not null default 'pending' check (status in ('pending', 'active', 'rejected', 'closed')),
  created_at timestamptz not null default now()
);
create table public.study_members (
  group_id uuid not null references public.study_groups (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  role text not null check (role in ('mentor', 'mentee')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  primary key (group_id, student_id)
);
create table public.study_logs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.study_groups (id) on delete cascade,
  author_id uuid not null references public.students (id) on delete cascade,
  activity_date date not null,
  minutes int not null check (minutes between 1 and 1440),
  subject text not null,
  content text not null,
  reflection text not null default '',
  photo_paths text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'confirmed')),
  confirmed_by uuid references public.students (id),
  created_at timestamptz not null default now()
);
create table public.study_log_notes (
  log_id uuid primary key references public.study_logs (id) on delete cascade,
  note text not null default '',
  updated_at timestamptz not null default now()
);
create table public.record_drafts (
  student_id uuid primary key references public.students (id) on delete cascade,
  content text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.study_groups enable row level security;
alter table public.study_members enable row level security;
alter table public.study_logs enable row level security;
alter table public.study_log_notes enable row level security;
alter table public.record_drafts enable row level security;

create or replace function public.is_study_member(_group uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.study_members where group_id = _group and student_id = public.my_student_id() and status = 'accepted') $$;

create or replace function public.study_group_active(_group uuid) returns boolean
language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.study_groups where id = _group and status = 'active') $$;

create policy "teacher reads groups" on public.study_groups
  for select to authenticated using (public.is_teacher());
create policy "teacher manages groups" on public.study_groups
  for update to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "teacher reads members" on public.study_members
  for select to authenticated using (public.is_teacher());

create policy "members read logs" on public.study_logs
  for select to authenticated using (public.is_study_member(group_id) or public.is_teacher());
create policy "members write logs" on public.study_logs
  for insert to authenticated with check (
    author_id = public.my_student_id() and public.is_study_member(group_id) and status = 'pending'
    and public.study_group_active(group_id)
  );
create policy "author deletes pending log" on public.study_logs
  for delete to authenticated using ((author_id = public.my_student_id() and status = 'pending') or public.is_teacher());

create policy "teacher notes" on public.study_log_notes
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());
create policy "teacher drafts" on public.record_drafts
  for all to authenticated using (public.is_teacher()) with check (public.is_teacher());

create or replace function public.list_classmates()
returns table (id uuid, name text, student_no text)
language sql stable security definer set search_path = public
as $$
  select id, name, student_no from public.students
  where public.login_pin_ready() and role <> 'teacher' and active order by student_no
$$;

create or replace function public.create_study_group(_name text, _plan text, _schedule text, _expected text, _members uuid[], _mentor uuid, _target int default 600)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare g uuid; me uuid := public.my_student_id(); all_members uuid[];
begin
  if me is null or public.is_teacher() then raise exception '학생만 신청할 수 있어요'; end if;
  select array_agg(distinct x) into all_members from unnest(array_append(_members, me)) x;
  if cardinality(all_members) < 2 or not (_mentor = any (all_members)) or _target <= 0
     or length(trim(_name)) = 0 or length(trim(_plan)) = 0 or length(trim(_schedule)) = 0 or length(trim(_expected)) = 0 then
    raise exception '신청 내용을 모두 입력하고 멤버와 멘토를 선택하세요';
  end if;
  if exists (select 1 from unnest(all_members) u where not exists (select 1 from public.students s where s.id = u and s.role <> 'teacher' and s.active)) then
    raise exception '반 학생만 초대할 수 있어요';
  end if;
  insert into public.study_groups (creator_id, name, plan, schedule, expected_result, target_minutes)
    values (me, trim(_name), trim(_plan), trim(_schedule), trim(_expected), _target) returning id into g;
  insert into public.study_members (group_id, student_id, role, status)
    select g, u, case when u = _mentor then 'mentor' else 'mentee' end, case when u = me then 'accepted' else 'pending' end
    from unnest(all_members) u;
  return g;
end $$;

create or replace function public.respond_study_invite(_group uuid, _accept boolean) returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform 1 from public.study_groups where id = _group and status = 'pending' for update;
  if not found then raise exception '처리할 수 없는 신청이에요'; end if;
  update public.study_members set status = case when _accept then 'accepted' else 'rejected' end
   where group_id = _group and student_id = public.my_student_id() and status = 'pending';
  if not found then raise exception '본인의 초대만 처리할 수 있어요'; end if;
  if not _accept then
    update public.study_groups set status = 'rejected' where id = _group;
  elsif not exists (select 1 from public.study_members where group_id = _group and status <> 'accepted') then
    update public.study_groups set status = 'active' where id = _group;
  end if;
end $$;

-- 멘토가 쓴 일지는 멘티가, 멘티가 쓴 일지는 멘토가 확인 (작성자 본인 제외)
create or replace function public.confirm_study_log(_id uuid) returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.study_logs l set status = 'confirmed', confirmed_by = public.my_student_id()
   where l.id = _id and l.status = 'pending' and l.author_id <> public.my_student_id()
     and public.is_study_member(l.group_id);
  if not found then raise exception '같은 그룹의 다른 멤버만 확인할 수 있어요'; end if;
end $$;

create or replace function public.list_study_groups()
returns table (id uuid, name text, plan text, schedule text, expected_result text, target_minutes int, status text,
               creator_id uuid, members jsonb, total_minutes bigint, log_count bigint, pending_count bigint, created_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select g.id, g.name, g.plan, g.schedule, g.expected_result, g.target_minutes, g.status, g.creator_id,
    (select jsonb_agg(jsonb_build_object('id', m.student_id, 'name', s.name, 'student_no', s.student_no, 'role', m.role, 'status', m.status) order by s.student_no)
       from public.study_members m join public.students s on s.id = m.student_id where m.group_id = g.id),
    (select coalesce(sum(l.minutes), 0) from public.study_logs l where l.group_id = g.id and l.status = 'confirmed'),
    (select count(*) from public.study_logs l where l.group_id = g.id),
    (select count(*) from public.study_logs l where l.group_id = g.id and l.status = 'pending'),
    g.created_at
  from public.study_groups g
  where public.login_pin_ready()
    and (g.status in ('active', 'closed') or g.creator_id = public.my_student_id()
         or exists (select 1 from public.study_members m where m.group_id = g.id and m.student_id = public.my_student_id())
         or public.is_teacher())
  order by g.created_at desc
$$;

-- 사진 저장소 (비공개). 경로: {group_id}/{student_id}/{파일}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('study-photos', 'study-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "study photo upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'study-photos'
    and public.is_study_member(((storage.foldername(name))[1])::uuid)
    and (storage.foldername(name))[2] = public.my_student_id()::text);
create policy "study photo read" on storage.objects for select to authenticated
  using (bucket_id = 'study-photos'
    and (public.is_teacher() or public.is_study_member(((storage.foldername(name))[1])::uuid)));
create policy "study photo delete" on storage.objects for delete to authenticated
  using (bucket_id = 'study-photos'
    and ((storage.foldername(name))[2] = public.my_student_id()::text or public.is_teacher()));

------------------------------------------------------------
-- 권한 정리: 함수는 로그인 사용자만 실행
------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.reserve_login_attempt(text) from authenticated;

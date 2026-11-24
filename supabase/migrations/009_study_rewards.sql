-- 009: 스터디 개인 보상 (DB에 적용 완료)
alter table public.class_settings add column if not exists study_reward_target int not null default 10 check (study_reward_target between 1 and 100);
create table public.study_rewards (
  student_id uuid not null references public.students(id) on delete cascade,
  round int not null check (round >= 1),
  given_at timestamptz not null default now(),
  note text,
  primary key (student_id, round)
);
alter table public.study_rewards enable row level security;
create policy "read own or teacher rewards" on public.study_rewards for select to authenticated
  using (public.is_teacher() or student_id = public.my_student_id());
create policy "teacher manages rewards" on public.study_rewards for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

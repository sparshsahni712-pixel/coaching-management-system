-- Attendance + student fields migration. Safe to run more than once.
-- Run in the Supabase SQL Editor BEFORE deploying the updated frontend/worker.

-- 1) Students: own name, phone and optional profile picture path
alter table public.students
  add column if not exists full_name text,
  add column if not exists phone text,
  add column if not exists avatar_url text,
  add column if not exists status text default 'active';

update public.students s
set full_name = p.full_name
from public.profiles p
where s.profile_id = p.id and s.full_name is null;

-- 2) Attendance: extra columns
alter table public.attendance
  add column if not exists batch_id uuid references public.batches(id) on delete set null,
  add column if not exists institute_id uuid references public.institutes(id),
  add column if not exists marked_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz default now();

-- backfill batch / institute from the student row
update public.attendance a
set batch_id = s.batch_id,
    institute_id = s.institute_id
from public.students s
where a.student_id = s.id
  and (a.batch_id is null or a.institute_id is null);

-- 3) Clean existing data so constraints can be added
update public.attendance set status = lower(status) where status is not null;
update public.attendance set status = 'present'
  where status is null or status not in ('present','absent','late');

-- remove duplicate (student, date) rows, keeping the newest
delete from public.attendance a
using public.attendance b
where a.student_id = b.student_id
  and a.attendance_date = b.attendance_date
  and (a.created_at, a.id) < (b.created_at, b.id);

delete from public.attendance where student_id is null;

-- 4) Constraints
alter table public.attendance
  alter column student_id set not null,
  alter column status set not null,
  alter column status set default 'present';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'attendance_status_chk'
  ) then
    alter table public.attendance
      add constraint attendance_status_chk check (status in ('present','absent','late'));
  end if;
end $$;

create unique index if not exists attendance_student_date_uq
  on public.attendance (student_id, attendance_date);
create index if not exists attendance_batch_date_idx
  on public.attendance (batch_id, attendance_date);
create index if not exists attendance_institute_date_idx
  on public.attendance (institute_id, attendance_date);

-- 5) RLS: teachers may correct attendance only for their assigned batches
alter table public.attendance enable row level security;

drop policy if exists teacher_update_attendance on public.attendance;
create policy teacher_update_attendance on public.attendance
for update to authenticated
using (
  exists (
    select 1 from public.students s
    join public.teacher_batch_assignments tba on tba.batch_id = s.batch_id
    where s.id = attendance.student_id
      and s.institute_id = (select public.current_user_institute())
      and tba.teacher_profile_id = (select public.current_user_effective_profile_id())
  )
)
with check (
  exists (
    select 1 from public.students s
    join public.teacher_batch_assignments tba on tba.batch_id = s.batch_id
    where s.id = attendance.student_id
      and s.institute_id = (select public.current_user_institute())
      and tba.teacher_profile_id = (select public.current_user_effective_profile_id())
  )
);

-- 6) Stamp who marked it and when (does not overwrite a value the API already set)
create or replace function public.attendance_stamp() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  if new.marked_by is null then
    begin
      new.marked_by := public.current_user_effective_profile_id();
    exception when others then
      null;
    end;
  end if;
  return new;
end $$;

drop trigger if exists attendance_stamp_trg on public.attendance;
create trigger attendance_stamp_trg
before insert or update on public.attendance
for each row execute function public.attendance_stamp();

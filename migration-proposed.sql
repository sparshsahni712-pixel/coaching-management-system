-- PROPOSED, ADDITIVE migration for your EXISTING Supabase project. Review it, then run it yourself in SQL Editor.
-- It deletes no table/column and drops no policy except one buggy storage policy (section 8, replaced with a corrected one).

-- 1. New column + new table the app needs
alter table public.homework add column if not exists attachment_path text;
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  institute_id uuid not null references public.institutes(id),
  title text not null, category text,
  amount numeric not null check (amount >= 0), expense_date date not null default current_date,
  created_at timestamptz default now());
alter table public.expenses enable row level security;
drop policy if exists admin_manage_expenses on public.expenses;
create policy admin_manage_expenses on public.expenses for all to authenticated
  using (institute_id = (select public.current_user_institute()) and (select public.is_institute_admin()))
  with check (institute_id = (select public.current_user_institute()) and (select public.is_institute_admin()));

-- 2. profiles: teachers see assigned students' names, parents see their children's names, admin can rename people in own institute
drop policy if exists teacher_read_assigned_student_profiles on public.profiles;
create policy teacher_read_assigned_student_profiles on public.profiles for select to authenticated using (
  institute_id = (select public.current_user_institute()) and exists (
    select 1 from public.students s join public.teacher_batch_assignments tba on tba.batch_id = s.batch_id
    where s.profile_id = profiles.id and tba.teacher_profile_id = (select auth.uid())));
drop policy if exists parent_read_child_profiles on public.profiles;
create policy parent_read_child_profiles on public.profiles for select to authenticated using (
  exists (select 1 from public.students s join public.parent_student_links psl on psl.student_id = s.id
    where s.profile_id = profiles.id and psl.parent_profile_id = (select auth.uid())));
drop policy if exists admin_update_institute_profiles on public.profiles;
create policy admin_update_institute_profiles on public.profiles for update to authenticated
  using (institute_id = (select public.current_user_institute()) and (select public.is_institute_admin()))
  with check (institute_id = (select public.current_user_institute()) and (select public.is_institute_admin()));

-- 3. teachers / parents can read their own assignment and link rows (needed by existing batch policies)
drop policy if exists teacher_read_own_assignments on public.teacher_batch_assignments;
create policy teacher_read_own_assignments on public.teacher_batch_assignments for select to authenticated using (teacher_profile_id = (select auth.uid()));
drop policy if exists parent_read_own_links on public.parent_student_links;
create policy parent_read_own_links on public.parent_student_links for select to authenticated using (parent_profile_id = (select auth.uid()));

-- 4. students/parents can read their batch and exams
drop policy if exists read_accessible_batches on public.batches;
create policy read_accessible_batches on public.batches for select to authenticated using (
  institute_id = (select public.current_user_institute()) and exists (
    select 1 from public.students s where s.batch_id = batches.id and (select public.can_access_student(s.id))));
drop policy if exists read_accessible_exams on public.exams;
create policy read_accessible_exams on public.exams for select to authenticated using (
  institute_id = (select public.current_user_institute()) and exists (
    select 1 from public.students s where s.batch_id = exams.batch_id and (select public.can_access_student(s.id))));

-- 5. teachers manage exams / homework / attendance corrections ONLY for their assigned batches
drop policy if exists teacher_insert_exams on public.exams;
create policy teacher_insert_exams on public.exams for insert to authenticated with check (
  institute_id = (select public.current_user_institute()) and exists (select 1 from public.teacher_batch_assignments tba where tba.batch_id = exams.batch_id and tba.teacher_profile_id = (select auth.uid())));
drop policy if exists teacher_update_exams on public.exams;
create policy teacher_update_exams on public.exams for update to authenticated
  using (institute_id = (select public.current_user_institute()) and exists (select 1 from public.teacher_batch_assignments tba where tba.batch_id = exams.batch_id and tba.teacher_profile_id = (select auth.uid())))
  with check (institute_id = (select public.current_user_institute()) and exists (select 1 from public.teacher_batch_assignments tba where tba.batch_id = exams.batch_id and tba.teacher_profile_id = (select auth.uid())));
drop policy if exists teacher_insert_homework on public.homework;
create policy teacher_insert_homework on public.homework for insert to authenticated with check (
  institute_id = (select public.current_user_institute()) and exists (select 1 from public.teacher_batch_assignments tba where tba.batch_id = homework.batch_id and tba.teacher_profile_id = (select auth.uid())));
drop policy if exists teacher_update_homework on public.homework;
create policy teacher_update_homework on public.homework for update to authenticated
  using (institute_id = (select public.current_user_institute()) and exists (select 1 from public.teacher_batch_assignments tba where tba.batch_id = homework.batch_id and tba.teacher_profile_id = (select auth.uid())))
  with check (institute_id = (select public.current_user_institute()) and exists (select 1 from public.teacher_batch_assignments tba where tba.batch_id = homework.batch_id and tba.teacher_profile_id = (select auth.uid())));
drop policy if exists teacher_update_attendance on public.attendance;
create policy teacher_update_attendance on public.attendance for update to authenticated
  using (exists (select 1 from public.students s join public.teacher_batch_assignments tba on tba.batch_id = s.batch_id where s.id = attendance.student_id and s.institute_id = (select public.current_user_institute()) and tba.teacher_profile_id = (select auth.uid())))
  with check (exists (select 1 from public.students s join public.teacher_batch_assignments tba on tba.batch_id = s.batch_id where s.id = attendance.student_id and s.institute_id = (select public.current_user_institute()) and tba.teacher_profile_id = (select auth.uid())));

-- 6. students may REPLACE their own submission file; a trigger stops them from touching marks/feedback/status
drop policy if exists student_update_own_submission on public.homework_submissions;
create policy student_update_own_submission on public.homework_submissions for update to authenticated
  using (submitted_by_profile_id = (select auth.uid()) and exists (select 1 from public.students s where s.id = homework_submissions.student_id and s.profile_id = (select auth.uid()) and s.institute_id = (select public.current_user_institute())))
  with check (submitted_by_profile_id = (select auth.uid()) and exists (select 1 from public.students s where s.id = homework_submissions.student_id and s.profile_id = (select auth.uid()) and s.institute_id = (select public.current_user_institute())));
create or replace function public.guard_student_submission_update() returns trigger language plpgsql set search_path = '' as $$
begin
  if public.current_user_role() = 'student' then
    new.id := old.id; new.homework_id := old.homework_id; new.student_id := old.student_id; new.submitted_by_profile_id := old.submitted_by_profile_id;
    new.marks_obtained := null; new.feedback := null; new.reviewed_by := null; new.reviewed_at := null;
    new.status := 'submitted'; new.submitted_at := now();
  end if;
  return new;
end $$;
drop trigger if exists guard_student_submission_update on public.homework_submissions;
create trigger guard_student_submission_update before update on public.homework_submissions for each row execute function public.guard_student_submission_update();

-- 7. storage: students may delete their own old submission file after replacing it
drop policy if exists student_delete_own_homework_files on storage.objects;
create policy student_delete_own_homework_files on storage.objects for delete to authenticated using (
  bucket_id = 'lms-files' and (storage.foldername(name))[1] = (select public.current_user_institute())::text
  and (storage.foldername(name))[2] = 'homework' and array_length(storage.foldername(name), 1) = 4
  and (select public.current_user_role()) = 'student'
  and exists (select 1 from public.students s where s.id::text = (storage.foldername(objects.name))[3] and s.profile_id = (select auth.uid())));

-- 8. BUG FIX: the existing teacher_read_all_learning_files compares a folder to the batch NAME, so teachers never match.
--    Replaced by a corrected version limited to the teacher's ASSIGNED batches.
drop policy if exists teacher_read_all_learning_files on storage.objects;
drop policy if exists teacher_read_assigned_learning_files on storage.objects;
create policy teacher_read_assigned_learning_files on storage.objects for select to authenticated using (
  bucket_id = 'lms-files' and (storage.foldername(name))[1] = (select public.current_user_institute())::text
  and (storage.foldername(name))[2] = any (array['study-materials','exam-papers']) and array_length(storage.foldername(name), 1) = 3
  and (select public.current_user_role()) = 'teacher'
  and exists (select 1 from public.teacher_batch_assignments tba where tba.batch_id::text = (storage.foldername(objects.name))[3]
    and tba.teacher_profile_id = (select auth.uid()) and tba.institute_id = (select public.current_user_institute())));

-- 9. bucket limits (the bucket currently has none)
update storage.buckets set file_size_limit = 10485760, allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp'] where id = 'lms-files';

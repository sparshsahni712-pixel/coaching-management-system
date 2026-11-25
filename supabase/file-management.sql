create table if not exists public.institute_files (
  id uuid primary key default gen_random_uuid(),
  institute_id uuid not null references public.institutes(id),
  uploaded_by uuid not null references auth.users(id),
  file_name text not null,
  file_path text not null unique,
  file_type text not null,
  file_size bigint not null check (file_size > 0),
  category text not null check (
    category in (
      'event',
      'expense',
      'student',
      'teacher',
      'general'
    )
  ),
  related_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists institute_files_institute_idx
on public.institute_files(institute_id);

create index if not exists institute_files_category_idx
on public.institute_files(institute_id, category);

alter table public.institute_files enable row level security;

drop policy if exists institute_admin_manage_files
on public.institute_files;

create policy institute_admin_manage_files
on public.institute_files
for all
to authenticated
using (
  institute_id = (select public.current_user_institute())
  and (select public.is_institute_admin())
)
with check (
  institute_id = (select public.current_user_institute())
  and (select public.is_institute_admin())
);

# Supabase schema compatibility checklist

Before using this frontend with production data, verify these items in the existing Supabase project. This checklist is not a migration.

- `profiles`: `id` matches `auth.users.id`; `institute_id`, `full_name`, and `role` exist; role values match `admin`, `teacher`, `student`, `parent`.
- `students`: `profile_id`, `batch_id`, `admission_number`, `institute_id` exist and foreign keys point to the expected tables.
- `batches`: `id`, `name`, `institute_id` exist.
- `teacher_batch_assignments`: `teacher_profile_id`, `batch_id`, `institute_id` exist.
- `parent_student_links`: `parent_profile_id`, `student_id`, `institute_id` exist.
- `attendance`: `student_id`, `attendance_date`, `status` exist; allowed status values include `present`, `absent`, `late`.
- `exams`: `batch_id`, `title`, `subject`, `exam_date`, `total_marks`, `institute_id` exist.
- `results`: `exam_id`, `student_id`, `marks_obtained` exist.
- `homework`: `batch_id`, `title`, `description`, `due_date`, `institute_id` exist. `attachment_path` is optional unless using attachments and requires a compatible column.
- `homework_submissions`: `homework_id`, `student_id`, `submitted_by_profile_id`, `file_path`, `status`, `marks_obtained`, `feedback`, `reviewed_by`, `submitted_at`, `reviewed_at` exist; confirm `status` has a default or the frontend insert explicitly supplies `submitted`.
- `fees`: `student_id`, `amount`, `due_date`, `status`, `institute_id` exist.
- `fee_payments`: `fee_id`, `student_id`, `amount`, `payment_date`, `payment_method`, `reference_number`, `received_by`, `institute_id` exist.
- `lms-files` private bucket exists and Storage policies permit only the correct institute/user paths.
- RLS policies must permit each role to read/write only its authorized records.

Some of these columns were inferred from the V3 frontend and proposed SQL, not verified against a complete live schema export. Check the actual database before changing anything.

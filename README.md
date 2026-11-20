# Coaching Management System Frontend (React + Vite + Supabase)

This ZIP is a frontend project based on the supplied V3 source. It uses the existing Supabase project through the public anon key and relies on Supabase Row Level Security (RLS) for data access. It does **not** reset or recreate your database.

## Important: verify your existing schema before production

The frontend uses the following existing tables/relationships from the supplied project design: `profiles`, `institutes`, `students`, `batches`, `teacher_batch_assignments`, `attendance`, `exams`, `results`, `homework`, `homework_submissions`, `fees`, `fee_payments`, and `parent_student_links`. The code expects columns and foreign keys such as `profiles.id/institute_id/full_name/role`, `students.profile_id/batch_id/admission_number`, `homework_submissions.status/file_path/answer_text`, and the relationships documented in your V3 SQL.

The full live schema, all constraints, defaults, and all RLS policies were not included in this ZIP. Therefore, do not assume every module will work against the live database until the schema and policies have been checked. In particular:

- `homework.attachment_path` is introduced only by `supabase/migration-proposed.sql`; the frontend's homework attachment feature requires that column.
- The `expenses` table is only in the proposed migration and is intentionally not shown in the app navigation.
- Creating/inviting users requires the separate Cloudflare Worker in `worker/`.
- The frontend currently implements file-based student homework submission. Text-only submission, notification delivery, full institute settings, and advanced reports are not represented as complete backend workflows.
- Some dashboards depend on correct RLS policies to scope records to the signed-in user's institute, assigned batches, own student record, or linked children.

Review `supabase/migration-proposed.sql` manually against your live schema before running it. It is a proposal, not an automatic migration. Do not run it blindly.

## Local setup

1. Install Node.js 20 or later.
2. Copy `.env.example` to `.env`.
3. Fill in the Supabase project URL and public anon key.
4. Run `npm ci`.
5. Run `npm run dev`.
6. Run `npm run build` before deployment.

## Environment variables

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
VITE_ADMIN_API_URL=https://YOUR_ADMIN_WORKER.workers.dev
```

Never put a Supabase `service_role` key in frontend environment variables, browser code, or GitHub.

## Cloudflare frontend deployment

- Framework/build command: `npm run build`
- Output directory: `dist`
- Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_ADMIN_API_URL` in the Cloudflare project's build environment.
- The configured Worker allowed origin is set to the current live site origin `https://coaching-management-system0.sparshsahni712.workers.dev` and local Vite origin. If the final site URL changes, update `worker/wrangler.jsonc`.

## Secure Admin Worker (user invitations)

The Worker is separate from the frontend. Deploy from the `worker` directory. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` as variables and `SUPABASE_SERVICE_ROLE_KEY` as a secret in Cloudflare Worker settings. The service-role key must remain server-side.

## Before going live

1. Export the current database schema and inspect columns, constraints, foreign keys, triggers, and RLS policies.
2. Verify every table/column referenced by `src/portal.jsx`.
3. Confirm RLS is enabled and tested for admin, teacher, student, and parent accounts.
4. Verify the private `lms-files` bucket and its Storage policies.
5. Test login, role routing, CRUD, attendance, fee payments, and homework submissions with separate test accounts.
6. Run `npm ci` and `npm run build`; fix any errors before deploying.

## Security notes

- Browser uses only the public Supabase anon key.
- Actual authorization must be enforced by RLS and the secure Worker, not just hidden UI links.
- Do not share production credentials or service-role keys.
- Deletion is subject to database foreign keys and RLS; test on non-production data first.

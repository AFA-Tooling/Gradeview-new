# Database Overview (P0)

This is the canonical database overview for GradeView/GradeSync.

## 1) Core Tables and Relationships

Primary authorization and tenancy tables:

- `users`: platform identities (staff/admin roles).
- `courses`: course tenant boundary (`id`, `gradescope_course_id`).
- `course_permissions`: per-course staff permission mapping (`owner/editor/viewer`).
- `students`: course-scoped student identities (`email + course_id` unique).

Academic data tables:

- `assignments`: assignment metadata per course.
- `submissions`: student scores per assignment.
- `summary_sheets`: precomputed summary rows.

Configuration and governance tables:

- `course_configs`: per-course sync configuration.
- `assignment_categories`: per-course category rules.
- `system_config`, `gradeview_config`: global config KV stores.
- `config_audit_log`: configuration write audit trail.

## 2) Primary Keys and Foreign Keys (critical path)

- `course_permissions.course_id -> courses.id`
- `course_permissions.user_id -> users.id`
- `course_permissions.granted_by -> users.id`
- `students.course_id -> courses.id`
- `assignments.course_id -> courses.id`
- `submissions.assignment_id -> assignments.id`
- `submissions.student_id -> students.id`
- `summary_sheets.course_id -> courses.id`
- `summary_sheets.student_id -> students.id`
- `summary_sheets.assignment_id -> assignments.id`
- `course_configs.course_id -> courses.id`
- `assignment_categories.course_id -> courses.id`
- `config_audit_log.user_id -> users.id`

## 3) Tenant/Course Isolation Rules

Isolation boundary is **course-first**:

1. Every staff access must be checked by `course_permissions` for the target course.
2. Every student access must be constrained by `students.course_id` and the requested course.
3. Cross-course reads/writes are not allowed unless role is super admin.
4. API queries must always carry a course scope (`course_id` or `gradescope_course_id`) before reading student-grade data.

## 4) Permission Source of Truth

Current enforced source of truth:

- Staff/admin permissions: `users` + `course_permissions` (DB-driven).
- Student enrollment: `students` (course-scoped).

Config files should not be treated as runtime permission authority.

## 5) Canonical Schema Source

- Canonical reference DDL: [schema.sql](schema.sql)
- Runtime migrations: `gradesync/api/migrations/*.sql`
- SQLAlchemy model reference: `gradesync/api/core/models.py`

## 6) Local Development Safety (Do this first)

To avoid damaging shared/prod data:

- Use a **separate local Postgres instance** and local DB name.
- Never point local `.env` to production host.
- Keep a dedicated dev DB user with limited privileges.
- Apply migrations only against local DB during feature development.

See also:

- [MIGRATIONS.md](MIGRATIONS.md)
- [QUERIES_AND_INDEXES.md](QUERIES_AND_INDEXES.md)
- [AUDIT_AND_RECOVERY.md](AUDIT_AND_RECOVERY.md)

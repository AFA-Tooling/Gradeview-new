# Feature: Auth & IAM

## Source Files

| File | Purpose |
|------|---------|
| `api/lib/authlib.mjs` | Express middleware — `validateAdminMiddleware`, `validateStudentMiddleware` |
| `api/lib/iam.mjs` | Low-level permission check helpers (course-scoped reads) |
| `api/lib/jwtAuth.mjs` | Signs and verifies permission-snapshot JWTs |
| `api/lib/googleAuthHelper.mjs` | Verifies Google ID tokens, enforces `@berkeley.edu` domain |
| `api/lib/userlib.mjs` | Resolves user role from `users` + `course_permissions` tables |
| `api/v2/Routes/login/index.js` | `POST /api/v2/login` handler |
| `api/v2/Routes/isadmin/index.js` | `GET /api/v2/isadmin` handler |

## Authentication Flow (step by step)

1. Browser calls Google OAuth and receives an **ID token**.
2. Frontend `POST /api/v2/login` with `{ token: "<google-id-token>" }`.
3. `googleAuthHelper.mjs` verifies the token against Google's public keys.
   - Rejects if the `hd` (hosted domain) field is not `berkeley.edu`.
   - Rejects if the token is expired or signature invalid.
4. `userlib.mjs` queries the `users` table by `email`. If the user does not exist yet, a new row is inserted.
5. `userlib.mjs` queries `course_permissions` to build a list of `{ course_id, permission_level }` pairs.
6. A **JWT** is signed with `JWT_SECRET` (from `.env`) and returned to the browser.
   - Payload includes `email`, `role`, and the `course_permissions` snapshot.
   - Expiry is controlled by `JWT_EXPIRES_IN` (default `12h`).
7. All subsequent requests must carry `Authorization: Bearer <jwt>`.

## Middleware Behaviour

### `validateAdminMiddleware`
- Verifies JWT signature and expiry.
- Checks that the user's `role` in the token is `super_admin`, `course_admin`, or `instructor`.
- For course-scoped routes, checks `course_permissions` for the target `course_id`.
- Returns `403` if any check fails.

### `validateStudentMiddleware`
- Verifies JWT signature and expiry.
- Queries `students` table to confirm the requesting email is enrolled in the target course.
- Returns `403` if not enrolled.

## IAM Roles

| Role | Source of Truth | Permissions |
|------|----------------|-------------|
| `super_admin` | `gradeview.admins` in `config.json` (migrate to DB) | All courses, all actions, GradeSync admin |
| `course_admin` | `course_permissions.permission_level = 'owner'` | Manage sync and config for bound courses |
| `instructor` | `course_permissions.permission_level = 'editor'` | View class roster and grades; no GradeSync admin |
| `ta` | `course_permissions.permission_level = 'viewer'` | Same as instructor |
| `student` | `students` table (`email + course_id`) | Own grades only, per enrolled course |

## Key Rules

- **DB is the authoritative source** for staff and student permissions.
- Config file `admins`/`instructors`/`tas` lists are **legacy** — migrate them into `users` + `course_permissions` rows and do not rely on them for runtime auth.
- Students are **not** in the `users` table; they are identified solely by their email in the `students` table.
- `super_admin` is the only role that can read across course boundaries.
- Every API query on grade data must include a `course_id` scope — never fetch grades without one.

## Adding a New Staff Member

```sql
-- 1. Insert user (if they have not logged in yet)
INSERT INTO users (email, name, role)
VALUES ('newperson@berkeley.edu', 'New Person', 'instructor')
ON CONFLICT (email) DO NOTHING;

-- 2. Grant course permission
INSERT INTO course_permissions (course_id, user_id, permission_level, granted_by)
SELECT c.id, u.id, 'editor', (SELECT id FROM users WHERE email = 'admin@berkeley.edu')
FROM courses c, users u
WHERE c.gradescope_course_id = '1098053'
  AND u.email = 'newperson@berkeley.edu';
```

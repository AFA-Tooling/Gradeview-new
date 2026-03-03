# Feature: Auth & IAM

## Source Files

- Middleware entry: [../../api/lib/authlib.mjs](../../api/lib/authlib.mjs)
- IAM policy: [../../api/lib/iam.mjs](../../api/lib/iam.mjs)
- Token helpers: [../../api/lib/jwtAuth.mjs](../../api/lib/jwtAuth.mjs)
- OAuth helper: [../../api/lib/googleAuthHelper.mjs](../../api/lib/googleAuthHelper.mjs)

## Key Rules

- Staff/admin authorization is DB-only (`users` + `course_permissions`).
- Student access is course-scoped.
- Super admin is the only global bypass.

## Related API Routes

- Login: [../../api/v2/Routes/login/index.js](../../api/v2/Routes/login/index.js)
- Admin check: [../../api/v2/Routes/isadmin/index.js](../../api/v2/Routes/isadmin/index.js)

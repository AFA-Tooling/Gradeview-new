# Key Queries and Index Playbook

This document maps high-frequency API paths to SQL patterns and required indexes.

## 1) Permission and Course Scope

### A. Resolve staff course permissions

Used by IAM checks and settings/admin APIs.

```sql
SELECT c.id, c.gradescope_course_id, cp.permission_level, u.role
FROM users u
JOIN course_permissions cp ON cp.user_id = u.id
JOIN courses c ON c.id = cp.course_id
WHERE LOWER(u.email) = LOWER($1)
  AND u.is_active = true
  AND c.is_active = true;
```

Indexes:

- `idx_users_email`
- `idx_course_permissions_user_id`
- `idx_course_permissions_course_id`

### B. Resolve student enrollment by course

```sql
SELECT 1
FROM students st
JOIN courses c ON c.id = st.course_id
WHERE LOWER(st.email) = LOWER($1)
  AND (c.id::text = $2 OR c.gradescope_course_id::text = $2)
LIMIT 1;
```

Indexes:

- `idx_students_email`
- `ix_students_course_id`
- `courses.gradescope_course_id` unique index

## 2) Student Grade Read Path

### A. Student submissions by assignment/time

```sql
SELECT a.title, a.category, s.total_score, s.max_points, s.submission_time
FROM submissions s
JOIN assignments a ON a.id = s.assignment_id
JOIN students st ON st.id = s.student_id
WHERE LOWER(st.email) = LOWER($1)
  AND ($2::text IS NULL OR a.course_id::text = $2 OR a.gradescope_course_id::text = $2)
ORDER BY s.submission_time DESC;
```

Indexes:

- `idx_submissions_student_id`
- `idx_submissions_assignment_id`
- `idx_submissions_submission_time`
- `idx_assignments_course_id`

## 3) GradeSync / Summary Path

### A. Summary sheet lookup by course

```sql
SELECT ss.student_id, ss.assignment_id, ss.score
FROM summary_sheets ss
WHERE ss.course_id = $1;
```

Indexes:

- `idx_summary_sheets_course_id`
- `idx_summary_sheets_student_id`
- `idx_summary_sheets_assignment_id`

## 4) Config and Audit Path

### A. Read config entries

```sql
SELECT key, value, value_type
FROM system_config
WHERE key = $1;
```

### B. Write audit log after config updates

```sql
INSERT INTO config_audit_log (user_id, table_name, record_id, action, old_values, new_values, ip_address, user_agent)
VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::inet, $8);
```

Indexes:

- `config_audit_log.user_id`
- `config_audit_log.created_at`

## 5) Slow Query Triage (Postgres)

Enable baseline observability in local/staging:

- `log_min_duration_statement = 300ms`
- `shared_preload_libraries = 'pg_stat_statements'`

Top offenders:

```sql
SELECT query, calls, total_exec_time, mean_exec_time, rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;
```

Inspect query plan:

```sql
EXPLAIN (ANALYZE, BUFFERS)
<your_sql_here>;
```

Triage sequence:

1. Confirm course filter exists (avoid cross-tenant scans).
2. Verify predicate columns are indexed.
3. Check for implicit casts breaking index usage.
4. Add composite indexes only after query-shape stability.
5. Re-run `EXPLAIN ANALYZE` and compare.

## 6) Index Change Guardrails

- Add indexes in migration files only.
- For large tables, use `CREATE INDEX CONCURRENTLY` in production.
- Validate impact with `EXPLAIN ANALYZE` before and after.

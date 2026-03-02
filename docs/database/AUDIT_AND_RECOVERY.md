# Data Audit and Recovery Runbook

## 1) Who changed what (Audit)

Primary source:

- `config_audit_log` table

Minimum fields to write on every config mutation:

- `user_id`
- `table_name`
- `record_id`
- `action` (`INSERT` / `UPDATE` / `DELETE`)
- `old_values` (JSONB)
- `new_values` (JSONB)
- `ip_address`
- `user_agent`
- `created_at`

Example: recent changes by user

```sql
SELECT cal.id, u.email, cal.table_name, cal.record_id, cal.action, cal.created_at
FROM config_audit_log cal
LEFT JOIN users u ON u.id = cal.user_id
WHERE LOWER(u.email) = LOWER($1)
ORDER BY cal.created_at DESC
LIMIT 100;
```

Example: diff candidates for one record

```sql
SELECT action, old_values, new_values, created_at
FROM config_audit_log
WHERE table_name = $1 AND record_id = $2
ORDER BY created_at DESC;
```

## 2) Traceability SOP

When a bad config/data event is reported:

1. Identify impacted course and time window.
2. Query `config_audit_log` for matching table/record/time.
3. Confirm actor (`user_id` -> `users.email`).
4. Extract `old_values/new_values` to build rollback payload.
5. Apply rollback in controlled window.
6. Attach SQL evidence and rollback record to incident note.

## 3) Backup Strategy (minimum)

For local/dev:

- Daily logical backup:

```bash
pg_dump -Fc -h localhost -U <user> -d <db_name> -f backups/gradeview_$(date +%F).dump
```

For staging/prod:

- Daily full logical backup + WAL/point-in-time strategy (if managed service allows).
- Keep at least 7 daily backups + 4 weekly backups.

## 4) Recovery Drill (must rehearse)

### A. Full restore to scratch DB

```bash
createdb -h localhost -U <user> gradeview_recovery_test
pg_restore -h localhost -U <user> -d gradeview_recovery_test backups/<latest>.dump
```

### B. Post-restore validation

Run checks:

```sql
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM courses;
SELECT COUNT(*) FROM students;
SELECT COUNT(*) FROM assignments;
SELECT COUNT(*) FROM submissions;
```

Run FK integrity spot-check:

```sql
SELECT COUNT(*)
FROM submissions s
LEFT JOIN students st ON st.id = s.student_id
WHERE st.id IS NULL;
```

Expected: `0`

## 5) Emergency rollback rule

- If deployment introduced schema incompatibility:
  1. Stop write traffic.
  2. Roll back app to previous compatible version.
  3. Apply migration rollback (if safe).
  4. If rollback is unsafe, restore from latest known-good backup.

## 6) Ownership

- Migration author owns rollback SQL.
- Feature owner owns audit visibility for new write paths.
- On-call owns restoration execution in incidents.

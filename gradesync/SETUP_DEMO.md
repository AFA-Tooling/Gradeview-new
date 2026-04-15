# Demo Course Setup Guide

This guide explains how to set up a demo workflow using a sandbox course configuration and a manual GradeSync run.

## Quick Docs Access

- GradeSync feature doc: `../docs/features/gradesync.md`
- Database overview: `../docs/database/README.md`

## Expected Demo Scale

For a typical sandbox class configuration:

| Data | Count |
|------|-------|
| Demo course | 1 |
| Synthetic students | 30 (configurable) |
| Assignments | 10 (across 6 categories) |
| Grade records | ~300 (30 students × 10 assignments) |

Use a `gradescope_course_id` that starts with `demo_` for easier filtering and cleanup.

## Prerequisites

- Python 3.11+ with dependencies installed (`pip install -r api/requirements.txt`).
- A running PostgreSQL instance with the schema applied (see `../docs/database/LOCAL_POSTGRES_DEV.md`).
- A `.env` file or environment with `DATABASE_URL` / `POSTGRES_*` set.

## Usage

```bash
cd gradesync

# Confirm configured courses
python sync_grades.py --list

# Run sync for your demo/sandbox course id (configured in ../config.json)
python sync_grades.py demo_course_id
```

## Running Inside Docker

If you prefer to run inside the GradeSync container (connects to the same DB the container uses):

```bash
# From the repository root — start the stack first
docker compose -f docker-compose.dev.yml up -d

# Then exec into the container
docker compose -f docker-compose.dev.yml exec gradesync \
  python sync_grades.py demo_course_id
```

## Verifying the Data

```bash
# Quick check via psql
psql "$DATABASE_URL" -c "
SELECT c.name, COUNT(DISTINCT s.id) AS students, COUNT(sub.id) AS grades
FROM courses c
LEFT JOIN students s ON s.course_id = c.id
LEFT JOIN assignments a ON a.course_id = c.id
LEFT JOIN submissions sub ON sub.assignment_id = a.id
WHERE c.gradescope_course_id LIKE 'demo_%'
GROUP BY c.name;
"
```

Expected output: one row with the demo course name, 30 students, and ~300 grade entries.

## Removing Demo Data

```bash
# Delete demo courses and associated data directly in psql:
psql "$DATABASE_URL" -c "
DELETE FROM courses WHERE gradescope_course_id LIKE 'demo_%';
-- Cascade deletes students, assignments, submissions automatically
"
```

## Troubleshooting

**Database connection timeout**
- Verify `DATABASE_URL` in your `.env` points to the correct host and port.
- If using Cloud SQL, ensure the Cloud SQL Proxy container is running.
- Test connectivity: `psql "$DATABASE_URL" -c "SELECT 1;"`

**Sync runs slowly**
- Large sync jobs can take 10–30 seconds depending on API/DB latency. This is normal.

**`relation "courses" does not exist`**
- The schema has not been applied yet. Run: `psql "$DATABASE_URL" -f ../docs/database/schema.sql`

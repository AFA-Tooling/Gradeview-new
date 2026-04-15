# Demo Course Setup Guide

This guide explains how to populate the database with a complete synthetic demo course for testing and demonstrations. No real student data is used.

## Quick Docs Access

- GradeSync feature doc: `../docs/features/gradesync.md`
- Database overview: `../docs/database/README.md`

## What the Script Creates

Running `create_demo_course.py` inserts:

| Data | Count |
|------|-------|
| Demo course | 1 |
| Synthetic students | 30 (configurable) |
| Assignments | 10 (across 6 categories) |
| Grade records | ~3 000 (realistic distribution) |

Grade distribution:
- 70% of students: 80–100% (strong)
- 20% of students: 65–80% (passing)
- 10% of students: 40–65% (struggling)
- ~5% of records: missing / not submitted
- ~15% of records: marked late

All demo records use a `gradescope_course_id` that starts with `demo_` so they are easy to identify and clean up.

## Prerequisites

- Python 3.11+ with dependencies installed (`pip install -r api/requirements.txt`).
- A running PostgreSQL instance with the schema applied (see `../docs/database/LOCAL_POSTGRES_DEV.md`).
- A `.env` file or environment with `DATABASE_URL` / `POSTGRES_*` set.

## Usage

```bash
cd gradesync

# Create demo course (clean existing demo data first)
python create_demo_course.py --clean

# Custom options
python create_demo_course.py \
  --clean \
  --course-id demo_eecs16a_sp26 \
  --course-name "Demo: EECS 16A — Spring 2026" \
  --students 50
```

### Command Line Arguments

| Argument | Default | Description |
|----------|---------|-------------|
| `--course-id` | `demo_cs10_spring2025` | Unique internal course ID |
| `--course-name` | `Demo: CS10 - The Beauty and Joy of Computing` | Display name |
| `--students` | `30` | Number of synthetic students to create |
| `--clean` | (flag) | Delete existing demo data before creating |

## Running Inside Docker

If you prefer to run the script inside the GradeSync container (connects to the same DB the container uses):

```bash
# From the repository root — start the stack first
docker compose -f docker-compose.dev.yml up -d

# Then exec into the container
docker compose -f docker-compose.dev.yml exec gradesync \
  python create_demo_course.py --clean
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
# Clean up all demo courses and their associated data
python create_demo_course.py --clean
# (running --clean without creating new data is not supported;
#  run with --students 0 equivalent by deleting manually if needed)

# Or directly in psql:
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

**Script runs slowly**
- Inserting 3 000+ records takes 10–30 seconds depending on DB latency. This is normal.
- Use `--students 10` for a faster test run.

**`relation "courses" does not exist`**
- The schema has not been applied yet. Run: `psql "$DATABASE_URL" -f ../docs/database/schema.sql`

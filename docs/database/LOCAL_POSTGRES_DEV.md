# Local Postgres Development (Isolation First)

Goal: ensure feature development never writes to shared/prod databases.

## 1) Start local Postgres (recommended)

```bash
docker run --name gradeview-postgres-dev \
  -e POSTGRES_USER=gradeview_dev \
  -e POSTGRES_PASSWORD=gradeview_dev_pw \
  -e POSTGRES_DB=gradeview_dev \
  -p 55432:5432 \
  -v gradeview_pgdata_dev:/var/lib/postgresql/data \
  -d postgres:16
```

## 2) Use local-only environment values

Set in local `.env` (do not commit secrets):

```env
POSTGRES_HOST=localhost
POSTGRES_PORT=55432
POSTGRES_USER=gradeview_dev
POSTGRES_PASSWORD=gradeview_dev_pw
POSTGRES_DB=gradeview_dev
DATABASE_URL=postgresql://gradeview_dev:gradeview_dev_pw@localhost:55432/gradeview_dev
GRADESYNC_DATABASE_URL=postgresql://gradeview_dev:gradeview_dev_pw@localhost:55432/gradeview_dev
```

## 3) Safety checks before running app/migrations

```bash
psql "postgresql://gradeview_dev:gradeview_dev_pw@localhost:55432/gradeview_dev" -c "select current_database(), inet_server_addr(), inet_server_port();"
```

Expected:

- database = `gradeview_dev`
- server_port = `55432`

## 4) Apply schema locally

Option A: apply canonical schema reference

```bash
psql "postgresql://gradeview_dev:gradeview_dev_pw@localhost:55432/gradeview_dev" -f docs/database/schema.sql
```

Option B: apply project migrations in order

```bash
psql "postgresql://gradeview_dev:gradeview_dev_pw@localhost:55432/gradeview_dev" -f gradesync/api/migrations/001_add_users_and_config_tables.sql
psql "postgresql://gradeview_dev:gradeview_dev_pw@localhost:55432/gradeview_dev" -f gradesync/api/migrations/002_students_per_course.sql
psql "postgresql://gradeview_dev:gradeview_dev_pw@localhost:55432/gradeview_dev" -f gradesync/api/migrations/add_summary_sheet_table.sql
```

## 5) Hard rule for team development

- Never run migrations against non-local DB from a developer machine.
- Never reuse production credentials in local `.env`.
- Use a dedicated local DB port (`55432`) to avoid accidental host collisions.

# GradeSync — Start Here

This directory contains the GradeSync service: a FastAPI application that pulls grade data from Gradescope, PrairieLearn, and iClicker, normalizes it, and writes it to a PostgreSQL database shared with the GradeView API.

## Documentation Map

| Document | What it covers |
|----------|---------------|
| `DEMO_COURSE_README.md` | Creating synthetic demo course data for testing |
| `../docs/features/gradesync.md` | Full feature doc: source files, config fields, sync flow |
| `../docs/features/database.md` | Index into all database documentation |
| `../docs/database/README.md` | Schema overview and table relationships |
| `../README.md` | Full setup and deployment guide |

## Quick Start (standalone GradeSync)

```bash
# Run from the gradesync/ directory
# 1. Copy environment template and fill in credentials
cp api/.env.example .env
# Edit .env: set GRADESCOPE_EMAIL, GRADESCOPE_PASSWORD, PL_API_TOKEN, DATABASE_URL, etc.

# 2. Copy config template and add at least one course
cp ../config.example.json ../config.json
# Edit config.json: add your course under gradesync.courses[]

# 3. Start the service
docker compose up --build

# 4. Access the API docs
open http://localhost:8001/docs
```

## Running as Part of the Full Stack

GradeSync is included in the repository-root Docker Compose files. Use those for normal development:

```bash
# From the repository root
docker compose -f docker-compose.dev.yml up --build
```

GradeSync will be available at `http://localhost:8001/docs` and via the Nginx proxy at `http://localhost/gradesync/`.

## Running a Manual Sync

To verify your setup with an existing configured course:

```bash
cd gradesync
python sync_grades.py --list
python sync_grades.py <course_id>
```

For demo-course setup notes, see `SETUP_DEMO.md`.

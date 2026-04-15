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
# 1. Copy environment template and fill in credentials
cp api/.env.example api/.env
# Edit api/.env: set GRADESCOPE_EMAIL, GRADESCOPE_PASSWORD, PL_API_TOKEN, DATABASE_URL, etc.

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

## Creating Demo Data

To create a full demo course with synthetic students and grades (no real student data):

```bash
cd gradesync
python create_demo_course.py --clean --students 30
```

See `DEMO_COURSE_README.md` for all options.

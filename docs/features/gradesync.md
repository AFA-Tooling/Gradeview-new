# Feature: GradeSync

## Related Docs

- Demo course creation: [../../gradesync/DEMO_COURSE_README.md](../../gradesync/DEMO_COURSE_README.md)

## Key Source Files

| File | Purpose |
|------|---------|
| `gradesync/api/app.py` | FastAPI app factory, lifespan hooks, route registration |
| `gradesync/api/config_manager.py` | Reads `config.json` mounted at `/app/config.json` |
| `gradesync/api/schemas.py` | Pydantic models for all request/response bodies |
| `gradesync/api/core/db.py` | SQLAlchemy engine + session factory |
| `gradesync/api/core/models.py` | ORM table definitions (mirror of `docs/database/schema.sql`) |
| `gradesync/api/core/ingest.py` | Core grade normalization and upsert logic |
| `gradesync/api/core/ingest_optimized.py` | Bulk-upsert path for large courses (>500 students) |
| `gradesync/api/core/exam_policy.py` | Drop-lowest / bonus policy engine |
| `gradesync/api/services/gradescope.py` | Gradescope login session + submissions scraper |
| `gradesync/api/services/prairielearn.py` | PrairieLearn REST API client |
| `gradesync/api/services/iclicker.py` | iClicker instructor login + attendance fetch |
| `gradesync/api/sync/service.py` | Orchestrates per-course sync jobs (reads config, calls services) |
| `gradesync/api/queries/summary.py` | Materializes `summary_sheets` table after sync |
| `gradesync/api/migrations/` | Numbered SQL migration files applied in order |

## Sync Architecture

```
config.json  →  sync/service.py  →  services/{gradescope,prairielearn,iclicker}.py
                     │
                     ▼
              core/ingest.py  (normalize + classify by assignment_categories)
                     │
                     ▼
              DB upsert: students, assignments, submissions
                     │
                     ▼
              queries/summary.py  (refresh summary_sheets)
```

## Configuration Fields That Drive Sync

All sync-side configuration lives under `gradesync.courses[].gradesync` in `config.json`.

| Field | Effect |
|-------|--------|
| `sources.gradescope.enabled` | Whether to pull from Gradescope |
| `sources.gradescope.course_id` | Gradescope numeric course ID (from the course URL) |
| `sources.gradescope.sync_interval_hours` | Auto-sync frequency (0 = manual only) |
| `sources.prairielearn.enabled` | Whether to pull from PrairieLearn |
| `sources.prairielearn.course_id` | PrairieLearn course instance ID |
| `sources.iclicker.enabled` | Whether to pull from iClicker |
| `sources.iclicker.course_names` | Exact iClicker course names (must match portal exactly) |
| `database.enabled` | Write results to PostgreSQL |
| `database.use_as_primary` | When `true`, API reads from DB; when `false`, API calls external APIs live |
| `assignment_categories` | Pattern rules to classify assignment titles into grade categories |

## Triggering a Sync

```bash
# Manual sync for one course (replace COURSE_ID with internal id like cs10_fa25)
curl -X POST http://localhost/gradesync/sync/COURSE_ID \
  -H "Authorization: Bearer <admin-jwt>"

# Check sync status
curl http://localhost/gradesync/status/COURSE_ID \
  -H "Authorization: Bearer <admin-jwt>"
```

Or use the GradeSync admin panel in the web UI (accessible to `super_admin` and `course_admin`).

## Environment Variables Required

| Variable | Used by |
|----------|---------|
| `GRADESCOPE_EMAIL` | `services/gradescope.py` — login |
| `GRADESCOPE_PASSWORD` | `services/gradescope.py` — login |
| `PL_API_TOKEN` | `services/prairielearn.py` — bearer auth |
| `ICLICKER_USERNAME` | `services/iclicker.py` — login |
| `ICLICKER_PASSWORD` | `services/iclicker.py` — login |
| `DATABASE_URL` or `POSTGRES_*` | `core/db.py` — SQLAlchemy engine |

## Demo / Testing Data

To populate synthetic grade data without real students, use the demo-course script:

```bash
cd gradesync
python create_demo_course.py --clean --students 30
```

See [DEMO_COURSE_README.md](../../gradesync/DEMO_COURSE_README.md) for full options.

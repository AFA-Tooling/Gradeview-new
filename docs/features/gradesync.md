# Feature: GradeSync

## Docs

- Course configuration and assignment binding contract:
  [course-configuration-control-plane.md](./course-configuration-control-plane.md)
- Setup guide: [../../gradesync/SETUP_DEMO.md](../../gradesync/SETUP_DEMO.md)
- Demo guide: [../../gradesync/DEMO_COURSE_README.md](../../gradesync/DEMO_COURSE_README.md)
- Start here: [../../gradesync/START_HERE.md](../../gradesync/START_HERE.md)

## Source Files

- App entry: [../../gradesync/api/app.py](../../gradesync/api/app.py)
- Config manager: [../../gradesync/api/config_manager.py](../../gradesync/api/config_manager.py)
- DB models: [../../gradesync/api/core/models.py](../../gradesync/api/core/models.py)
- Sync service: [../../gradesync/api/sync/service.py](../../gradesync/api/sync/service.py)
- Nightly maintainer: [../../gradesync/api/sync/maintainer.py](../../gradesync/api/sync/maintainer.py)

## Scope

- Pulls external grade data
- Normalizes and writes to PostgreSQL
- Serves sync APIs used by admin flows
- Runs scheduled sync for active DB courses via `gradesync-maintainer`

## Scheduled Sync

`gradesync-maintainer` is a separate container from the FastAPI workers. It
checks `courses.is_active = true`, skips courses that synced within
`course_configs.gradescope_sync_interval_hours`, and calls the same
`sync_course_grades()` path used by manual sync.

Defaults:

- `GRADESYNC_MAINTAINER_TIME=03:00`
- `GRADESYNC_MAINTAINER_TIMEZONE=America/Los_Angeles`
- `GRADESYNC_MAINTAINER_STAGGER_SECONDS=30`

Operational notes:

- Manual and scheduled sync share a Postgres advisory lock per course.
- Sync attempts are recorded in `sync_runs`.
- Successful full sync updates `courses.last_synced_at`.
- Dev compose keeps the maintainer behind the `maintainer` profile.

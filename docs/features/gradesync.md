# Feature: GradeSync

## Docs

- Setup guide: [../../gradesync/SETUP_DEMO.md](../../gradesync/SETUP_DEMO.md)
- Demo guide: [../../gradesync/DEMO_COURSE_README.md](../../gradesync/DEMO_COURSE_README.md)
- Start here: [../../gradesync/START_HERE.md](../../gradesync/START_HERE.md)

## Source Files

- App entry: [../../gradesync/api/app.py](../../gradesync/api/app.py)
- Config manager: [../../gradesync/api/config_manager.py](../../gradesync/api/config_manager.py)
- DB models: [../../gradesync/api/core/models.py](../../gradesync/api/core/models.py)
- Sync service: [../../gradesync/api/sync/service.py](../../gradesync/api/sync/service.py)

## Scope

- Pulls external grade data
- Normalizes and writes to PostgreSQL
- Serves sync APIs used by admin flows

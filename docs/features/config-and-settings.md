# Feature: Config & Settings

## Source Files

| File | Purpose |
|------|---------|
| `api/lib/unifiedConfig.mjs` | Loads and exposes `config.json` to the API |
| `api/v2/Routes/config/index.js` | REST endpoints for reading/writing course config |
| `gradesync/api/config_manager.py` | Python equivalent — loads `config.json` for GradeSync |
| `config.example.json` | Full annotated template for `config.json` |

## Config File Location

The unified runtime config is `config.json` at the **repository root**. In current Compose files, it is mounted read-only into the `gradesync` container:

```yaml
# docker-compose.yml
gradesync:
  volumes:
    - ./config.json:/app/config.json:ro
```

Changes to `config.json` require a container restart — there is no live reload.

## Top-level Structure

```jsonc
{
  "gradeview": { ... },  // OAuth client ID + global admin list
  "gradesync":  { ... }  // Per-course data sync + global settings
}
```

Full field-by-field reference: see `README.md` → **Config File Reference**.

## Loading Order (API)

1. Route modules that need config import `loadUnifiedConfig()` from `api/lib/unifiedConfig.mjs` (for example, `api/v2/Routes/config/index.js`).
2. `loadUnifiedConfig()` reads `config.json` from the API container root path (`/api/config.json`).
3. Each call reads and parses `config.json` from disk.
4. Subsequent route calls re-invoke `loadUnifiedConfig()`/helper accessors in `unifiedConfig.mjs`.

## Config vs. Database — Rule of Thumb

| Data | Where to store |
|------|----------------|
| OAuth client ID | `config.json` |
| Global admin emails | `config.json` → migrate to `users` table over time |
| Course sync source IDs and credentials | `config.json` |
| Per-course staff permissions | `course_permissions` DB table |
| Student enrollment | `students` DB table |
| Grade data | `assignments` + `submissions` DB tables |

Never use `config.json` as the runtime permission authority for staff/student access checks. The DB tables are canonical.

## Adding a New Course

1. Add a new entry to `gradesync.courses[]` in `config.json` (copy an existing entry as a template).
2. Set `general.id` to a unique snake_case string.
3. Set `gradesync.sources.gradescope.course_id` to the Gradescope numeric course ID.
4. Set `gradeview.buckets` to match the course grading scale.
5. Restart the `api` and `gradesync` containers.
6. Trigger an initial sync via the GradeSync admin UI or `POST /gradesync/sync/{course_id}`.
7. Insert the course row into the `courses` DB table if it does not appear after the first sync.

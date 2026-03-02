# GradeView

GradeView is a multi-service web app for viewing grades, syncing data, and generating reports. It includes a React web UI, a Node.js API, a Python-based progress report service, and supporting services like Cloud SQL Proxy.

## High-level architecture

![GradeView Logic Flow](./docs/Project_structure.png)

## Project structure

```
Grades/
  api/                # Node.js API
  website/            # React web UI and server
  gradesync/           # Grade sync service (FastAPI)
  progressReport/     # Progress report service
  reverseProxy/       # Nginx reverse proxy
  docs/               # Docs and helper scripts
  scripts/            # Utility scripts
  secrets/            # Local secrets (not committed)
  docker-compose.yml  # Production-like compose
  docker-compose.dev.yml # Dev compose with Cloud SQL Proxy
  .env.example        # Environment template
  config.example.json # Unified config template (gradeview + gradesync)
  config.json         # Unified runtime config
```

## Key services

- **Web UI**: React app served by the web container.
- **API**: Node.js server for authentication and grade data access.
- **GradeSync**: FastAPI service to sync grades from external sources.
- **Progress Report**: Python service for report generation.
- **Cloud SQL Proxy** (dev compose): Connects to a Cloud SQL instance.

## Authentication notes

- Only `@berkeley.edu` accounts can authenticate (enforced by Google token domain check).
- Global admins are defined in `config.json` under `gradeview.admins`.
- Per-course admins are defined in `config.json` under `courses[].general.admins` (or `gradesync.courses[].general.admins` if wrapped format is used).

## IAM roles

- `super_admin`: hardcoded global admin (`weszhang@berkeley.edu`) with system-wide manage permission.
- `course_admin`: can manage GradeSync and course config for bound courses only.
- `instructor`: can view class/student data for bound courses, but cannot access GradeSync admin UI.
- `student`: can only view their own grades (and only for enrolled courses).

## Configuration

1. Copy the environment template:
   ```bash
   cp .env.example .env
   ```
2. Copy the unified config template:
  ```bash
  cp config.example.json config.json
  ```
3. Fill in required values in `.env`:
  - Database connection (`GRADESYNC_DATABASE_URL` or `POSTGRES_*`)
  - Third-party credentials (`GRADESCOPE_*`, `PL_API_TOKEN`, `ICLICKER_*`)
4. Fill in required values in `config.json`:
  - `gradeview.googleconfig.oauth.clientid`: OAuth client ID used to verify tokens
  - `gradeview.admins`: global admin emails
  - `gradesync.courses[]`: each course is split into:
    - `general`: base metadata + role lists (`instructors`, `tas`, `admins`)
    - `gradesync`: sync sources, database behavior, sync-side category mapping
    - `gradeview`: UI-side buckets and display category mapping
  - `gradesync.courses[].gradesync.sources`: per-course source settings (`gradescope`, `prairielearn`, `iclicker`)
  - `gradesync.courses[].gradesync.database`: whether to sync to DB and use it as primary
  - `gradesync.courses[].gradesync.assignment_categories`: mapping patterns for sync rollups
  - `gradesync.courses[].gradeview.buckets`: grading display bins/caps
  - `gradesync.global_settings`: retry/log and export settings
5. If using the dev compose with Cloud SQL Proxy:
   - Place your Google service account key at `secrets/key.json`.
   - Set `INSTANCE_CONNECTION_NAME` in `.env`.

## Running with Docker

- Development-like stack:
  ```bash
  docker compose -f docker-compose.dev.yml up --build
  ```

- One-command health check (services + recent logs):
  ```bash
  docker compose -f docker-compose.dev.yml ps && docker compose -f docker-compose.dev.yml logs --tail=60 api web gradesync
  ```

- Production-like stack:
  ```bash
  docker compose -f docker-compose.yml up --build
  ```

## Cloud deployment (CI/CD)

- The deploy workflow now builds and pushes images in GitHub Actions, then the GCE VM only runs `pull + up`.
- This reduces VM CPU/RAM pressure and avoids slow in-place builds on the cloud host.
- Images are tagged with commit SHA and deployed as immutable versions.

Required GitHub secrets for deployment:
- `GCP_SA_KEY`, `GCP_PROJECT_ID`, `GCP_ZONE`, `GCE_INSTANCE`, `GCE_SSH_USER`
- `GHCR_USERNAME`, `GHCR_TOKEN` (for pulling private GHCR images on the VM)

Notes:
- Registry base path used by workflow: `ghcr.io/<org>/gradeview`
- Services in `docker-compose.yml` are configured for stable runtime (health checks + log rotation, no dev bind mounts)

## Common ports

- Web UI: 3000
- API: 8000
- Progress Report: 8080

## Documentation by feature

- Documentation hub: `docs/README.md`
- Database: `docs/features/database.md`
- Auth & IAM: `docs/features/auth-and-iam.md`
- Config & Settings: `docs/features/config-and-settings.md`
- GradeSync: `docs/features/gradesync.md`
- Dev & Deployment: `docs/features/dev-and-deploy.md`

## Troubleshooting

- If login fails, confirm the account is `@berkeley.edu` and listed in `gradeview.admins` or the target course `admins` list.
- For DB connection issues, confirm Cloud SQL Proxy settings and `POSTGRES_*` values.

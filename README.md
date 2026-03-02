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
  api/config/default.example.json # API config template
  gradesync/config.example.json # GradeSync config template
```

## Key services

- **Web UI**: React app served by the web container.
- **API**: Node.js server for authentication and grade data access.
- **GradeSync**: FastAPI service to sync grades from external sources.
- **Progress Report**: Python service for report generation.
- **Cloud SQL Proxy** (dev compose): Connects to a Cloud SQL instance.

## Authentication notes

- Only `@berkeley.edu` accounts can authenticate (enforced by Google token domain check).
- Admins are defined in `api/config/default.json` under `admins`.

## Configuration

1. Copy the environment template:
   ```bash
   cp .env.example .env
   ```
2. Copy the API config template:
  ```bash
  cp api/config/default.example.json api/config/default.json
  ```
3. Copy the GradeSync config template:
  ```bash
  cp gradesync/config.example.json gradesync/config.json
  ```
4. Fill in required values in `.env`:
  - Database connection (`GRADESYNC_DATABASE_URL` or `POSTGRES_*`)
  - Third-party credentials (`GRADESCOPE_*`, `PL_API_TOKEN`, `ICLICKER_*`)
5. Fill in required values in `api/config/default.json`:
  - `googleconfig.oauth.clientid`: OAuth client ID used to verify tokens
  - `admins`: list of admin emails
6. Fill in required values in `gradesync/config.json`:
  - `courses`: course metadata and source system settings
  - `sources`: per-course source settings (`gradescope`, `prairielearn`, `iclicker`)
  - `database`: whether to sync to DB and use it as primary
  - `assignment_categories`: mapping patterns for category rollups
  - `global_settings`: retry/log and export settings
7. If using the dev compose with Cloud SQL Proxy:
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

## Troubleshooting

- If login fails, confirm the account is `@berkeley.edu` and listed in `admins` (for admin routes).
- For DB connection issues, confirm Cloud SQL Proxy settings and `POSTGRES_*` values.

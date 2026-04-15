# GradeView

GradeView is a multi-service grade management platform for university courses. It provides a React web dashboard, a Node.js API, a Python/FastAPI grade-sync engine (GradeSync), and an Nginx reverse proxy. Grades are pulled automatically from Gradescope, PrairieLearn, and iClicker, then stored in PostgreSQL for display and reporting.

> **Handover note:** This repository is the canonical source for both the GradeView web application and the GradeSync data pipeline. Everything you need to run, configure, and deploy the system is in this repository.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Repository Layout](#repository-layout)
3. [Prerequisites](#prerequisites)
4. [Quick-start (local Dev)](#quick-start-local-dev)
5. [Environment Variables Reference](#environment-variables-reference)
6. [Config File Reference (`config.json`)](#config-file-reference-configjson)
7. [Database Setup](#database-setup)
8. [Running the Stack](#running-the-stack)
9. [Production Deployment (GCP)](#production-deployment-gcp)
10. [HTTPS / TLS Setup](#https--tls-setup)
11. [IAM & Authentication Model](#iam--authentication-model)
12. [Makefile Reference](#makefile-reference)
13. [Further Docs](#further-docs)

---

## Architecture Overview

```
Browser
  │
  ▼
Nginx (reverseProxy)  :80/:443
  ├── /           → React Web UI  (gradeview-web  :3000)
  ├── /api        → Node.js API   (gradeview-api  :8000)
  └── /gradesync/ → FastAPI       (gradeview-gradesync :8000)
                          │
                          ▼
                    PostgreSQL  (via Cloud SQL Proxy or direct)
                          ▲
               GradeSync crawlers
          Gradescope / PrairieLearn / iClicker
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full component breakdown and data-flow diagram.

---

## Repository Layout

```
.
├── api/                    # Node.js API server (auth + grade queries)
├── website/                # React web UI + lightweight Node static server
├── gradesync/              # FastAPI grade-sync service
├── reverseProxy/           # Nginx config template
├── scripts/                # Utility and deploy scripts
├── docs/                   # All project documentation
│   ├── features/           # Feature-level docs (auth, config, DB, etc.)
│   └── database/           # DB schema, migrations, query playbook
├── docker-compose.yml      # Production compose (Cloud SQL Proxy + healthchecks)
├── docker-compose.dev.yml  # Dev compose (hot-reload, exposes debug ports)
├── Makefile                # Common task shortcuts
├── config.example.json     # Template for the unified runtime config
└── .env.example            # Template for all environment variables
```

---

## Prerequisites

| Tool | Minimum version | Purpose |
|------|----------------|---------|
| Docker + Docker Compose | 24+ / v2 plugin | Run all services |
| Node.js | 18+ | Local frontend dev (optional) |
| Python | 3.11+ | Local GradeSync dev (optional) |
| `gcloud` CLI | latest | GCP deploy only |
| `psql` | 14+ | DB migrations (optional, can use Docker) |

> For local development you only need **Docker**. Node.js and Python are only required if you want to run services outside Docker.

---

## Quick-start (local Dev)

```bash
# 1. Clone the repo
git clone https://github.com/AFA-Tooling/Gradeview-new.git gradeview
cd gradeview

# 2. Copy config templates
cp .env.example .env
cp config.example.json config.json

# 3. Fill in credentials (see sections below for every field)
#    Minimum required before first boot:
#      - POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB
#        (or set DATABASE_URL for GradeSync; this repo's compose files work with POSTGRES_* + DATABASE_URL)
#        (set GRADESYNC_DATABASE_URL only for API environments that explicitly read that variable name)
#      - JWT_SECRET  (any long random string, e.g. `openssl rand -hex 32`)
#      - Google OAuth client ID stored in gradeview_config.google_oauth_client_id
#        (set config.json at gradeview.googleconfig.oauth.clientid, then run `npm run migrateConfigToDb`)
#      - INSTANCE_CONNECTION_NAME + secrets/key.json  (if using Cloud SQL)

# 4. For Cloud SQL dev: place your GCP service account key
mkdir -p secrets
cp /path/to/your-key.json secrets/key.json

# 5. Start the full dev stack
docker compose -f docker-compose.dev.yml up --build

# 6. Initialize runtime config rows in DB (required for Google OAuth login)
docker compose -f docker-compose.dev.yml exec api npm run migrateConfigToDb

# 7. Open http://localhost in your browser
```

> **Local Postgres alternative:** If you do not have a Cloud SQL instance, start a local Postgres container (see [docs/database/LOCAL_POSTGRES_DEV.md](docs/database/LOCAL_POSTGRES_DEV.md)) and skip `secrets/key.json`. Comment out the `cloud-sql-proxy` service in `docker-compose.dev.yml` and point `POSTGRES_HOST` at your local container.

---

## Environment Variables Reference

Copy `.env.example` to `.env` at the repository root and fill in every value. Below is the complete reference.

### Service Ports

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `8000` | Port the Node.js API binds to inside its container. Also used by the healthcheck and Nginx upstream. |
| `REACT_APP_PORT` | `3000` | Port the React dev server (or static server in prod) binds to. |
| `PROGRESS_REPORT_PORT` | `8080` | Port the progress report service uses (if deployed). |
| `REVERSE_PROXY_LISTEN` | `0.0.0.0:80` | Address Nginx listens on. Change to `0.0.0.0:443` after TLS is configured. |

### React / Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `REACT_APP_PROXY_SERVER` | `http://api:${API_PORT}` | URL the React app uses to reach the API. In Docker this is the internal service name. In local dev outside Docker set to `http://localhost:8000`. |
| `FAST_REFRESH` | `true` | Enables React Fast Refresh for hot-reloading during development. |

### Authentication

| Variable | Required | Description |
|----------|----------|-------------|
| `JWT_SECRET` | **Yes** | Secret key used to sign and verify JWT permission-snapshot tokens. Use a long random value: `openssl rand -hex 32`. **Never share or commit this value.** |
| `JWT_EXPIRES_IN` | `12h` | How long a JWT remains valid. Accepts values like `12h`, `1d`, `7d`. |

### Database

Provide either a full DB URL or the individual `POSTGRES_*` variables. The full URL takes precedence when both are set.

| Variable | Example | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/gradesync` | Full PostgreSQL DSN used by the GradeSync service. |
| `GRADESYNC_DATABASE_URL` | `postgresql://user:pass@host:5432/gradesync` | Full PostgreSQL DSN used by API code paths that expect this variable name. |
| `POSTGRES_HOST` | `cloud-sql-proxy` | Hostname/IP of the Postgres server. Inside Docker use the service name `cloud-sql-proxy` (or `localhost` when port-forwarding). |
| `POSTGRES_PORT` | `5432` | Postgres port. The Cloud SQL Proxy container listens on `5432` internally; it is mapped to `5433` on the host in dev compose to avoid collisions. |
| `POSTGRES_USER` | `postgres` | Database username. |
| `POSTGRES_PASSWORD` | — | Database password. Use a strong random value in production. |
| `POSTGRES_DB` | `gradesync` | Database name. |

### Cloud SQL Proxy (GCP only)

| Variable | Example | Description |
|----------|---------|-------------|
| `INSTANCE_CONNECTION_NAME` | `my-project:us-central1:gradeview-db` | Cloud SQL instance connection name. Find it in GCP Console → SQL → your instance → Overview. Required only when the `cloud-sql-proxy` service is used. |

> The service account key file must be placed at `secrets/key.json` (path is volume-mounted into the proxy container). This directory is gitignored — never commit credentials.

### GradeSync — External Data Sources

| Variable | Description |
|----------|-------------|
| `GRADESCOPE_EMAIL` | Instructor/TA Gradescope account email. GradeSync logs in as this user to scrape grades. |
| `GRADESCOPE_PASSWORD` | Password for the Gradescope account above. |
| `PL_API_TOKEN` | PrairieLearn API token. Get it from PrairieLearn → Settings → API Tokens. |
| `ICLICKER_USERNAME` | iClicker instructor account username. |
| `ICLICKER_PASSWORD` | iClicker instructor account password. |

### Nginx

| Variable | Default | Description |
|----------|---------|-------------|
| `NGINX_SERVER_NAME` | `gradeview.eecs.berkeley.edu` | The `server_name` directive in Nginx. Change to your actual domain in production. |

---

## Config File Reference (`config.json`)

Copy `config.example.json` to `config.json` at the repository root. In the current Compose setup this file is mounted read-only into the GradeSync container (`/app/config.json`). If the API must consume runtime config from this file, also mount it into the API container at `/api/config.json`.

### Top-level structure

```jsonc
{
  "gradeview": { ... },   // Auth and UI configuration
  "gradesync":  { ... }   // Per-course sync configuration + global settings
}
```

---

### `gradeview` section

```jsonc
"gradeview": {
  "googleconfig": {
    "oauth": {
      "clientid": "YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com"
      // Google OAuth 2.0 client ID used to verify ID tokens from the browser.
      // Create this in Google Cloud Console → APIs & Services → Credentials.
      // The authorized JavaScript origins must include your deployment domain.
    }
  },
  "admins": [
    "admin@berkeley.edu"
    // List of email addresses that have super-admin access to the entire platform.
    // These users bypass course-level permission checks.
    // Only @berkeley.edu addresses can log in (enforced at token verification).
  ]
}
```

---

### `gradesync.courses[]` entries

Each entry has three sub-objects: `general`, `gradesync`, and `gradeview`.

#### `general` — course identity and staff lists

```jsonc
{
  "id": "cs10_fa25",              // Unique internal course identifier (snake_case)
  "name": "CS10: The Beauty and Joy of Computing",
  "department": "COMPSCI",
  "course_number": "10",
  "semester": "Fall",             // "Fall" | "Spring" | "Summer"
  "year": 2025,
  "instructor": "Dan Garcia",     // Display name only
  "admins": ["instructor@berkeley.edu"],
    // Course-level admins: can manage GradeSync and course config
  "instructors": [],              // Instructors: can view class/student data
  "tas": []                       // TAs: same view permissions as instructors
}
```

#### `gradesync` — data sync configuration

```jsonc
"gradesync": {
  "sources": {
    "gradescope": {
      "enabled": true,
      "course_id": "1098053",       // Gradescope numeric course ID (from the URL)
      "sync_interval_hours": 24     // How often GradeSync auto-pulls (0 = manual only)
    },
    "prairielearn": {
      "enabled": false,
      "course_id": "192475"         // PrairieLearn course ID
    },
    "iclicker": {
      "enabled": false,
      "course_names": [             // Exact iClicker course names as they appear in the portal
        "[CS10 | Fa25] Discussion",
        "[CS10 | Fa25] Lab",
        "[CS10 | Fa25] Lecture"
      ]
    }
  },
  "database": {
    "enabled": true,          // Write synced grades to PostgreSQL
    "use_as_primary": true    // Use DB as the authoritative source (vs. live API calls)
  },
  "assignment_categories": [
    // GradeSync uses these patterns to classify assignments before writing to DB.
    // Each assignment title is matched (substring, case-insensitive) against `patterns`.
    // First match wins.
    { "name": "Attendance / Participation", "patterns": ["Lecture Quiz", "Discussion"] },
    { "name": "Labs",     "patterns": ["Lab"] },
    { "name": "Projects", "patterns": ["Project"] },
    { "name": "Quest",    "patterns": ["Quest"] },
    { "name": "Midterm",  "patterns": ["Midterm"] },
    { "name": "Postterm", "patterns": ["Postterm"] }
  ]
}
```

#### `gradeview` — display and grading scale

```jsonc
"gradeview": {
  "buckets": {
    "total_points_cap": 400,
    "rounding_policy": "Total points are rounded to nearest integer before letter-grade lookup.",
    "component_percentages": [
      // Display weights shown in the grade breakdown UI.
      // Must sum to 100.
      { "component": "Attendance / Participation", "percentage": 3.75 },
      { "component": "Labs",     "percentage": 20 },
      { "component": "Projects", "percentage": 38.75 },
      { "component": "Quest",    "percentage": 6.25 },
      { "component": "Midterm",  "percentage": 12.5 },
      { "component": "Postterm", "percentage": 18.75 }
    ],
    "grade_bins": [
      // Letter-grade cutoffs (lower bound inclusive, upper bound exclusive).
      { "grade": "A+", "range": "390-400" },
      { "grade": "A",  "range": "370-390" },
      { "grade": "A-", "range": "360-370" },
      // ... extend as needed
      { "grade": "F",  "range": "0-240" }
    ],
    "grading_breakdown": [
      // Per-assignment point values for the grade calculator.
      { "assignment": "Quest",    "points": 25 },
      { "assignment": "Midterm",  "points": 50 },
      { "assignment": "Postterm", "points": 75 }
      // ... add every graded item
    ]
  },
  "assignment_categories": [
    // Display-side category mapping for the UI grade view.
    // Usually mirrors gradesync.assignment_categories.
    { "name": "Labs", "patterns": ["Lab"] }
    // ...
  ]
}
```

---

### `gradesync.global_settings`

```jsonc
"global_settings": {
  "retry_attempts": 3,       // Number of retries on sync failure
  "log_level": "INFO",       // "DEBUG" | "INFO" | "WARNING" | "ERROR"
  "export_enabled": false    // Enable CSV export endpoint
}
```

---

## Database Setup

GradeView uses a single PostgreSQL database for both the API and GradeSync.

### Apply the canonical schema (first-time setup)

```bash
# Using psql directly (replace connection string as needed)
psql "postgresql://USER:PASSWORD@HOST:PORT/DB" -f docs/database/schema.sql

# Or apply migrations one by one (idempotent)
psql "..." -f gradesync/api/migrations/001_add_users_and_config_tables.sql
psql "..." -f gradesync/api/migrations/002_students_per_course.sql
psql "..." -f gradesync/api/migrations/003_exam_policy_tables.sql
psql "..." -f gradesync/api/migrations/add_summary_sheet_table.sql
```

### Local isolated Postgres (recommended for development)

```bash
docker run --name gradeview-postgres-dev \
  -e POSTGRES_USER=gradeview_dev \
  -e POSTGRES_PASSWORD=gradeview_dev_pw \
  -e POSTGRES_DB=gradeview_dev \
  -p 55432:5432 \
  -v gradeview_pgdata_dev:/var/lib/postgresql/data \
  -d postgres:16
```

Then set in your `.env`:
```env
POSTGRES_HOST=localhost
POSTGRES_PORT=55432
POSTGRES_USER=gradeview_dev
POSTGRES_PASSWORD=gradeview_dev_pw
POSTGRES_DB=gradeview_dev
GRADESYNC_DATABASE_URL=postgresql://gradeview_dev:gradeview_dev_pw@localhost:55432/gradeview_dev
```

See [docs/database/LOCAL_POSTGRES_DEV.md](docs/database/LOCAL_POSTGRES_DEV.md) for full isolation guidelines.

---

## Running the Stack

### Mode 1 — Full Docker dev stack (recommended for onboarding)

All services run in Docker with hot-reload and ports exposed for debugging.

```bash
docker compose -f docker-compose.dev.yml up --build
```

| Container | Host port | Description |
|-----------|-----------|-------------|
| `gradeview-reverse-proxy` | `80` | Nginx entry point |
| `gradeview-web` | `3000` | React dev server |
| `gradeview-api` | *(internal)* | Node.js API |
| `gradeview-gradesync` | `8001` | FastAPI GradeSync |
| `gradeview-cloud-sql-proxy` | `5433` | Cloud SQL tunnel |

```bash
# Tail logs
docker compose -f docker-compose.dev.yml logs -f api web gradesync
```

### Mode 2 — Local frontend + Docker backend

Run the API and GradeSync in Docker. Run the React dev server natively for the fastest reload cycle.

```bash
./scripts/dev-local.sh
# or: make dev-local
```

This script:
1. Starts `cloud-sql-proxy` and `gradesync` in Docker.
2. Starts the Node.js API on host port `8000` (connecting to the proxy via `localhost:5433`).
3. Starts the React dev server on host port `3000`.

### Stopping the stack

```bash
docker compose -f docker-compose.dev.yml down
# or
make dev-down
```

---

## Production Deployment (GCP)

### Infrastructure assumptions

- **Compute**: GCE VM (e2-standard-4 or larger), Ubuntu 22.04 LTS.
- **Database**: Cloud SQL for PostgreSQL (same GCP project).
- **Domain**: A DNS A-record pointing to the VM's external IP.
- **CI/CD**: GitHub Actions builds and pushes Docker images; the VM only pulls and re-runs.

### Step 1 — Provision infrastructure

```bash
# Create the VM (one-time)
bash scripts/deploy_to_gcp.sh eecs-gradeview us-central1
```

Or provision manually in GCP Console. The VM needs:
- Access scope: `cloud-platform` (so the Cloud SQL Proxy service account key works).
- Firewall rules: open TCP 80, 443 from `0.0.0.0/0`.

### Step 2 — SSH into the VM and clone the repo

```bash
gcloud compute ssh gradeview-app --project=eecs-gradeview --zone=us-central1-a
cd /opt
git clone https://github.com/AFA-Tooling/Gradeview-new.git gradeview
cd gradeview
```

### Step 3 — Configure secrets and config

```bash
# Create the .env file
cp .env.example .env
nano .env          # Fill in every variable (see Environment Variables Reference above)

# Create config.json
cp config.example.json config.json
nano config.json   # Fill in OAuth client ID, admins, and course entries

# Place the GCP service account key
mkdir -p secrets
# Upload key.json via scp or Secret Manager, then:
cp /path/to/key.json secrets/key.json
chmod 600 secrets/key.json
```

### Step 4 — Apply database migrations

```bash
# Connect to Cloud SQL via the proxy (already in docker-compose.yml)
docker compose up -d cloud-sql-proxy
sleep 5

# Apply schema (first deploy only)
docker run --rm --network=db --env-file .env \
  postgres:16 \
  sh -c 'psql -h cloud-sql-proxy -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /dev/stdin' \
  < docs/database/schema.sql
```

### Step 5 — Build and start production stack

```bash
docker compose up -d --build
```

Or (CI/CD model, recommended): tag and push images from GitHub Actions, then on the VM:

```bash
docker compose pull   # pulls pre-built images
docker compose up -d
```

### Step 6 — Verify

```bash
# Run the full preflight check (builds → starts → health checks → smoke tests)
make preflight

# Or manually:
curl -fs http://localhost/api/health
curl -fs http://localhost/
```

### Step 7 — Set up automatic restarts

```bash
# Docker already uses restart: unless-stopped.
# Optionally add a systemd service or cron to run `docker compose pull && docker compose up -d`
# nightly for automated image updates.
```

---

## HTTPS / TLS Setup

The Nginx config template supports Let's Encrypt. After obtaining certificates:

```bash
# On the VM, install certbot
sudo apt install certbot

# Obtain certificate (standalone, stop nginx first)
sudo certbot certonly --standalone -d gradeview.eecs.berkeley.edu

# Certificates will be at /etc/letsencrypt/live/gradeview.eecs.berkeley.edu/
# The production compose mounts /etc/letsencrypt read-only into the Nginx container.
```

Then uncomment the HTTPS server block in `reverseProxy/default.conf.template` and redeploy.

Set `REVERSE_PROXY_LISTEN=0.0.0.0:443` in `.env` if you want Nginx to only serve HTTPS (add a separate HTTP→HTTPS redirect block as needed).

---

## IAM & Authentication Model

### Login flow

1. User clicks "Sign in with Google" → browser gets a Google ID token.
2. Frontend sends the token to `POST /api/v2/login`.
3. API verifies the token with Google's public keys and rejects any non-`@berkeley.edu` email.
4. API looks up the user in `users` and `course_permissions` tables to determine role.
5. API returns a short-lived JWT. All subsequent requests carry this JWT in `Authorization: Bearer <token>`.

### Roles

| Role | Scope | Permissions |
|------|-------|-------------|
| `super_admin` | Global | Full access to all courses, settings, and GradeSync admin UI. Defined by the `SUPER_ADMIN_EMAIL` constant in `api/lib/iam.mjs` (not by config.json role lists). This is a current implementation limitation: changing it requires a code change + redeploy. |
| `course_admin` | Per-course | Manage GradeSync sync jobs and course config for their bound courses. |
| `instructor` | Per-course | View class roster and grade data. Cannot access GradeSync admin. |
| `ta` | Per-course | Same view permissions as instructor. |
| `student` | Per-course | View own grades only, scoped to enrolled courses. |

Permissions for `course_admin`, `instructor`, `ta`, and `student` are enforced primarily via the `users` and `course_permissions` database tables (with student enrollment checks against `students`). Config file role lists (`admins`, `instructors`, `tas`) are migration inputs only and do not grant runtime permissions by themselves. `super_admin` access remains controlled separately by the hard-coded `SUPER_ADMIN_EMAIL`.

---

## Makefile Reference

```bash
make init            # docker compose build (dev)
make dev-up          # docker compose -f docker-compose.dev.yml up -d
make dev-down        # docker compose -f docker-compose.dev.yml down
make dev-local       # run API/web natively, deps in Docker
make dev-logs        # tail dev stack logs
make refresh         # run scripts/refresh.sh (pull + restart)
make preflight       # full production smoke-test (build → health → curl)
make preflight-down  # tear down production stack after preflight
make logs            # tail production stack logs
make clean           # remove all containers and images (destructive!)
make rebuild         # clean + docker default build
```

---

## Further Docs

| Document | What it covers |
|----------|---------------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Full component breakdown, data flow diagrams |
| [docs/features/auth-and-iam.md](docs/features/auth-and-iam.md) | Auth middleware, token flow, IAM source files |
| [docs/features/config-and-settings.md](docs/features/config-and-settings.md) | Config loading logic, stability rules |
| [docs/features/gradesync.md](docs/features/gradesync.md) | GradeSync architecture, sync service source files |
| [docs/features/dev-and-deploy.md](docs/features/dev-and-deploy.md) | Dev environment rules, compose variants |
| [docs/features/database.md](docs/features/database.md) | Index into all database docs |
| [docs/database/README.md](docs/database/README.md) | Schema overview, table relationships |
| [docs/database/MIGRATIONS.md](docs/database/MIGRATIONS.md) | Migration naming, authoring, and rollout rules |
| [docs/database/QUERIES_AND_INDEXES.md](docs/database/QUERIES_AND_INDEXES.md) | High-frequency SQL patterns and required indexes |
| [docs/database/AUDIT_AND_RECOVERY.md](docs/database/AUDIT_AND_RECOVERY.md) | Config audit log and disaster recovery runbook |
| [docs/database/LOCAL_POSTGRES_DEV.md](docs/database/LOCAL_POSTGRES_DEV.md) | Isolated local Postgres setup for dev |
| [gradesync/DEMO_COURSE_README.md](gradesync/DEMO_COURSE_README.md) | Creating synthetic demo course data |

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

- If login fails, confirm the account is `@berkeley.edu` and has DB permissions in `users` + `course_permissions`.
- For DB connection issues, confirm Cloud SQL Proxy settings and `POSTGRES_*` values.

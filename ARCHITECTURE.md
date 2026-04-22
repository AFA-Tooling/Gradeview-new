# GradeView — Architecture Reference

## Overview

GradeView is a multi-service grade management platform consisting of five runtime services:

| Service | Stack | Role |
|---------|-------|------|
| `gradeview-reverse-proxy` | Nginx | TLS termination, request routing |
| `gradeview-web` | React + Node static server | Student/instructor web UI |
| `gradeview-api` | Node.js (Express) | Auth, grade queries, IAM enforcement |
| `gradeview-gradesync` | Python (FastAPI) | Grade ingestion from Gradescope / PrairieLearn / iClicker |
| `gradeview-cloud-sql-proxy` | Cloud SQL Proxy | Authenticated tunnel to GCP Cloud SQL |

All services are defined in `docker-compose.yml` (production) and `docker-compose.dev.yml` (development).

---

## Documentation Hub

- Auth & IAM: `docs/features/auth-and-iam.md`
- Config & Settings: `docs/features/config-and-settings.md`
- GradeSync: `docs/features/gradesync.md`
- Database: `docs/features/database.md`
- Dev & Deployment: `docs/features/dev-and-deploy.md`

---

## Data Flow Diagram

```
Browser
  │  (HTTPS)
  ▼
┌───────────────────────────┐
│  Nginx Reverse Proxy      │  :80 / :443
│  reverseProxy/            │
└───────┬───────────┬───────┘
        │           │
  GET / │           │ GET /api/*
        ▼           ▼
  ┌──────────┐  ┌──────────────────┐
  │ React UI │  │  Node.js API     │   GET /gradesync/*
  │ website/ │  │  api/            │◄───────────────────┐
  └──────────┘  └────────┬─────────┘                    │
                         │ SQL queries                   │
                         ▼                               │
               ┌─────────────────┐             ┌─────────────────┐
               │   PostgreSQL    │◄────────────│  FastAPI        │
               │   (Cloud SQL)   │  grade      │  GradeSync      │
               └─────────────────┘  writes     └────────┬────────┘
                                                        │ HTTP/scrape
                                              ┌─────────┴──────────┐
                                              │  External Systems  │
                                              │  · Gradescope      │
                                              │  · PrairieLearn    │
                                              │  · iClicker        │
                                              └────────────────────┘
```

---

## Directory Breakdown

### `api/` — Node.js API Server

Entry point: `api/server.js`  
Route registration: `api/Router.js`

```
api/
├── server.js              # Express app init, middleware, port binding
├── Router.js              # Mounts versioned routes
├── config/
│   └── default.json       # Service-level config (port, DB pool, etc.)
├── lib/
│   ├── authlib.mjs        # validateAdminMiddleware / validateStudentMiddleware
│   ├── googleAuthHelper.mjs  # Verifies Google ID tokens, checks @berkeley.edu
│   ├── jwtAuth.mjs        # Signs/verifies permission-snapshot JWTs
│   ├── iam.mjs            # Permission check helpers (course-scoped)
│   ├── userlib.mjs        # Resolves user role from DB or config
│   ├── dbHelper.mjs       # pg pool + parameterized query helpers
│   ├── studentHelper.mjs  # Student grade query logic
│   ├── unifiedConfig.mjs  # Loads and caches repository-root config.json
│   ├── uploadHandler.mjs  # Multipart file upload (multer)
│   └── logger.mjs         # Structured logger (pino / winston)
└── v2/
    └── Routes/
        ├── login/         # POST /api/v2/login — verify token, return JWT
        ├── isadmin/       # GET  /api/v2/isadmin — check admin status
        ├── admin/         # Admin-only grade management routes
        ├── students/      # Student grade read routes
        ├── bins/          # Grade bin / bucket display data
        ├── config/        # Course config read/write endpoints
        └── verifyaccess/  # Permission check endpoint
```

**Authentication flow:**
1. `POST /api/v2/login` receives a Google ID token from the browser.
2. `googleAuthHelper.mjs` verifies the token with Google's public keys and checks the `hd` (hosted domain) field — only `berkeley.edu` tokens are accepted.
3. `userlib.mjs` queries `users` + `course_permissions` tables to resolve the user's role.
4. A short-lived JWT is returned. All subsequent API calls must carry `Authorization: Bearer <jwt>`.
5. Route middleware runs `validateAdminMiddleware` or `validateStudentMiddleware` on every protected endpoint.

---

### `website/` — React Web UI

```
website/
├── server/                # Node.js Express server — serves the built React app and
│   ├── index.js           # proxies /api/* to the API container
│   └── middleware.js      # Request logging, security headers
├── src/
│   ├── App.js             # Root React component, routing
│   ├── views/             # Page-level components (dashboard, grades view, admin)
│   ├── components/        # Shared UI components
│   ├── services/          # API client functions (fetch wrappers)
│   └── utils/             # Formatting helpers, grade calculators
└── public/                # Static assets, index.html
```

In development (`docker-compose.dev.yml`) the React dev server runs with hot-reload via `npm run react`. In production (`docker-compose.yml`) the pre-built static bundle is served by the Node server.

---

### `gradesync/` — Grade Sync Service (FastAPI)

Entry point: `gradesync/api/app.py`

```
gradesync/
├── api/
│   ├── app.py             # FastAPI app factory, route registration, lifespan
│   ├── config_manager.py  # Loads config.json (mounted at /app/config.json)
│   ├── schemas.py         # Pydantic request/response models
│   ├── core/
│   │   ├── db.py          # SQLAlchemy engine + session factory
│   │   ├── models.py      # ORM models (courses, students, assignments, submissions…)
│   │   ├── ingest.py      # Core grade ingestion logic
│   │   ├── ingest_optimized.py  # Bulk-upsert path for large courses
│   │   └── exam_policy.py # Exam drop/bonus policy engine
│   ├── services/          # One module per external source
│   │   ├── gradescope.py  # Gradescope login + grade scraper
│   │   ├── prairielearn.py# PrairieLearn REST API client
│   │   └── iclicker.py    # iClicker session + attendance sync
│   ├── sync/              # Orchestration layer
│   │   └── service.py     # Schedules and runs per-course sync jobs
│   ├── queries/
│   │   └── summary.py     # Summary sheet materialization queries
│   └── migrations/        # Numbered SQL migration files
└── scripts/               # DB backfill and validation scripts
```

**Sync flow:**
1. `sync/service.py` reads the course list from `config.json`.
2. For each course whose sources are `enabled`, it calls the corresponding service module.
3. Fetched grades are normalized into `assignments` + `submissions` rows.
4. `assignment_categories` patterns in `config.json` classify each assignment.
5. Bulk upsert writes to PostgreSQL.
6. `summary_sheets` table is refreshed for fast grade-view reads.

---

### `reverseProxy/` — Nginx

```
reverseProxy/
└── default.conf.template  # Envsubst template; NGINX_SERVER_NAME is injected at container start
```

Routing rules:
- `/` → `http://gradeview-web:3000`
- `/api` → `http://gradeview-api:${API_PORT}`
- `/gradesync/` → `http://gradeview-gradesync:8000/`

The HTTPS server block is present but commented out. Enable it after provisioning TLS certificates (see `README.md` → HTTPS / TLS Setup).

---

### `scripts/`

| Script | Purpose |
|--------|---------|
| `dev-local.sh` | Starts deps in Docker, runs API and web server natively |
| `preflight.sh` | Full production smoke-test (build → healthcheck → curl) |
| `refresh.sh` | Pull latest images + restart production stack |
| `deploy_to_gcp.sh` | One-shot GCE VM provisioning script |
| `lib/common.sh` | Shared shell helpers (port checks, logging) |

---

## Database Schema Summary

Full DDL: `docs/database/schema.sql`  
ORM models: `gradesync/api/core/models.py`  
Migrations: `gradesync/api/migrations/`

| Table | Purpose |
|-------|---------|
| `users` | Platform identities (staff, admins). Source of truth for role. |
| `courses` | Course tenant boundary. Unique on `gradescope_course_id`. |
| `course_permissions` | Per-course role mapping (`owner`/`editor`/`viewer`). |
| `students` | Course-scoped student identities. `(email, course_id)` unique. |
| `assignments` | Assignment metadata per course. |
| `submissions` | Student scores per assignment. `(assignment_id, student_id)` unique. |
| `summary_sheets` | Precomputed per-student-per-assignment summaries for fast reads. |
| `course_configs` | Per-course sync configuration (mirrors and extends config.json sync fields). |
| `assignment_categories` | Per-course category rules (name → pattern list). |
| `system_config` | Global key-value config store. |
| `config_audit_log` | Write-audit trail for every config mutation. |

**Tenant isolation rule:** Every query on grade or student data must carry a `course_id` scope. Cross-course reads are forbidden unless the caller is `super_admin`.

---

## Key Workflows

### 1. User Login and Permission Resolution

```
Browser
  │ (1) Click "Sign in with Google" → receive Google ID token
  ▼
POST /api/v2/login  { token }
  │ (2) googleAuthHelper: verify token, check hd === "berkeley.edu"
  │ (3) userlib: SELECT from users + course_permissions
  │ (4) build permission snapshot
  ▼
Return JWT (12h expiry)
  │
  │ (5) All subsequent requests: Authorization: Bearer <jwt>
  ▼
Route middleware: validateAdminMiddleware / validateStudentMiddleware
  │ validates JWT signature, evaluates permission snapshot, enforces course scope
  ▼
Handler returns data or 403
```

### 2. Grade Sync

```
GradeSync scheduled job OR manual POST /gradesync/sync/{course_id}
  │
  ▼ Read config.json → get enabled sources for course
  │
  ├── Gradescope: login session → fetch submissions CSV → parse
  ├── PrairieLearn: REST API call with PL_API_TOKEN
  └── iClicker: login → fetch attendance records
  │
  ▼ Normalize into standard grade rows
  │ Classify by assignment_categories patterns
  │
  ▼ Bulk upsert → assignments, submissions, students tables
  │
  ▼ Refresh summary_sheets
```

### 3. Student Grade View

```
Student browser: GET /api/v2/students/{email}/grades?course_id=XXX
  │
  ▼ validateStudentMiddleware: verify JWT, check enrollment in course
  │
  ▼ studentHelper: query submissions JOIN assignments WHERE student.email = $1 AND course_id = $2
  │
  ▼ API maps raw scores → gradeview.buckets display structure from config.json
  │
  ▼ JSON response → React renders grade breakdown
```

---

## Configuration Architecture

Two configuration surfaces exist:

| Surface | File | Loaded by | Purpose |
|---------|------|-----------|---------|
| Environment variables | `.env` | Docker / OS env | Secrets, ports, DB credentials, third-party API keys |
| Unified runtime config | `config.json` (repo root) | `unifiedConfig.mjs`, `config_manager.py` | OAuth client ID, admin lists, per-course sync and display settings |

`config.json` is mounted read-only into the `gradesync` container. API access to runtime config depends on API image/runtime setup rather than a Compose bind mount. Changes require a container restart; there is no live-reload.

---

## Deployment Topology

### Development (`docker-compose.dev.yml`)

```
Host ports exposed:
  :80    → Nginx (entry point)
  :3000  → React dev server (hot-reload)
  :5433  → Cloud SQL Proxy (host-side DB access)
  :8001  → GradeSync FastAPI (debug)

Source code bind-mounts: api/, website/, gradesync/ → hot-reload via nodemon / uvicorn --reload
```

### Production (`docker-compose.yml`)

```
Host ports exposed:
  :80    → Nginx
  :443   → Nginx (TLS)
  :8001  → GradeSync (optional, can be removed)

No bind-mounts; images are built and pushed by CI.
Healthchecks: all containers use wget/curl checks before dependents start.
Log rotation: json-file driver, max 10 MB × 3 files per service.
```

---

## New Developer Onboarding Checklist

- [ ] Read `README.md` (setup, config, and deploy)
- [ ] Read this file (ARCHITECTURE.md)
- [ ] `cp .env.example .env` and fill in all variables
- [ ] `cp config.example.json config.json` and add at least one course entry
- [ ] Place `secrets/key.json` (GCP service account) if using Cloud SQL
- [ ] `docker compose -f docker-compose.dev.yml up --build`
- [ ] Verify `http://localhost` loads and login works
- [ ] Read `docs/database/README.md` before touching DB queries
- [ ] Read `docs/features/auth-and-iam.md` before touching auth code

# Feature: Dev & Deployment

## Key Files

| File | Purpose |
|------|---------|
| `docker-compose.dev.yml` | Dev stack: bind-mounts, hot-reload, exposed debug ports |
| `docker-compose.yml` | Production stack: healthchecks, log rotation, TLS mounts |
| `Makefile` | Shortcuts for common operations |
| `scripts/dev-local.sh` | Run API + web natively; deps in Docker |
| `scripts/preflight.sh` | Full production smoke-test |
| `scripts/refresh.sh` | Pull latest images + restart |
| `scripts/deploy_to_gcp.sh` | One-shot GCE VM provisioning |

## Local Development — Full Docker Mode

```bash
# First-time setup
cp .env.example .env && cp config.example.json config.json
# (fill in .env and config.json)
docker compose -f docker-compose.dev.yml up --build
```

All source directories are bind-mounted. Node.js services use `nodemon`; FastAPI uses `--reload`. Changes take effect without rebuilding.

```bash
# Tail logs for the main services
make dev-logs
# or
docker compose -f docker-compose.dev.yml logs -f api web gradesync
```

## Local Development — Native Frontend Mode

Faster React hot-reload; API and GradeSync still run in Docker.

```bash
./scripts/dev-local.sh
# or: make dev-local
```

Prerequisites: Node.js 18+ installed on the host. The script checks and frees ports 8000 and 3000 if needed.

## Production Deployment

Full walk-through: `README.md` → **Production Deployment (GCP)**.

Short version:
```bash
# On the production VM
git pull
docker compose pull          # pull pre-built images from CI registry
docker compose up -d         # replace running containers
```

Or run the smoke-test cycle:
```bash
make preflight               # build → start → healthcheck → curl smoke tests
make preflight-down          # tear down after testing
```

## Compose Differences: Dev vs. Prod

| Aspect | Dev (`docker-compose.dev.yml`) | Prod (`docker-compose.yml`) |
|--------|-------------------------------|-----------------------------|
| Source code | Bind-mounted (live edit) | Baked into image |
| Web command | `npm run react` (dev server) | `npm start` (serve built bundle) |
| API command | `npm run dev` (nodemon) | `npm start` |
| Health checks | None | All services (`wget/curl`) |
| Log rotation | None | `json-file` 10 MB × 3 |
| TLS certs | Not mounted | `/etc/letsencrypt` mounted RO |
| Proxy ports | `:80` only | `:80` + `:443` |
| DB proxy host port | `5433` (host) | Internal only |

## Rules

- Dev uses fully isolated local resources — never point `.env` at a production DB.
- Every schema change must be a numbered migration file in `gradesync/api/migrations/` **before** any application code that depends on it is deployed.
- Never use `--force`, `--no-verify`, or `DROP TABLE` in production without a backup snapshot.
- Use `make preflight` to validate production changes before flipping traffic.

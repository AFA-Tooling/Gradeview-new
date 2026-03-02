# Feature: Dev & Deployment

## Local Development

- Main setup: [../../README.md](../../README.md)
- Refresh script: [../../scripts/refresh.sh](../../scripts/refresh.sh)
- Dev compose: [../../docker-compose.dev.yml](../../docker-compose.dev.yml)

## Production-ish Deployment

- Compose: [../../docker-compose.yml](../../docker-compose.yml)
- API Dockerfile: [../../api/Dockerfile](../../api/Dockerfile)
- Web Dockerfile: [../../website/server/Dockerfile](../../website/server/Dockerfile)

## Rule of Thumb

- Dev uses isolated local resources.
- Prod/staging changes must be migration-first and reversible.

-include .env
.DEFAULT_GOAL := docker

init:
	@echo "Initializing project with Docker-only setup..."
	@docker compose -f docker-compose.dev.yml build

dev-up:
	@docker compose -f docker-compose.dev.yml up -d

dev-down:
	@docker compose -f docker-compose.dev.yml down

refresh:
	@docker compose -f docker-compose.dev.yml down
	@docker compose -f docker-compose.dev.yml build --no-cache
	@docker compose -f docker-compose.dev.yml up -d --force-recreate -V

dev-local:
	@bash -c '\
	echo "Starting local frontend/backend with Docker dependencies..."; \
	echo "Checking ports..."; \
	if lsof -Pi :5433 -sTCP:LISTEN -t >/dev/null 2>&1 ; then \
		echo ""; \
		echo "⚠️  Port 5433 is already in use:"; \
		lsof -Pi :5433 -sTCP:LISTEN ; \
		echo "Please free port 5433 (used by cloud-sql-proxy in dev-local mode)."; \
		exit 1; \
	fi; \
	if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then \
		echo ""; \
		echo "⚠️  Port 8000 is already in use:"; \
		lsof -Pi :8000 -sTCP:LISTEN ; \
		read -p "Kill process on port 8000? [y/N] " -n 1 reply; \
		echo ""; \
		if [[ "$$reply" =~ ^[Yy]$$ ]] ; then \
			lsof -Pi :8000 -sTCP:LISTEN -t | xargs kill -9; \
			echo "✓ Killed process on port 8000"; \
		else \
			echo "Aborted."; exit 1; \
		fi \
	fi; \
	if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then \
		echo ""; \
		echo "⚠️  Port 3000 is already in use:"; \
		lsof -Pi :3000 -sTCP:LISTEN ; \
		read -p "Kill process on port 3000? [y/N] " -n 1 reply; \
		echo ""; \
		if [[ "$$reply" =~ ^[Yy]$$ ]] ; then \
			lsof -Pi :3000 -sTCP:LISTEN -t | xargs kill -9; \
			echo "✓ Killed process on port 3000"; \
		else \
			echo "Aborted."; exit 1; \
		fi \
	fi; \
	'
	@echo "1. Stopping dockerized frontend/backend if running..."
	@docker compose -f docker-compose.dev.yml stop reverseProxy web api >/dev/null 2>&1 || true
	@echo "2. Starting Docker dependency services (cloud-sql-proxy + gradesync)..."
	@docker compose -f docker-compose.dev.yml up -d cloud-sql-proxy gradesync
	@echo "3. Waiting for database proxy to be ready..."
	@sleep 5
	@echo "4. Starting local API server on :8000 (DB via localhost:5433)..."
	@cd api && NODE_ENV=development POSTGRES_HOST=localhost POSTGRES_PORT=5433 npm run dev &
	@echo "5. Starting local website dev server on :3000..."
	@cd website && REACT_APP_PROXY_SERVER="http://localhost:8000" npm run react

docker:
	@cd website && npm install && npm run build
	@docker compose build
	@docker compose up -dV

logs:
	@echo "ensure your stack is running to view logs:"
	@echo
	@docker ps
	@echo
	@docker compose logs -f

dev-logs:
	@echo "ensure your dev stack is running to view logs:"
	@echo
	@docker ps
	@echo
	@docker compose -f docker-compose.dev.yml logs -f

clean-containers:
	@docker compose down
	@for container in `docker ps -aq` ; do \
		echo "\nRemoving container $${container} \n========================================== " ; \
		docker rm -f $${container} || exit 1 ; \
	done

clean-images:
	@for image in `docker images -aq` ; do \
		echo "Removing image $${image} \n==========================================\n " ; \
		/usr/local/bin/docker rmi -f $${image} || exit 1 ; \
	done

clean: clean-containers clean-images
	@rm -rf **/__pycache__
	@docker system prune

rebuild: clean docker

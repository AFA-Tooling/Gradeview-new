-include .env
.DEFAULT_GOAL := docker

init:
	@echo "Initializing project with Docker-only setup..."
	@docker compose -f docker-compose.dev.yml build

dev-up:
	@docker compose -f docker-compose.dev.yml up -d --remove-orphans

dev-down:
	@docker compose -f docker-compose.dev.yml down --remove-orphans

refresh:
	@./scripts/refresh.sh

preflight:
	@./scripts/preflight.sh

preflight-down:
	@docker compose -f docker-compose.yml down --remove-orphans

dev-local:
	@./scripts/dev-local.sh

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

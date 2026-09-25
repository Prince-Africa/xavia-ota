.PHONY: dev db check-db migrate db-stop

COMPOSE = docker compose -f ./containers/database/docker-compose.yml

# Start both database and Next.js development server
dev: db check-db migrate
	./node_modules/.bin/next dev -p 3001

# Start Docker Compose in detached mode
db:
	$(COMPOSE) up -d

# Check if database container is healthy
check-db:
	@echo "Waiting for database to be ready..."
	@until $(COMPOSE) ps --status running | grep "healthy"; do \
		echo "Waiting for database..."; \
		sleep 1; \
	done
	@echo "Database is ready!"

migrate:
	$(COMPOSE) exec -T xavia-postgres psql -U postgres -d releases_db -v ON_ERROR_STOP=1 < ./containers/database/migrations/20260925_installation_tracking.sql
	$(COMPOSE) exec -T xavia-postgres psql -U postgres -d releases_db -v ON_ERROR_STOP=1 < ./containers/database/migrations/20260925_release_repository_url.sql

db-stop:
	$(COMPOSE) stop

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
	# Runs all versioned migrations, including 20260926_release_lifecycle.sql.
	POSTGRES_HOST=localhost POSTGRES_PORT=5432 POSTGRES_DB=releases_db POSTGRES_USER=postgres POSTGRES_PASSWORD=postgres node ./scripts/migrate-postgres.js

db-stop:
	$(COMPOSE) stop

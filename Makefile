.DEFAULT_GOAL := help
PYTHON ?= python3
ETL_ARGS ?=

.PHONY: help db db-stop db-migrate db-baseline db-info etl-validate etl backend frontend check-frontend check-etl check-db

help:
	@printf '%s\n' \
	  'make db              Start the development database' \
	  'make db-stop         Stop the database, retaining its volume' \
	  'make db-migrate      Apply backend SQL migrations without starting Spring' \
	  'make db-baseline     Adopt a verified existing V1 schema (CONFIRM_BASELINE=verified-v1)' \
	  'make db-info         Show Flyway migration status' \
	  'make etl-validate    Validate CSV inputs without connecting to a database' \
	  'make etl             Load data (optional ETL_ARGS="--only sales_dong")' \
	  'make backend         Start Spring Boot' \
	  'make frontend        Start Vite (run npm ci in frontend first)' \
	  'make check-frontend  Build and lint React' \
	  'make check-etl       Run ETL regression tests with PYTHON' \
	  'make check-db        Run Spring smoke tests against the populated DB'

db:
	docker compose up -d postgres

db-stop:
	docker compose stop postgres

db-migrate:
	docker compose run --rm db-migrate

db-baseline:
ifneq ($(CONFIRM_BASELINE),verified-v1)
	@printf '%s\n' 'Refusing baseline. Verify the existing DB matches V1, then run with CONFIRM_BASELINE=verified-v1.' >&2
	@exit 1
endif
	docker compose run --rm db-migrate baseline

db-info:
	docker compose run --rm db-migrate info

etl-validate:
	docker compose run --build --rm --no-deps etl --validate-only $(ETL_ARGS)

etl: db-migrate
	docker compose run --build --rm etl $(ETL_ARGS)

backend:
	cd backend && ./gradlew bootRun

frontend:
	npm --prefix frontend run dev

check-frontend:
	npm --prefix frontend run build
	npm --prefix frontend run lint

check-etl:
	cd etl && $(PYTHON) -m unittest discover -s tests -v

check-db:
	cd backend && ./gradlew dbTest

.DEFAULT_GOAL := help
PYTHON ?= python3
ETL_ARGS ?=

.PHONY: help db db-stop db-migrate db-baseline db-info etl-validate etl backend frontend check-frontend check-etl check-db

help:
	@printf '%s\n' \
	  'make db              Prepare the guarded team development pipeline' \
	  'make db-stop         Stop team-postgres, retaining its volume' \
	  'make db-migrate      Refused: use the guarded Compose pipeline' \
	  'make db-baseline     Refused: team development never adopts an existing DB' \
	  'make db-info         Check owned DB READY/version/fingerprint read-only' \
	  'make etl-validate    Verify eight input sizes/SHA without a DB connection' \
	  'make etl             Prepare or verify the same team dataset through Compose' \
	  'make backend         Start Spring Boot' \
	  'make frontend        Start Vite (run npm ci in frontend first)' \
	  'make check-frontend  Build and lint React' \
	  'make check-etl       Run ETL regression tests with PYTHON' \
	  'make check-db        Verify owned team DB READY and fingerprint read-only'

db:
	docker compose up -d

db-stop:
	docker compose stop team-postgres

db-migrate:
	@printf '%s\n' 'Use docker compose up -d: identity → Flyway → ETL is one guarded pipeline.'
	@exit 1

db-baseline:
	@printf '%s\n' 'Team development never baselines or adopts an existing database.' >&2
	@exit 1

db-info:
	$(PYTHON) etl/team_dev.py status

etl-validate:
	$(PYTHON) etl/team_dataset.py validate

etl:
	docker compose up -d

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
	$(PYTHON) etl/team_dev.py status

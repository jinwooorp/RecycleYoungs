.DEFAULT_GOAL := help
PYTHON ?= python3
ETL_ARGS ?=
API_PYTHON ?= $(CURDIR)/etl/.venv/bin/python
API_HOME ?= $(HOME)/.config/recycleyoungs/api-dev
API_INIT_ARGS ?=
API_IMAGES_ARGS ?=

.PHONY: help db db-stop db-migrate db-baseline db-info etl-validate etl backend frontend check-frontend check-etl check-db

help:
	@printf '%s\n' \
	  'docker compose up -d Build and start the default API development environment' \
	  'make dev-status      Read the default API environment status' \
	  'make dev-refresh     Collect, validate and publish default API data now' \
	  'make dev-reconcile   Validate default artifacts after inspecting a failure' \
	  'make api-images      Build source-based API images; never connects to a DB' \
	  'make api-status      Read the separate persistent API environment status' \
	  'make api-init        Initialize a NEW API environment (API_INIT_ARGS required)' \
	  'make api-up          Build/start the API backend and weekly scheduler' \
	  'make frontend-api    Start Vite against the API backend on port 18090' \
	  'make api-refresh     Collect, validate and publish an API refresh now' \
	  'make api-reconcile   Validate current artifacts and unblock future scheduling' \
	  'make api-backup      Snapshot DB backup, independent restore and full comparison' \
	  'make api-restart-check Restart only the owned API DB and verify persistence' \
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
	docker compose -f docker-compose.legacy.yml up -d

db-stop:
	docker compose -f docker-compose.legacy.yml stop team-postgres

db-migrate:
	@printf '%s\n' 'Use docker compose -f docker-compose.legacy.yml up -d for the guarded legacy team pipeline.'
	@exit 1

db-baseline:
	@printf '%s\n' 'Team development never baselines or adopts an existing database.' >&2
	@exit 1

db-info:
	$(PYTHON) etl/team_dev.py status

etl-validate:
	$(PYTHON) etl/team_dataset.py validate

etl:
	docker compose -f docker-compose.legacy.yml up -d

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

.PHONY: api-images api-init api-up api-status api-refresh api-reconcile api-backup api-restart-check frontend-api

api-images:
	$(PYTHON) etl/api_images.py $(API_IMAGES_ARGS)

api-init:
	$(API_PYTHON) etl/api_dev.py --home "$(API_HOME)" init $(API_INIT_ARGS)

api-up:
	$(API_PYTHON) etl/api_dev.py --home "$(API_HOME)" up

api-status:
	$(API_PYTHON) etl/api_dev.py --home "$(API_HOME)" status

api-refresh:
	$(API_PYTHON) etl/api_dev.py --home "$(API_HOME)" refresh

api-reconcile:
	$(API_PYTHON) etl/api_dev.py --home "$(API_HOME)" reconcile

api-backup:
	$(API_PYTHON) etl/api_backup.py "$(API_HOME)"

api-restart-check:
	$(API_PYTHON) etl/api_dev.py --home "$(API_HOME)" restart-check

frontend-api:
	RECYCLEYOUNGS_DEMO_API_PROXY=http://127.0.0.1:18090 npm --prefix frontend run dev

.PHONY: dev-status dev-refresh dev-reconcile
dev-status:
	docker compose exec -T api-scheduler python /workspace/etl/dev_runtime.py status

dev-refresh:
	docker compose exec -T api-scheduler python /workspace/etl/dev_runtime.py refresh

dev-reconcile:
	docker compose exec -T api-scheduler python /workspace/etl/dev_runtime.py reconcile

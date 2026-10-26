.DEFAULT_GOAL := help
PYTHON ?= python3
COMPOSE ?= docker compose
API_IMAGES_ARGS ?=
RESET_PROJECT ?= recycleyoungs-dev

.PHONY: help api-images frontend check-frontend check-etl dev-setup dev-build dev-up dev-stop dev-reset-plan dev-reset dev-status dev-refresh dev-reconcile

help:
	@echo "docker compose run --rm --no-deps setup  Create env files; preserve existing settings"
	@echo "docker compose up -d                    Build and start the development environment"
	@echo "make dev-setup / dev-build / dev-up / dev-stop  Optional Compose shortcuts"
	@echo "make dev-reset-plan  Preview project-only reset; no resources deleted"
	@echo "make dev-reset       DESTRUCTIVE: delete owned project data after backup/restore verification"
	@echo "make dev-status / dev-refresh / dev-reconcile  DB status / publish / reconciliation"
	@echo "make api-images      Build source-based API images; never connects to a DB"
	@echo "make frontend        Start Vite (run npm ci in frontend first)"
	@echo "make check-frontend  Build and lint React"
	@echo "make check-etl       Run ETL regression tests with PYTHON"

frontend:
	npm --prefix frontend run dev

check-frontend:
	npm --prefix frontend run build
	npm --prefix frontend run lint

check-etl:
	cd etl && "$(PYTHON)" -m unittest discover -s tests -v

api-images:
	"$(PYTHON)" etl/api_images.py $(API_IMAGES_ARGS)
dev-setup:
	$(COMPOSE) run --rm --no-deps setup

dev-build:
	$(COMPOSE) build

dev-up:
	$(COMPOSE) up -d

dev-stop:
	$(COMPOSE) stop

dev-reset-plan:
	$(COMPOSE) run --rm --no-deps reset

dev-reset:
	$(COMPOSE) run --rm --no-deps reset --apply --confirm "$(RESET_PROJECT)"

dev-status:
	$(COMPOSE) exec -T api-scheduler python /workspace/etl/dev_runtime.py status

dev-refresh:
	$(COMPOSE) exec -T api-scheduler python /workspace/etl/dev_runtime.py refresh

dev-reconcile:
	$(COMPOSE) exec -T api-scheduler python /workspace/etl/dev_runtime.py reconcile

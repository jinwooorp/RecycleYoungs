.DEFAULT_GOAL := help
PYTHON ?= python3
API_IMAGES_ARGS ?=

.PHONY: help api-images frontend check-frontend check-etl dev-status dev-refresh dev-reconcile

help:
	@printf '%s\n' \
	  'docker compose up -d Build and start the default API development environment' \
	  'make dev-status      Read the default API environment status' \
	  'make dev-refresh     Collect, validate and publish default API data now' \
	  'make dev-reconcile   Validate default artifacts after inspecting a failure' \
	  'make api-images      Build source-based API images; never connects to a DB' \
	  'make frontend        Start Vite (run npm ci in frontend first)' \
	  'make check-frontend  Build and lint React' \
	  'make check-etl       Run ETL regression tests with PYTHON'

frontend:
	npm --prefix frontend run dev

check-frontend:
	npm --prefix frontend run build
	npm --prefix frontend run lint

check-etl:
	cd etl && $(PYTHON) -m unittest discover -s tests -v

api-images:
	$(PYTHON) etl/api_images.py $(API_IMAGES_ARGS)
dev-status:
	docker compose exec -T api-scheduler python /workspace/etl/dev_runtime.py status

dev-refresh:
	docker compose exec -T api-scheduler python /workspace/etl/dev_runtime.py refresh

dev-reconcile:
	docker compose exec -T api-scheduler python /workspace/etl/dev_runtime.py reconcile

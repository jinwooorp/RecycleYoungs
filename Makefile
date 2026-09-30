.DEFAULT_GOAL := help
PYTHON ?= python3
ETL_ARGS ?=

.PHONY: help db db-stop etl-validate etl backend frontend check-frontend check-etl

help:
	@printf '%s\n' \
	  'make db              Start the development database' \
	  'make db-stop         Stop the database, retaining its volume' \
	  'make etl-validate    Validate CSV inputs without connecting to a database' \
	  'make etl             Load data (optional ETL_ARGS="--only sales_dong")' \
	  'make backend         Start Spring Boot' \
	  'make frontend        Start Vite (run npm ci in frontend first)' \
	  'make check-frontend  Build and lint React' \
	  'make check-etl       Run ETL regression tests with PYTHON'

db:
	docker compose up -d postgres

db-stop:
	docker compose stop postgres

etl-validate:
	docker compose run --build --rm --no-deps etl --validate-only $(ETL_ARGS)

etl:
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

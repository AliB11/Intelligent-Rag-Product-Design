# ---------------------------------------------------------------------------
# Makefile — standard entry points for local development and CI
# ---------------------------------------------------------------------------

SHELL := /bin/bash
.DEFAULT_GOAL := help

.PHONY: help install dev build start lint typecheck typegen verify verify-fast \
        db-push db-studio smoke ci docker-build docker-up docker-down clean

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Install pinned dependencies
	npm ci

dev: ## Run the development server
	npm run dev

build: ## Production build
	npm run build

start: ## Start the production server
	npm run start

lint: ## ESLint
	npm run lint

typegen: ## Generate Next.js route types
	npx next typegen

typecheck: ## TypeScript, no emit
	npm run typecheck

verify: ## Full financial-engine verification suite
	node scripts/verify.mjs

verify-fast: ## Verification suite with reduced Monte Carlo paths
	node scripts/verify.mjs --fast

db-push: ## Synchronise the Drizzle schema with PostgreSQL
	npx drizzle-kit push --force

db-studio: ## Open Drizzle Studio
	npx drizzle-kit studio

smoke: ## Smoke-test the running server (http://127.0.0.1:3000)
	@node scripts/smoke.mjs

ci: lint typegen typecheck build verify-fast ## Everything the CI pipeline runs

docker-build: ## Build the production image
	docker compose build

docker-up: ## Start postgres + app
	docker compose up --build -d

docker-down: ## Stop the stack and remove volumes
	docker compose down -v

clean: ## Remove build artefacts
	rm -rf .next .verify-build *.tsbuildinfo

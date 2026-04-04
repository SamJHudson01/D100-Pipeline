.PHONY: setup dev dev-web dev-worker build test test-integration migrate lint clean

# ── Setup ────────────────────────────────────────────────────────────

setup: ## Install all dependencies (Node + Python)
	npm install
	pip install -r requirements.txt
	npx prisma generate
	@echo "\n  Setup complete. Copy .env.example to .env and fill in your keys.\n"

# ── Development ──────────────────────────────────────────────────────

dev: ## Start Next.js dev server + OpenRouter worker
	node --experimental-strip-types ./scripts/dev.ts

dev-web: ## Start Next.js dev server only (port 3005)
	npx next dev --port 3005

dev-worker: ## Start OpenRouter research worker only
	node --experimental-strip-types ./scripts/openrouter-worker.ts

# ── Database ─────────────────────────────────────────────────────────

migrate: ## Run Prisma migrations
	npx prisma migrate deploy

seed: ## Run all pool-building gather scripts
	python scripts/gather_yc.py
	python scripts/gather_producthunt.py --pages 10
	python scripts/gather_accelerators.py
	python scripts/gather_sbir.py
	python scripts/pool_db.py stats

# ── Build & Test ─────────────────────────────────────────────────────

build: ## Production build
	npx next build

test: ## Run unit tests
	npx vitest run

test-integration: ## Run integration tests (requires ALLOW_INTEGRATION_DB=1)
	ALLOW_INTEGRATION_DB=1 npx vitest run --config vitest.config.integration.ts

lint: ## Run ESLint
	npx eslint .

typecheck: ## Run TypeScript type checking
	npx tsc --noEmit

# ── Docker ───────────────────────────────────────────────────────────

docker: ## Start all services via Docker Compose
	docker compose -f docker/docker-compose.yml up -d

docker-down: ## Stop all Docker services
	docker compose -f docker/docker-compose.yml down

# ── Utilities ────────────────────────────────────────────────────────

clean: ## Remove build artifacts
	rm -rf .next node_modules lib/generated/prisma

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help

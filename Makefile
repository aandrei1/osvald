.DEFAULT_GOAL := help
.PHONY: help install build dev dev-backend dev-frontend dev-worker \
	lint lint-fix format format-check typecheck \
	test test-watch test-python coverage \
	db-generate db-migrate db-studio db-seed \
	docker-up docker-down docker-logs docker-reset \
	clean

help: ## Afișează această listă de comenzi
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

install: ## Instalează dependențele (pnpm)
	pnpm install

build: ## Build pentru toate pachetele (turbo)
	pnpm build

dev: ## Pornește toate serviciile în mod dev
	pnpm dev

dev-backend: ## Pornește doar backend-ul în mod dev
	pnpm dev:backend

dev-frontend: ## Pornește doar frontend-ul în mod dev
	pnpm dev:frontend

dev-worker: ## Pornește worker-ul BullMQ în mod dev
	pnpm dev:worker

lint: ## Rulează eslint pe toate pachetele
	pnpm lint

lint-fix: ## Rulează eslint --fix pe toate pachetele
	pnpm lint:fix

format: ## Formatează codul cu prettier
	pnpm format

format-check: ## Verifică formatarea fără a modifica fișiere
	pnpm format:check

typecheck: ## Verifică tipurile TypeScript (toate pachetele)
	pnpm typecheck

test: ## Rulează testele TS/JS (vitest, toate pachetele)
	pnpm test

test-watch: ## Rulează testele backend în watch mode
	pnpm --filter @osvald/backend test:watch

test-python: ## Rulează testele Python (ocr-service + tts-service, în Docker)
	pnpm test:python

coverage: ## Rulează testele cu raport de acoperire
	pnpm coverage

db-generate: ## Generează migrațiile Drizzle
	pnpm db:generate

db-migrate: ## Aplică migrațiile pe baza de date
	pnpm db:migrate

db-studio: ## Deschide Drizzle Studio
	pnpm db:studio

db-seed: ## Populează baza de date cu date de test
	pnpm db:seed

docker-up: ## Pornește stack-ul local (postgres, redis, backend, ocr, tts)
	pnpm docker:up

docker-down: ## Oprește stack-ul local
	pnpm docker:down

docker-logs: ## Urmărește logurile stack-ului local
	pnpm docker:logs

docker-reset: ## Oprește stack-ul și șterge volumele (DB/Redis/TTS cache)
	docker compose down -v

clean: ## Curăță artefactele de build și node_modules
	pnpm clean

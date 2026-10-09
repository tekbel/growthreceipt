.PHONY: setup db-up db-migrate demo-seed demo-reset dev-web dev-api dev-worker dev-paypal-relay dev-paypal-tunnel lint typecheck test check

setup:
	npm install
	python3 -m venv .venv
	.venv/bin/python -m pip install -e './apps/api[dev]'

db-up:
	docker-compose up -d postgres

db-migrate:
	PYTHONPATH=apps/api .venv/bin/python scripts/migrate_local_db.py

demo-seed: db-migrate
	PYTHONPATH=apps/api .venv/bin/python scripts/seed_demo.py

demo-reset: db-migrate
	PYTHONPATH=apps/api .venv/bin/python scripts/seed_demo.py --reset

dev-web:
	npm run dev:web

dev-api:
	.venv/bin/python -m fastapi dev apps/api/app/main.py --port 8000

dev-worker:
	PYTHONPATH=apps/api .venv/bin/python services/worker/worker.py

dev-paypal-relay:
	.venv/bin/python -m uvicorn --app-dir scripts paypal_webhook_relay:app --host 127.0.0.1 --port 8787

dev-paypal-tunnel:
	ngrok http 8787 --url https://justify-usual-twirl.ngrok-free.dev

lint:
	npm run lint:web
	.venv/bin/python -m ruff check apps/api services/worker

typecheck:
	npm run typecheck:web
	.venv/bin/python -m mypy apps/api services/worker

test:
	npm run test:web
	PYTHONPATH=apps/api .venv/bin/python -m pytest apps/api/tests

check: lint typecheck test build-web

.PHONY: build-web
build-web:
	npm run build:web

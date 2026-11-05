.PHONY: setup db-up db-migrate demo-seed demo-reset demo-purchase dev-web dev-api dev-paypal-relay dev-paypal-tunnel lint typecheck test check

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

# Sandbox purchases from buy links, for the demo video. make demo-purchase LINKS="<buy link> ..." COUNT=1
demo-purchase:
	node scripts/demo_purchase.mjs $(LINKS) --count $(or $(COUNT),1)

dev-web:
	npm run dev:web

dev-api:
	.venv/bin/python -m fastapi dev apps/api/app/main.py --port 8000

dev-paypal-relay:
	.venv/bin/python -m uvicorn --app-dir scripts paypal_webhook_relay:app --host 127.0.0.1 --port 8787

dev-paypal-tunnel:
	ngrok http 8787 --url $${NGROK_URL:?Set NGROK_URL to your fixed ngrok https URL}

lint:
	npm run lint:web
	.venv/bin/python -m ruff check apps/api

typecheck:
	npm run typecheck:web
	.venv/bin/python -m mypy apps/api

test:
	npm run test:web
	PYTHONPATH=apps/api .venv/bin/python -m pytest apps/api/tests

check: lint typecheck test build-web

.PHONY: build-web
build-web:
	npm run build:web

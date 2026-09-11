# FitMe

FitMe is an AI-powered virtual fashion try-on SaaS platform for Indian fashion ecommerce sellers. It supports two primary entry points: a merchant-installed Try On Me button for product pages, and a consumer URL flow where shoppers paste any fashion product link and receive product extraction, try-on, size recommendation, and same-brand price comparison.

## What Is Included

- `backend`: FastAPI, async SQLAlchemy, JWT auth, brand API keys, scan upload validation, size recommendation, try-on orchestration, product ingestion, price comparison, widget/webhook endpoints, health checks, Celery tasks.
- `scraper-service`: FastAPI scraping microservice with cache-first compatible flow and direct stealth-compatible handling for Myntra, Meesho, Flipkart, Ajio, and Amazon.
- `runpod-worker`: serverless worker entry point for try-on synthesis dispatch.
- `consumer-web`: Next.js consumer app with universal try-on hero and dark result page.
- `brand-dashboard`: Next.js seller dashboard.
- `mobile-app`: Expo React Native app skeleton with URL, scan, and result screens.
- `shopify-app`: Remix Shopify app shell plus Theme App Extension injection.
- `widget`: dependency-free JavaScript embed button.
- `chrome-extension`: Manifest V3 FitMe Lens extension.

## Run Locally

```bash
docker-compose up --build
```

Backend API: `http://localhost:8000`  
Scraper service: `http://localhost:8001`  
Mailhog: `http://localhost:8025`

## API Basics

All API errors use:

```json
{"error":"ERROR_CODE","message":"Human readable","message_hi":"Hindi"}
```

Authenticated user endpoints use `Authorization: Bearer <jwt_token>`. Brand endpoints and widget endpoints use `X-Brand-API-Key`.

## Development Notes

- Uploads are validated by JPEG/PNG magic bytes and capped at 10MB.
- API keys are SHA-256 hashed and plaintext is shown only once at brand registration or rotation.
- Body scan storage references are encrypted before database persistence.
- Monetary values should be stored as paise in production integrations and displayed as rupees in UI clients.
- The dark theme root is `#1A1208` across the web surfaces.


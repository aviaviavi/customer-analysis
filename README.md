# customer-analysis

Given a customer MRR sheet (CSV or Excel) like this:

|Customer|Start Date| End Date |2024-01|2024-02|2024-03|2024-04|2024-05|2024-06|2024-07|
|--------|----------|----------|------|------|------|------|------|------|------|
|Customer1|2024-01|N/A|1000|1000|1000|1000|1000|1000|1000|
|Customer2|2024-03|N/A|0|0|1000|3000|4000|5000|6000|
|... |... |... |... |... |... |... |... |... |... |

You'll get a simple and completely local dashboard with all of your basic revenue KPIs.

## Metrics

- Monthly Revenue
- MRR
- ARR
- Net Revenue Retention
- Average Contract Value
- Active Customers

## Getting Started

1. Clone the repository
2. Run `npm install`
3. Run `npm run build`

## Developing

1. Clone the repository
2. Run `npm install`
3. (Optional) Start the local Stripe backend:
   - `cd server && npm install && npm start`
   - Exposes `POST http://localhost:8787/api/stripe/export` (uses `STRIPE_SECRET_KEY` env var or Authorization Bearer header).
   - Server env knobs:
     - `STRIPE_REQUEST_TIMEOUT_MS` (default 120000)
     - `STRIPE_MAX_PAGES` (default 50), `STRIPE_PAGE_SIZE` (max 100)
     - `STRIPE_STATUS` (default `all`), `STRIPE_CURRENCY` (optional currency filter)
   - Request body options (POST /api/stripe/export):
     - `{ status, createdGte, createdLte, maxPages, requestTimeoutMs, pageSize, currency }`
     - Example: `curl -XPOST :8787/api/stripe/export -H 'Authorization: Bearer sk_test_…' -H 'Content-Type: application/json' -d '{"status":"active","maxPages":10}'`
4. Run `npm run dev`
   - In dev, the Vite proxy forwards `/api` and `/health` to `http://localhost:8787`. Leave the Backend URL blank in the Stripe modal to use this.

## License

Apache 2.0

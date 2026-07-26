# Margin Desk

A fee and profit calculator for UK online marketplaces. Built with TypeScript and plain HTML, no framework, no runtime dependencies for the web app itself.

Supports eBay UK, Amazon UK, and B&Q Marketplace out of the box. Custom fees and VAT handling are included. The same calculation engine is also exposed as a small HTTP API, so you can drive it from a script, a spreadsheet, or another service instead of the browser UI.

## Getting started

**Prerequisites:** Node.js 18+

```bash
# Install dev dependencies (TypeScript + esbuild only)
npm install

# Build the bundle
npm run build
```

Then open `index.html` directly in your browser. No server required.

## Development

```bash
# Watch mode, rebuilds on every file save
npm run watch

# Type-check without building
npm run typecheck
```

Keep a browser tab open to `index.html` and refresh after each build. Because the output is a single `dist/app.js` file, there is no dev server to configure.

## How it works

### Two modes

**Calculate profit**: enter a selling price and see the full fee breakdown, net profit, margin, and ROI.

**Find selling price**: enter a target net profit and the calculator works backwards to find the minimum price you need to charge.

### VAT handling

Tick "I am VAT registered" to include VAT on marketplace fees where applicable. eBay UK charges 20% VAT on their fees for VAT-registered sellers; this is applied automatically when the option is enabled.

### Additional fees

Use the "Additional fees" panel to model costs the marketplace does not account for:

| Type | Example use case |
|---|---|
| Fixed per item | Packaging materials, labelling |
| % of sale price | Sourcing agent commission, repricing tool fee |
| % of profit | Profit-share arrangement |

Percentage-of-profit fees are calculated after all other deductions to avoid circular dependencies.

## HTTP API

The engine (`src/engine`) is pure and framework-agnostic, so it is wrapped in a plain Node HTTP server with no extra dependencies. Start it with:

```bash
npm run api
```

This builds `dist/server.js` and runs it, listening on port 3000 by default (set `PORT` to change it). For local development with auto-rebuild:

```bash
npm run api:watch
```

then run `node dist/server.js` in a second terminal whenever you want to pick up a rebuild.

All monetary values are in pence, matching the internal convention used throughout the engine.

### Authentication

Set the `API_KEY` environment variable to require a bearer token on every request. If it's unset, the API is open (fine for local development, not for a public server). When it's set, requests need:

```
Authorization: Bearer <your key>
```

Missing or wrong keys get a `401`. Cross-origin browser requests are blocked unless the calling origin is listed in the comma-separated `ALLOWED_ORIGINS` environment variable; server-to-server calls (curl, another backend) aren't affected by this since CORS is a browser-only restriction.

### `GET /api/marketplaces`

Returns every registered marketplace config.

### `GET /api/marketplaces/:id`

Returns a single marketplace config, e.g. `GET /api/marketplaces/ebay-uk`. Responds `404` if the id is unknown.

### `POST /api/calculate`

Calculates the fee breakdown for a given selling price.

```bash
curl -X POST localhost:3000/api/calculate \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "marketplaceId": "ebay-uk",
    "sellingPrice": 2499,
    "costPrice": 850,
    "shippingCost": 350,
    "fulfilmentModeId": "self",
    "vatRegistered": true
  }'
```

Add `?trace=true` to the URL to include the full fee trace (individual formulae) alongside the breakdown.

### `POST /api/solve`

Works backwards from a target profit or margin to find the required selling price. Same body shape as `/api/calculate` but without `sellingPrice`, plus:

```json
{
  "targetMode": "fixed",
  "targetNetProfit": 500
}
```

or, for a margin target:

```json
{
  "targetMode": "margin",
  "targetMargin": 0.2
}
```

### `POST /api/ebay-cost`

Runs the eBay cost builder (supplier pricing to true unit cost) independently of a full calculation. See `src/marketplaces/ebay-cost-builder.ts` for the full input/output shape.

### Shared request fields

Both `/api/calculate` and `/api/solve` accept:

| Field | Type | Notes |
|---|---|---|
| `marketplaceId` | string | required, must match a registered marketplace id |
| `costPrice` | number | required, pence |
| `fulfilmentModeId` | string | required, must match one of the marketplace's fulfilment modes |
| `shippingCost` | number | pence, defaults to 0 |
| `vatRegistered` | boolean | defaults to false |
| `vatRate` | number | decimal rate, defaults to 0.2 |
| `weightGrams` | number | required only when the fulfilment mode uses weight bands |
| `customFees` | array | `{ id, label, type, value }`, see `src/types.ts` |
| `excludedFees` | array | any of `referralFee`, `paymentFee`, `fulfilmentFee`, `vatOnFees`, `shippingCost` |

Errors come back as `{ "error": "message" }` with an appropriate status code (`400` for a bad request, `404` for an unknown marketplace or route).

### Example usage

Find the selling price needed to clear £5 net profit on an eBay listing costing £8.50, with £3.50 shipping:

```bash
curl -X POST https://api.linxweb.co.uk/api/solve \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "marketplaceId": "ebay-uk",
    "costPrice": 850,
    "shippingCost": 350,
    "fulfilmentModeId": "self",
    "targetMode": "fixed",
    "targetNetProfit": 500
  }'
```

```json
{
  "requiredSellingPrice": 1970,
  "breakdown": { "sellingPrice": 1970, "netProfit": 500, "netMargin": 25.38, "roi": 58.82, "...": "..." },
  "converged": true
}
```

The same call from JavaScript, `fetch` being the only thing doing any work:

```javascript
const res = await fetch('https://api.linxweb.co.uk/api/solve', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    marketplaceId: 'ebay-uk',
    costPrice: 850,
    shippingCost: 350,
    fulfilmentModeId: 'self',
    targetMode: 'fixed',
    targetNetProfit: 500,
  }),
});

const { requiredSellingPrice, breakdown } = await res.json();
console.log(`Sell at £${(requiredSellingPrice / 100).toFixed(2)} for £${(breakdown.netProfit / 100).toFixed(2)} profit`);
```

And the same from a Laravel app, using the `Http` facade:

```php
use Illuminate\Support\Facades\Http;

$response = Http::withToken(config('services.margin_desk.api_key'))
    ->post('https://api.linxweb.co.uk/api/solve', [
        'marketplaceId' => 'ebay-uk',
        'costPrice' => 850,
        'shippingCost' => 350,
        'fulfilmentModeId' => 'self',
        'targetMode' => 'fixed',
        'targetNetProfit' => 500,
    ])
    ->throw();

$requiredSellingPrice = $response->json('requiredSellingPrice');
$netProfit = $response->json('breakdown.netProfit');

// Sell at £19.70 for £5.00 profit
echo sprintf('Sell at £%.2f for £%.2f profit', $requiredSellingPrice / 100, $netProfit / 100);
```

`Http::withToken()` sets the `Authorization: Bearer` header for you. `->throw()` turns a `4xx`/`5xx` response into an `Illuminate\Http\Client\RequestException`, catch it if you want to handle a failed calculation gracefully rather than letting it bubble up. Keep the key itself out of the codebase, add `MARGIN_DESK_API_KEY` to `.env` and reference it from `config/services.php`:

```php
// config/services.php
'margin_desk' => [
    'api_key' => env('MARGIN_DESK_API_KEY'),
],
```

## Project structure

```
margin-desk/
  src/
    types.ts                All interfaces and enums
    marketplaces/
      ebay.ts               eBay UK fee config
      amazon.ts             Amazon UK fee config (FBA weight bands included)
      bandq.ts              B&Q Marketplace fee config
      index.ts              Registry, single import point for all configs
      ebay-cost-builder.ts  Supplier pricing to true unit cost
    engine/
      fees.ts               calculateFees(config, options) -> FeeBreakdown
      solver.ts             solveForPrice(config, options) -> SolverResult
      vat.ts                VAT on fees helper
    api/
      server.ts             HTTP API wrapping the engine
    ui/
      app.ts                DOM wiring, no fee logic here
      render.ts             Renders breakdown table and result panels
      debug.ts              Renders the "show workings" trace
      icons.ts              Inline SVG icons used in the overview sheet
    utils/
      currency.ts           formatGBP, poundsToPence, penceToDecimal
      math.ts               roundPence, round2dp, safeDivide, clamp
  index.html                Single HTML file with embedded CSS
  dist/
    app.js                  Compiled browser bundle
    server.js               Compiled API server
```

The engine is completely decoupled from both the DOM and the API layer: `fees.ts` and `solver.ts` are pure functions, and the browser UI and HTTP API are just two different callers of the same code.

## Adding a new marketplace

1. Create `src/marketplaces/yourplatform.ts` using an existing config as a template:

```typescript
import type { MarketplaceConfig } from '../types';

const yourPlatform: MarketplaceConfig = {
  id: 'yourplatform-uk',
  name: 'Your Platform',
  currency: 'GBP',

  referralFees: [
    { rate: 0.10 }, // 10%, catch-all
  ],

  closingFee: 0,

  paymentFee: {
    percentage: 0.029, // 2.9%
    fixed: 30,         // 30p
  },

  vatOnFees: false,

  fulfilmentModes: [
    { id: 'self', label: 'Self-fulfilled', fee: 0 },
  ],
};

export default yourPlatform;
```

2. Register it in `src/marketplaces/index.ts`:

```typescript
import yourPlatform from './yourplatform';

export const marketplaces: Record<string, MarketplaceConfig> = {
  // ...existing entries
  [yourPlatform.id]: yourPlatform,
};
```

3. Run `npm run build` (and `npm run build:api` if you're using the API). The new marketplace appears in the dropdown automatically, and is immediately available via `GET /api/marketplaces`.

### Tiered referral fees

Tiers are evaluated in order; the first tier where `sellingPrice <= upTo` wins. A tier with no `upTo` is the catch-all fallback.

```typescript
referralFees: [
  { upTo: 10000, rate: 0.08 },  // 8% on items up to £100
  { rate: 0.15 },               // 15% on everything above
],
```

### Weight-banded fulfilment fees (e.g. FBA)

```typescript
{
  id: 'fba',
  label: 'Fulfilled by Amazon (FBA)',
  fee: [
    { upToGrams: 100,  fee: 199 }, // £1.99 for items up to 100g
    { upToGrams: 500,  fee: 244 }, // £2.44 for items up to 500g
    { upToGrams: 1000, fee: 328 }, // £3.28 for items up to 1kg
  ],
}
```

Fees are always in **pence**. The UI and the API both handle conversion at their own boundary; the engine itself never touches pounds.

## Tech decisions

- **TypeScript** with `strict` and `exactOptionalPropertyTypes` enabled, which catches edge cases that loose configs would miss
- **esbuild** for bundling, compiles the full project in under 10ms
- **Pence throughout**: all internal arithmetic uses integers to avoid floating-point drift; conversion happens only at the UI and API boundaries
- **No framework**: the engine is framework-agnostic; the UI is a few hundred lines of vanilla DOM code, and the API is Node's built-in `http` module with no added dependencies

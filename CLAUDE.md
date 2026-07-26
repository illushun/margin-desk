# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Margin Desk is a fee and profit calculator for UK online marketplaces (eBay, Amazon, B&Q). It has three layers:

- `src/engine/` and `src/marketplaces/`: pure, framework-agnostic calculation logic. No DOM, no HTTP, no side effects.
- `src/ui/`: a vanilla TypeScript/DOM front end, bundled into a single `dist/app.js` and loaded by `index.html`.
- `src/api/`: a small Node HTTP server (built-in `http` module only) that wraps the engine for programmatic access.

The UI and the API are both just callers of the engine. When changing calculation behavior, change `src/engine/` or `src/marketplaces/`, not the UI or API layer.

## Commands

```bash
npm install          # TypeScript, esbuild, @types/node
npm run typecheck     # tsc --noEmit, run this after any change
npm run build         # bundle the browser UI to dist/app.js
npm run watch          # rebuild the UI on save
npm run build:api      # bundle the API server to dist/server.js
npm run api             # build + run the API server (PORT env var, default 3000)
npm run api:watch        # rebuild the API server on save (run separately from the process)
```

There is no test suite. Verify changes with `npm run typecheck`, a build, and (for engine changes) manual curl requests against the running API or manual use of the UI.

## Conventions

- **Money is always pence, always an integer.** `roundPence` in `src/utils/math.ts` is the only place rounding happens inside the engine. Pounds only exist at the UI and API boundary (user input fields, JSON request/response documentation). Never introduce floating-point pound arithmetic inside `src/engine/`.
- **`strict` and `exactOptionalPropertyTypes` are on.** An optional field typed `number | undefined` is not the same as an omitted key; use conditional spreads (`...(x !== undefined ? { key: x } : {})`) rather than assigning `undefined` directly.
- **No emoji, anywhere** (code, UI copy, docs, commit messages). Use the inline SVG icons in `src/ui/icons.ts` for UI iconography, following the existing outline style (`stroke="currentColor"`, no fill).
- **No em dashes.** Use commas, parentheses, or a period and a new sentence instead.
- **No new runtime dependencies without asking.** The whole point of this project is a zero-dependency browser bundle and a zero-dependency API server; both `devDependencies` entries (`typescript`, `esbuild`, `@types/node`) are dev-only.
- Keep comments to the "why", not the "what". Most of this codebase already documents itself through naming and the `types.ts` interfaces.

## Adding a marketplace

Create `src/marketplaces/<id>.ts` exporting a `MarketplaceConfig`, then register it in `src/marketplaces/index.ts`. See the README's "Adding a new marketplace" section for the full walkthrough, including tiered referral fees and weight-banded fulfilment fees. No UI or API changes are needed; both read from the registry.

## Key files

| File | Purpose |
|---|---|
| `src/types.ts` | Every interface: marketplace configs, calculation inputs/outputs, debug traces |
| `src/engine/fees.ts` | `calculateFees` / `calculateFeesWithTrace`, the core fee math |
| `src/engine/solver.ts` | `solveForPrice`, iteratively finds a selling price for a target profit/margin |
| `src/marketplaces/index.ts` | Marketplace registry, `getMarketplace` / `listMarketplaces` |
| `src/api/server.ts` | HTTP routing, request validation, JSON serialization for the engine |
| `src/ui/app.ts` | DOM event wiring and step-by-step form state, no fee math |
| `src/ui/render.ts` | Renders the result sheet (breakdown table, metrics) |
| `src/ui/debug.ts` | Renders the "show workings" trace modal |

## Gotchas

- `CalculationOptions.excludedFees` is a `Set<ExcludableFee>` inside the engine, but a plain string array over JSON. The API layer (`src/api/server.ts`) converts between the two; don't leak the `Set` type into request/response shapes.
- The eBay cost builder (`src/marketplaces/ebay-cost-builder.ts`) is a separate pre-step that turns supplier pricing into `costPrice` / `shippingCost`, it does not itself touch marketplace fees.
- `solveForPrice` runs up to 100 iterations and reports `converged: false` rather than throwing if it can't land within one pence. Callers (UI and API) should surface that flag, not assume every solve request succeeds cleanly.

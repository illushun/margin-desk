import { createServer, IncomingMessage, ServerResponse } from 'http';
import { getMarketplace, listMarketplaces } from '../marketplaces';
import { calculateFees, calculateFeesWithTrace } from '../engine/fees';
import { solveForPrice } from '../engine/solver';
import { buildEbayCost } from '../marketplaces/ebay-cost-builder';
import type {
  CalculationOptions,
  SolverOptions,
  CustomFee,
  ExcludableFee,
  SolverTargetMode,
} from '../types';

const PORT = Number(process.env.PORT) || 3000;

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Body parsing and shared request shaping
// ---------------------------------------------------------------------------

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new ApiError(413, 'Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ApiError(400, 'Request body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireNumber(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new ApiError(400, `"${key}" must be a number`);
  }
  return value;
}

function optionalNumber(body: Record<string, unknown>, key: string, fallback: number): number {
  if (body[key] === undefined) return fallback;
  return requireNumber(body, key);
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApiError(400, `"${key}" must be a non-empty string`);
  }
  return value;
}

const VALID_EXCLUDABLE_FEES: ExcludableFee[] = [
  'referralFee',
  'paymentFee',
  'fulfilmentFee',
  'vatOnFees',
  'shippingCost',
];

function parseExcludedFees(body: Record<string, unknown>): Set<ExcludableFee> {
  const raw = body.excludedFees;
  if (raw === undefined) return new Set();
  if (!Array.isArray(raw) || !raw.every((f) => VALID_EXCLUDABLE_FEES.includes(f as ExcludableFee))) {
    throw new ApiError(400, `"excludedFees" must be an array of: ${VALID_EXCLUDABLE_FEES.join(', ')}`);
  }
  return new Set(raw as ExcludableFee[]);
}

function parseCustomFees(body: Record<string, unknown>): CustomFee[] {
  const raw = body.customFees;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new ApiError(400, '"customFees" must be an array');

  return raw.map((entry, i): CustomFee => {
    if (!isRecord(entry)) throw new ApiError(400, `customFees[${i}] must be an object`);
    const type = entry.type;
    if (type !== 'fixed_per_item' && type !== 'percentage_of_sale' && type !== 'percentage_of_profit') {
      throw new ApiError(400, `customFees[${i}].type is invalid`);
    }
    return {
      id: typeof entry.id === 'string' ? entry.id : `custom-${i}`,
      label: requireString(entry, 'label'),
      type,
      value: requireNumber(entry, 'value'),
    };
  });
}

/** Shared fields between /calculate and /solve, everything except sellingPrice. */
function parseCommonOptions(body: Record<string, unknown>): Omit<CalculationOptions, 'sellingPrice'> {
  return {
    costPrice: requireNumber(body, 'costPrice'),
    vatRegistered: body.vatRegistered === true,
    vatRate: optionalNumber(body, 'vatRate', 0.2),
    fulfilmentModeId: requireString(body, 'fulfilmentModeId'),
    shippingCost: optionalNumber(body, 'shippingCost', 0),
    ...(typeof body.weightGrams === 'number' ? { weightGrams: body.weightGrams } : {}),
    customFees: parseCustomFees(body),
    excludedFees: parseExcludedFees(body),
  };
}

function resolveMarketplace(body: Record<string, unknown>) {
  const id = requireString(body, 'marketplaceId');
  const config = getMarketplace(id);
  if (!config) throw new ApiError(404, `Unknown marketplaceId "${id}"`);
  return config;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

function handleListMarketplaces() {
  return { marketplaces: listMarketplaces() };
}

function handleGetMarketplace(id: string) {
  const config = getMarketplace(id);
  if (!config) throw new ApiError(404, `Unknown marketplaceId "${id}"`);
  return config;
}

function handleCalculate(body: unknown, withTrace: boolean) {
  if (!isRecord(body)) throw new ApiError(400, 'Request body must be a JSON object');
  const config = resolveMarketplace(body);
  const options: CalculationOptions = {
    ...parseCommonOptions(body),
    sellingPrice: requireNumber(body, 'sellingPrice'),
  };

  if (withTrace) return calculateFeesWithTrace(config, options);
  return { breakdown: calculateFees(config, options) };
}

const VALID_TARGET_MODES: SolverTargetMode[] = ['fixed', 'margin'];

function handleSolve(body: unknown) {
  if (!isRecord(body)) throw new ApiError(400, 'Request body must be a JSON object');
  const config = resolveMarketplace(body);

  const targetMode = body.targetMode;
  if (!VALID_TARGET_MODES.includes(targetMode as SolverTargetMode)) {
    throw new ApiError(400, '"targetMode" must be "fixed" or "margin"');
  }

  const options: SolverOptions = {
    ...parseCommonOptions(body),
    targetMode: targetMode as SolverTargetMode,
    targetNetProfit: optionalNumber(body, 'targetNetProfit', 0),
    targetMargin: optionalNumber(body, 'targetMargin', 0),
  };

  return solveForPrice(config, options);
}

function handleEbayCost(body: unknown) {
  if (!isRecord(body)) throw new ApiError(400, 'Request body must be a JSON object');
  return buildEbayCost({
    costPerBatch: requireNumber(body, 'costPerBatch'),
    uom: optionalNumber(body, 'uom', 1),
    qtyRequired: optionalNumber(body, 'qtyRequired', 1),
    discountRate: optionalNumber(body, 'discountRate', 0),
    packingMaterials: optionalNumber(body, 'packingMaterials', 0),
    ppCost: optionalNumber(body, 'ppCost', 0),
    ppIncludedInPrice: body.ppIncludedInPrice === true,
    vatOnSellingPrice: optionalNumber(body, 'vatOnSellingPrice', 0),
    listingFee: optionalNumber(body, 'listingFee', 0),
    adCost: optionalNumber(body, 'adCost', 0),
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function router(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const { pathname, searchParams } = url;
  const method = req.method ?? 'GET';

  if (pathname === '/api' && method === 'GET') {
    return {
      name: 'Margin Desk API',
      endpoints: [
        'GET  /api/marketplaces',
        'GET  /api/marketplaces/:id',
        'POST /api/calculate',
        'POST /api/solve',
        'POST /api/ebay-cost',
      ],
    };
  }

  if (pathname === '/api/marketplaces' && method === 'GET') {
    return handleListMarketplaces();
  }

  const marketplaceMatch = pathname.match(/^\/api\/marketplaces\/([^/]+)$/);
  if (marketplaceMatch && method === 'GET') {
    return handleGetMarketplace(decodeURIComponent(marketplaceMatch[1] as string));
  }

  if (pathname === '/api/calculate' && method === 'POST') {
    return handleCalculate(await readBody(req), searchParams.get('trace') === 'true');
  }

  if (pathname === '/api/solve' && method === 'POST') {
    return handleSolve(await readBody(req));
  }

  if (pathname === '/api/ebay-cost' && method === 'POST') {
    return handleEbayCost(await readBody(req));
  }

  throw new ApiError(404, `No route for ${method} ${pathname}`);
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  router(req, res)
    .then((result) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    })
    .catch((err: unknown) => {
      const status = err instanceof ApiError ? err.status : 500;
      const message = err instanceof Error ? err.message : 'Internal server error';
      if (status === 500) console.error(err);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    });
});

server.listen(PORT, () => {
  console.log(`Margin Desk API listening on http://localhost:${PORT}`);
});

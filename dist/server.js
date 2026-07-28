"use strict";

// src/api/server.ts
var import_http = require("http");
var import_crypto = require("crypto");

// src/marketplaces/ebay.ts
var ebay = {
  id: "ebay-uk",
  name: "eBay UK",
  currency: "GBP",
  referralFees: [
    { rate: 0.119 }
    // 11.9% -- catch-all (no upTo)
  ],
  closingFee: 0,
  paymentFee: {
    percentage: 3e-3,
    // 0.3%
    fixed: 30
    // 30p
  },
  vatOnFees: true,
  fulfilmentModes: [
    { id: "self", label: "Self-fulfilled", fee: 0 }
  ]
};
var ebay_default = ebay;

// src/marketplaces/amazon.ts
var amazon = {
  id: "amazon-uk",
  name: "Amazon UK",
  currency: "GBP",
  referralFees: [
    { rate: 0.15, minimum: 30 }
    // 15%, minimum 30p -- catch-all
  ],
  closingFee: 0,
  // Amazon bundles payment processing into the referral fee
  paymentFee: {
    percentage: 0,
    fixed: 0
  },
  // Amazon does not charge VAT on seller fees in the UK
  vatOnFees: false,
  fulfilmentModes: [
    {
      id: "fbm",
      label: "Fulfilled by Merchant (FBM)",
      fee: 0
    },
    {
      id: "fba",
      label: "Fulfilled by Amazon (FBA)",
      // Weight-banded FBA fees (standard size, as of 2024, in pence)
      // Source: Amazon FBA fee schedule
      fee: [
        { upToGrams: 100, fee: 199 },
        { upToGrams: 200, fee: 209 },
        { upToGrams: 300, fee: 225 },
        { upToGrams: 400, fee: 234 },
        { upToGrams: 500, fee: 244 },
        { upToGrams: 1e3, fee: 328 },
        { upToGrams: 1500, fee: 390 },
        { upToGrams: 2e3, fee: 445 }
      ]
    }
  ]
};
var amazon_default = amazon;

// src/marketplaces/bandq.ts
var bandq = {
  id: "bandq-uk",
  name: "B&Q Marketplace",
  currency: "GBP",
  referralFees: [
    { rate: 0.12 }
    // 12% general commission -- catch-all
  ],
  closingFee: 0,
  paymentFee: {
    percentage: 0,
    fixed: 0
  },
  vatOnFees: false,
  fulfilmentModes: [
    { id: "self", label: "Self-fulfilled", fee: 0 }
  ]
};
var bandq_default = bandq;

// src/marketplaces/index.ts
var marketplaces = {
  [ebay_default.id]: ebay_default,
  [amazon_default.id]: amazon_default,
  [bandq_default.id]: bandq_default
};
function getMarketplace(id) {
  return marketplaces[id];
}
function listMarketplaces() {
  return Object.values(marketplaces);
}

// src/utils/math.ts
function roundPence(value) {
  return Math.round(value);
}
function round2dp(value) {
  return Math.round(value * 100) / 100;
}
function safeDivide(numerator, denominator) {
  if (denominator === 0) return 0;
  return numerator / denominator;
}

// src/engine/vat.ts
function calcVatOnFees(feeSubtotal, vatRate, marketplaceChargesVat, sellerIsVatRegistered) {
  if (!marketplaceChargesVat || !sellerIsVatRegistered) return 0;
  return roundPence(feeSubtotal * vatRate);
}

// src/engine/fees.ts
function calcReferralFee(sellingPrice, config) {
  const tier = config.referralFees.find(
    (t) => t.upTo === void 0 || sellingPrice <= t.upTo
  );
  if (!tier) return { fee: 0, rate: 0, minimum: 0 };
  const calculated = roundPence(sellingPrice * tier.rate);
  const minimum = tier.minimum ?? 0;
  const fee = minimum ? Math.max(calculated, minimum) : calculated;
  return { fee, rate: tier.rate, minimum };
}
function calcFulfilmentFee(config, modeId, weightGrams) {
  const mode = config.fulfilmentModes.find((m) => m.id === modeId);
  if (!mode) return 0;
  if (typeof mode.fee === "number") return mode.fee;
  if (weightGrams === void 0) return 0;
  const bands = mode.fee;
  const band = bands.find((b) => weightGrams <= b.upToGrams);
  return band ? band.fee : bands[bands.length - 1]?.fee ?? 0;
}
function calcCustomFees(sellingPrice, options) {
  const fixedAndSaleResults = [];
  const profitBasedFees = [];
  for (const fee of options.customFees) {
    if (fee.type === "percentage_of_profit") {
      profitBasedFees.push(fee);
      continue;
    }
    const amount = fee.type === "fixed_per_item" ? fee.value : roundPence(sellingPrice * fee.value);
    fixedAndSaleResults.push({ id: fee.id, label: fee.label, amount });
  }
  return { fixedAndSaleResults, profitBasedFees };
}
function calculateFees(config, options) {
  return calculateFeesWithTrace(config, options).breakdown;
}
function calculateFeesWithTrace(config, options) {
  const { sellingPrice, costPrice, vatRegistered, vatRate, excludedFees } = options;
  const referral = calcReferralFee(sellingPrice, config);
  const referralFee = excludedFees.has("referralFee") ? 0 : referral.fee;
  const closingFee = config.closingFee;
  const rawPaymentFee = roundPence(
    sellingPrice * config.paymentFee.percentage + config.paymentFee.fixed
  );
  const paymentFee = excludedFees.has("paymentFee") ? 0 : rawPaymentFee;
  const rawFulfilmentFee = calcFulfilmentFee(config, options.fulfilmentModeId, options.weightGrams);
  const fulfilmentFee = excludedFees.has("fulfilmentFee") ? 0 : rawFulfilmentFee;
  const rawShippingCost = options.shippingCost;
  const shippingCost = excludedFees.has("shippingCost") ? 0 : rawShippingCost;
  const marketplaceFeeSubtotal = referralFee + closingFee + paymentFee + fulfilmentFee;
  const rawVatOnFees = calcVatOnFees(marketplaceFeeSubtotal, vatRate, config.vatOnFees, vatRegistered);
  const vatOnFees = excludedFees.has("vatOnFees") ? 0 : rawVatOnFees;
  const { fixedAndSaleResults, profitBasedFees } = calcCustomFees(sellingPrice, options);
  const fixedAndSaleTotal = fixedAndSaleResults.reduce((sum, f) => sum + f.amount, 0);
  const provisionalProfit = sellingPrice - marketplaceFeeSubtotal - vatOnFees - shippingCost - costPrice - fixedAndSaleTotal;
  const profitBasedResults = profitBasedFees.map((fee) => ({
    id: fee.id,
    label: fee.label,
    amount: roundPence(Math.max(provisionalProfit, 0) * fee.value)
  }));
  const allCustomFees = [...fixedAndSaleResults, ...profitBasedResults];
  const customFeeTotal = allCustomFees.reduce((sum, f) => sum + f.amount, 0);
  const totalFees = marketplaceFeeSubtotal + vatOnFees + shippingCost + customFeeTotal;
  const netProfit = sellingPrice - totalFees - costPrice;
  const breakdown = {
    sellingPrice,
    referralFee,
    closingFee,
    paymentFee,
    fulfilmentFee,
    vatOnFees,
    shippingCost,
    customFees: allCustomFees,
    totalFees,
    costPrice,
    netProfit,
    netMargin: round2dp(safeDivide(netProfit, sellingPrice) * 100),
    roi: round2dp(safeDivide(netProfit, costPrice) * 100)
  };
  const customFeeTraces = allCustomFees.map((fee) => {
    const src = options.customFees.find((f) => f.id === fee.id);
    let formula = "fixed per item";
    if (src?.type === "percentage_of_sale") {
      formula = `${(src.value * 100).toFixed(2)}% of selling price`;
    } else if (src?.type === "percentage_of_profit") {
      formula = `${(src.value * 100).toFixed(2)}% of provisional profit`;
    }
    return { label: fee.label, formula, amount: fee.amount };
  });
  const totalDeductions = totalFees + costPrice;
  const referralFormula = referral.minimum > 0 && referral.fee === referral.minimum ? `${sellingPrice} \xD7 ${referral.rate} = ${roundPence(sellingPrice * referral.rate)} \u2192 minimum applies` : `${sellingPrice} \xD7 ${referral.rate}`;
  const paymentFormula = config.paymentFee.fixed > 0 ? `${sellingPrice} \xD7 ${config.paymentFee.percentage} + ${config.paymentFee.fixed}` : `${sellingPrice} \xD7 ${config.paymentFee.percentage}`;
  const vatFormula = !config.vatOnFees ? "not applicable for this marketplace" : !vatRegistered ? "not applicable (not VAT registered)" : `${marketplaceFeeSubtotal} \xD7 ${vatRate}`;
  const formulas = [
    { label: "Referral fee", formula: referralFormula, amount: referral.fee, excluded: excludedFees.has("referralFee") },
    { label: "Closing fee", formula: "fixed per item", amount: closingFee },
    { label: "Payment processing fee", formula: paymentFormula, amount: rawPaymentFee, excluded: excludedFees.has("paymentFee") },
    { label: "Fulfilment fee", formula: "weight/mode lookup", amount: rawFulfilmentFee, excluded: excludedFees.has("fulfilmentFee") },
    { label: "Shipping cost", formula: "entered amount", amount: rawShippingCost, excluded: excludedFees.has("shippingCost") },
    { label: "VAT on fees", formula: vatFormula, amount: rawVatOnFees, excluded: excludedFees.has("vatOnFees") },
    ...customFeeTraces,
    { label: "Total deductions", formula: "all fees + cost price", amount: totalDeductions },
    { label: "Net profit", formula: `${sellingPrice} \u2212 ${totalDeductions}`, amount: netProfit }
  ];
  const trace = {
    sellingPrice,
    referralRate: referral.rate,
    referralMinimum: referral.minimum,
    referralFee: referral.fee,
    referralExcluded: excludedFees.has("referralFee"),
    closingFee,
    paymentPercentage: config.paymentFee.percentage,
    paymentFixed: config.paymentFee.fixed,
    paymentFee: rawPaymentFee,
    paymentExcluded: excludedFees.has("paymentFee"),
    fulfilmentFee: rawFulfilmentFee,
    fulfilmentExcluded: excludedFees.has("fulfilmentFee"),
    shippingCost: rawShippingCost,
    shippingExcluded: excludedFees.has("shippingCost"),
    marketplaceFeeSubtotal,
    vatRate,
    vatOnFees: rawVatOnFees,
    vatExcluded: excludedFees.has("vatOnFees"),
    customFees: customFeeTraces,
    costPrice,
    totalDeductions,
    netProfit,
    formulas
  };
  return { breakdown, trace };
}

// src/engine/solver.ts
var MAX_ITERATIONS = 100;
var CONVERGENCE_THRESHOLD = 1;
function estimateSellingPrice(config, options) {
  const { costPrice, shippingCost, excludedFees } = options;
  const referralRate = excludedFees.has("referralFee") ? 0 : config.referralFees[0]?.rate ?? 0;
  const paymentRate = excludedFees.has("paymentFee") ? 0 : config.paymentFee.percentage;
  const paymentFixed = excludedFees.has("paymentFee") ? 0 : config.paymentFee.fixed;
  const shipping = excludedFees.has("shippingCost") ? 0 : shippingCost;
  const percentageOfSaleCustomRates = options.customFees.filter((f) => f.type === "percentage_of_sale").reduce((sum, f) => sum + f.value, 0);
  const fixedCustomFees = options.customFees.filter((f) => f.type === "fixed_per_item").reduce((sum, f) => sum + f.value, 0);
  const constants = costPrice + shipping + config.closingFee + paymentFixed + fixedCustomFees;
  if (options.targetMode === "margin") {
    const divisor2 = 1 - referralRate - paymentRate - percentageOfSaleCustomRates - options.targetMargin;
    if (divisor2 <= 0) {
      return { estimate: roundPence(constants * 10), formula: `${constants} \xD7 10 (percentage rates left no positive divisor)` };
    }
    return {
      estimate: roundPence(constants / divisor2),
      formula: `${constants} \xF7 (1 \u2212 ${referralRate} \u2212 ${paymentRate} \u2212 ${percentageOfSaleCustomRates} \u2212 ${options.targetMargin})`
    };
  }
  const totalPercentageRate = referralRate + paymentRate + percentageOfSaleCustomRates;
  const divisor = 1 - totalPercentageRate;
  if (divisor <= 0) {
    return { estimate: roundPence(constants + options.targetNetProfit), formula: `${constants} + ${options.targetNetProfit} (percentage rates left no positive divisor)` };
  }
  return {
    estimate: roundPence((constants + options.targetNetProfit) / divisor),
    formula: `(${constants} + ${options.targetNetProfit}) \xF7 (1 \u2212 ${totalPercentageRate})`
  };
}
function resolveTargetProfit(options, currentPrice) {
  if (options.targetMode === "fixed") return options.targetNetProfit;
  return roundPence(currentPrice * options.targetMargin);
}
function buildFormulaLines(options, algebraicEstimate, estimateFormula, finalPrice) {
  const targetProfitFormula = options.targetMode === "margin" ? `${finalPrice} \xD7 ${options.targetMargin}` : "fixed target amount";
  return [
    { label: "Algebraic starting estimate", formula: estimateFormula, amount: algebraicEstimate },
    { label: "Target profit", formula: targetProfitFormula, amount: resolveTargetProfit(options, finalPrice) }
  ];
}
function solveForPrice(config, options) {
  const { estimate: algebraicEstimate, formula: estimateFormula } = estimateSellingPrice(config, options);
  let price = algebraicEstimate;
  let converged = false;
  const iterations = [];
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const breakdown2 = calculateFees(config, { ...options, sellingPrice: price });
    const targetProfit = resolveTargetProfit(options, price);
    const error = targetProfit - breakdown2.netProfit;
    iterations.push({
      iteration: i + 1,
      price,
      netProfit: breakdown2.netProfit,
      targetProfit,
      error
    });
    if (Math.abs(error) <= CONVERGENCE_THRESHOLD) {
      converged = true;
      const finalPrice = breakdown2.netProfit < targetProfit ? price + 1 : price;
      const { breakdown: finalBreakdown, trace: feeTrace2 } = calculateFeesWithTrace(config, { ...options, sellingPrice: finalPrice });
      const trace2 = {
        targetMode: options.targetMode,
        targetNetProfit: options.targetNetProfit,
        targetMargin: options.targetMargin,
        algebraicEstimate,
        iterations,
        converged,
        finalPrice,
        formulas: buildFormulaLines(options, algebraicEstimate, estimateFormula, finalPrice),
        feeTrace: feeTrace2
      };
      return { requiredSellingPrice: finalPrice, breakdown: finalBreakdown, converged, trace: trace2 };
    }
    price = roundPence(price + error);
  }
  const { breakdown, trace: feeTrace } = calculateFeesWithTrace(config, { ...options, sellingPrice: price });
  const trace = {
    targetMode: options.targetMode,
    targetNetProfit: options.targetNetProfit,
    targetMargin: options.targetMargin,
    algebraicEstimate,
    iterations,
    converged: false,
    finalPrice: price,
    formulas: buildFormulaLines(options, algebraicEstimate, estimateFormula, price),
    feeTrace
  };
  return { requiredSellingPrice: price, breakdown, converged: false, trace };
}

// src/marketplaces/ebay-cost-builder.ts
function buildEbayCost(inputs) {
  const {
    costPerBatch,
    uom,
    qtyRequired,
    discountRate,
    packingMaterials,
    ppCost,
    ppIncludedInPrice,
    vatOnSellingPrice,
    listingFee,
    adCost
  } = inputs;
  const safeUom = uom <= 0 ? 1 : uom;
  const unitCost = roundPence(costPerBatch / safeUom * qtyRequired * (1 - discountRate));
  const costPrice = roundPence(
    unitCost + packingMaterials + (ppIncludedInPrice ? ppCost : 0) + vatOnSellingPrice + listingFee + adCost
  );
  const shippingCost = ppIncludedInPrice ? 0 : ppCost;
  const formulas = [
    {
      label: "Unit cost",
      formula: `(${costPerBatch} \xF7 ${safeUom}) \xD7 ${qtyRequired} \xD7 (1 \u2212 ${discountRate})`,
      amount: unitCost
    },
    {
      label: "Packing materials",
      formula: "fixed per item",
      amount: packingMaterials
    },
    {
      label: ppIncludedInPrice ? "P+P (included in cost price)" : "P+P (charged as shipping)",
      formula: ppIncludedInPrice ? "added to cost price" : "excluded from cost price, returned as shippingCost instead",
      amount: ppCost
    },
    {
      label: "VAT on selling price",
      formula: "entered amount",
      amount: vatOnSellingPrice
    },
    {
      label: "Listing fee",
      formula: "fixed per listing",
      amount: listingFee
    },
    {
      label: "Ad / promoted listings cost",
      formula: "fixed amount",
      amount: adCost
    },
    {
      label: "Cost price",
      formula: `${unitCost} + ${packingMaterials} + ${ppIncludedInPrice ? ppCost : 0} + ${vatOnSellingPrice} + ${listingFee} + ${adCost}`,
      amount: costPrice
    },
    {
      label: "Shipping cost",
      formula: ppIncludedInPrice ? "0 (P+P included in cost price)" : `${ppCost} (P+P charged separately)`,
      amount: shippingCost
    }
  ];
  return { costPrice, shippingCost, unitCost, formulas };
}

// src/api/server.ts
var PORT = Number(process.env.PORT) || 3e3;
var API_KEY = process.env.API_KEY;
var ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
var ApiError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
function checkAuth(req) {
  if (!API_KEY) return;
  const header = req.headers.authorization;
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : "";
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(API_KEY);
  const valid = providedBuf.length === expectedBuf.length && (0, import_crypto.timingSafeEqual)(providedBuf, expectedBuf);
  if (!valid) throw new ApiError(401, "Missing or invalid API key");
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) {
        reject(new ApiError(413, "Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ApiError(400, "Request body must be valid JSON"));
      }
    });
    req.on("error", reject);
  });
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requireNumber(body, key) {
  const value = body[key];
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new ApiError(400, `"${key}" must be a number`);
  }
  return value;
}
function optionalNumber(body, key, fallback) {
  if (body[key] === void 0) return fallback;
  return requireNumber(body, key);
}
function requireString(body, key) {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiError(400, `"${key}" must be a non-empty string`);
  }
  return value;
}
var VALID_EXCLUDABLE_FEES = [
  "referralFee",
  "paymentFee",
  "fulfilmentFee",
  "vatOnFees",
  "shippingCost"
];
function parseExcludedFees(body) {
  const raw = body.excludedFees;
  if (raw === void 0) return /* @__PURE__ */ new Set();
  if (!Array.isArray(raw) || !raw.every((f) => VALID_EXCLUDABLE_FEES.includes(f))) {
    throw new ApiError(400, `"excludedFees" must be an array of: ${VALID_EXCLUDABLE_FEES.join(", ")}`);
  }
  return new Set(raw);
}
function parseCustomFees(body) {
  const raw = body.customFees;
  if (raw === void 0) return [];
  if (!Array.isArray(raw)) throw new ApiError(400, '"customFees" must be an array');
  return raw.map((entry, i) => {
    if (!isRecord(entry)) throw new ApiError(400, `customFees[${i}] must be an object`);
    const type = entry.type;
    if (type !== "fixed_per_item" && type !== "percentage_of_sale" && type !== "percentage_of_profit") {
      throw new ApiError(400, `customFees[${i}].type is invalid`);
    }
    return {
      id: typeof entry.id === "string" ? entry.id : `custom-${i}`,
      label: requireString(entry, "label"),
      type,
      value: requireNumber(entry, "value")
    };
  });
}
function parseCommonOptions(body) {
  return {
    costPrice: requireNumber(body, "costPrice"),
    vatRegistered: body.vatRegistered === true,
    vatRate: optionalNumber(body, "vatRate", 0.2),
    fulfilmentModeId: requireString(body, "fulfilmentModeId"),
    shippingCost: optionalNumber(body, "shippingCost", 0),
    ...typeof body.weightGrams === "number" ? { weightGrams: body.weightGrams } : {},
    customFees: parseCustomFees(body),
    excludedFees: parseExcludedFees(body)
  };
}
function resolveMarketplace(body) {
  const id = requireString(body, "marketplaceId");
  const config = getMarketplace(id);
  if (!config) throw new ApiError(404, `Unknown marketplaceId "${id}"`);
  return config;
}
function handleListMarketplaces() {
  return { marketplaces: listMarketplaces() };
}
function handleGetMarketplace(id) {
  const config = getMarketplace(id);
  if (!config) throw new ApiError(404, `Unknown marketplaceId "${id}"`);
  return config;
}
function handleCalculate(body, withTrace) {
  if (!isRecord(body)) throw new ApiError(400, "Request body must be a JSON object");
  const config = resolveMarketplace(body);
  const options = {
    ...parseCommonOptions(body),
    sellingPrice: requireNumber(body, "sellingPrice")
  };
  if (withTrace) return calculateFeesWithTrace(config, options);
  return { breakdown: calculateFees(config, options) };
}
var VALID_TARGET_MODES = ["fixed", "margin"];
function handleSolve(body) {
  if (!isRecord(body)) throw new ApiError(400, "Request body must be a JSON object");
  const config = resolveMarketplace(body);
  const targetMode = body.targetMode;
  if (!VALID_TARGET_MODES.includes(targetMode)) {
    throw new ApiError(400, '"targetMode" must be "fixed" or "margin"');
  }
  const options = {
    ...parseCommonOptions(body),
    targetMode,
    targetNetProfit: optionalNumber(body, "targetNetProfit", 0),
    targetMargin: optionalNumber(body, "targetMargin", 0)
  };
  return solveForPrice(config, options);
}
function handleEbayCost(body) {
  if (!isRecord(body)) throw new ApiError(400, "Request body must be a JSON object");
  return buildEbayCost({
    costPerBatch: requireNumber(body, "costPerBatch"),
    uom: optionalNumber(body, "uom", 1),
    qtyRequired: optionalNumber(body, "qtyRequired", 1),
    discountRate: optionalNumber(body, "discountRate", 0),
    packingMaterials: optionalNumber(body, "packingMaterials", 0),
    ppCost: optionalNumber(body, "ppCost", 0),
    ppIncludedInPrice: body.ppIncludedInPrice === true,
    vatOnSellingPrice: optionalNumber(body, "vatOnSellingPrice", 0),
    listingFee: optionalNumber(body, "listingFee", 0),
    adCost: optionalNumber(body, "adCost", 0)
  });
}
async function router(req, res) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const { pathname, searchParams } = url;
  const method = req.method ?? "GET";
  if (pathname === "/api" && method === "GET") {
    return {
      name: "Margin Desk API",
      endpoints: [
        "GET  /api/marketplaces",
        "GET  /api/marketplaces/:id",
        "POST /api/calculate",
        "POST /api/solve",
        "POST /api/ebay-cost"
      ]
    };
  }
  if (pathname === "/api/marketplaces" && method === "GET") {
    return handleListMarketplaces();
  }
  const marketplaceMatch = pathname.match(/^\/api\/marketplaces\/([^/]+)$/);
  if (marketplaceMatch && method === "GET") {
    return handleGetMarketplace(decodeURIComponent(marketplaceMatch[1]));
  }
  if (pathname === "/api/calculate" && method === "POST") {
    return handleCalculate(await readBody(req), searchParams.get("trace") === "true");
  }
  if (pathname === "/api/solve" && method === "POST") {
    return handleSolve(await readBody(req));
  }
  if (pathname === "/api/ebay-cost" && method === "POST") {
    return handleEbayCost(await readBody(req));
  }
  throw new ApiError(404, `No route for ${method} ${pathname}`);
}
var server = (0, import_http.createServer)((req, res) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  Promise.resolve().then(() => {
    checkAuth(req);
    return router(req, res);
  }).then((result) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
  }).catch((err) => {
    const status = err instanceof ApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Internal server error";
    if (status === 500) console.error(err);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: message }));
  });
});
server.listen(PORT, () => {
  console.log(`Margin Desk API listening on http://localhost:${PORT}`);
});

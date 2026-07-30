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
    { rate: 0.129 }
    // 12.9% -- catch-all (no upTo)
  ],
  closingFee: 0,
  paymentFee: {
    percentage: 0,
    // payment processing is bundled into the referral rate above
    fixed: 36
    // £0.36 flat per item
  },
  vatOnFees: true,
  fulfilmentModes: [
    { id: "self", label: "Self-fulfilled", fee: 0 }
  ],
  referralFeeLabel: "eBay Final Value Fee",
  paymentFeeLabel: "eBay flat fee"
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
function calcReferralFee(sellingPrice, config, rateOverride) {
  if (rateOverride !== void 0) {
    return { fee: roundPence(sellingPrice * rateOverride), rate: rateOverride, minimum: 0 };
  }
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
  const referral = calcReferralFee(sellingPrice, config, options.referralRateOverride);
  const referralFee = excludedFees.has("referralFee") ? 0 : referral.fee;
  const closingFee = config.closingFee;
  const paymentFeeConfig = options.paymentFeeOverride ?? config.paymentFee;
  const rawPaymentFee = roundPence(
    sellingPrice * paymentFeeConfig.percentage + paymentFeeConfig.fixed
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
  const paymentFormula = paymentFeeConfig.fixed > 0 ? `${sellingPrice} \xD7 ${paymentFeeConfig.percentage} + ${paymentFeeConfig.fixed}` : `${sellingPrice} \xD7 ${paymentFeeConfig.percentage}`;
  const vatFormula = !config.vatOnFees ? "not applicable for this marketplace" : !vatRegistered ? "not applicable (not VAT registered)" : `${marketplaceFeeSubtotal} \xD7 ${vatRate}`;
  const referralLabel = config.referralFeeLabel ?? "Referral fee";
  const paymentLabel = config.paymentFeeLabel ?? "Payment processing fee";
  const formulas = [
    { label: referralLabel, formula: referralFormula, amount: referral.fee, excluded: excludedFees.has("referralFee") },
    { label: "Closing fee", formula: "fixed per item", amount: closingFee },
    { label: paymentLabel, formula: paymentFormula, amount: rawPaymentFee, excluded: excludedFees.has("paymentFee") },
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
    paymentPercentage: paymentFeeConfig.percentage,
    paymentFixed: paymentFeeConfig.fixed,
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
var MAX_RATCHET_STEPS = 20;
function estimateSellingPrice(config, options) {
  const { costPrice, shippingCost, excludedFees } = options;
  const paymentFeeConfig = options.paymentFeeOverride ?? config.paymentFee;
  const referralRate = excludedFees.has("referralFee") ? 0 : options.referralRateOverride ?? config.referralFees[0]?.rate ?? 0;
  const paymentRate = excludedFees.has("paymentFee") ? 0 : paymentFeeConfig.percentage;
  const paymentFixed = excludedFees.has("paymentFee") ? 0 : paymentFeeConfig.fixed;
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
  return Math.ceil(currentPrice * options.targetMargin);
}
function ratchetToTarget(config, options, startPrice) {
  let finalPrice = startPrice;
  let { breakdown, trace: feeTrace } = calculateFeesWithTrace(config, { ...options, sellingPrice: finalPrice });
  for (let i = 0; i < MAX_RATCHET_STEPS && breakdown.netProfit < resolveTargetProfit(options, finalPrice); i++) {
    finalPrice += 1;
    ({ breakdown, trace: feeTrace } = calculateFeesWithTrace(config, { ...options, sellingPrice: finalPrice }));
  }
  return { finalPrice, breakdown, feeTrace };
}
function buildFormulaLines(options, algebraicEstimate, estimateFormula, finalPrice) {
  const targetProfitFormula = options.targetMode === "margin" ? `${finalPrice} \xD7 ${options.targetMargin}` : "fixed target amount";
  return [
    { label: "Starting price estimate", formula: estimateFormula, amount: algebraicEstimate },
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
      const { finalPrice, breakdown: finalBreakdown, feeTrace: feeTrace2 } = ratchetToTarget(config, options, price);
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

// src/utils/currency.ts
function formatGBP(pence) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP"
  }).format(pence / 100);
}

// src/engine/breakdown-text.ts
function buildBreakdownRows(b, excluded, labels) {
  const referralLabel = labels.referralFeeLabel ?? "Referral fee";
  const paymentLabel = labels.paymentFeeLabel ?? "Payment fee";
  const rows = [
    { label: "Selling price", amount: b.sellingPrice },
    { label: "Cost price", amount: b.costPrice, isDeduction: true },
    { label: referralLabel, amount: b.referralFee, isDeduction: true, isExcluded: excluded.has("referralFee") }
  ];
  if (b.closingFee > 0) rows.push({ label: "Closing fee", amount: b.closingFee, isDeduction: true });
  rows.push({ label: paymentLabel, amount: b.paymentFee, isDeduction: true, isExcluded: excluded.has("paymentFee") });
  if (b.fulfilmentFee > 0 || excluded.has("fulfilmentFee")) {
    rows.push({ label: "Fulfilment fee", amount: b.fulfilmentFee, isDeduction: true, isExcluded: excluded.has("fulfilmentFee") });
  }
  if (b.shippingCost > 0 || excluded.has("shippingCost")) {
    rows.push({ label: "Shipping", amount: b.shippingCost, isDeduction: true, isExcluded: excluded.has("shippingCost") });
  }
  if (b.vatOnFees > 0 || excluded.has("vatOnFees")) {
    rows.push({ label: "VAT on fees", amount: b.vatOnFees, isDeduction: true, isExcluded: excluded.has("vatOnFees") });
  }
  for (const fee of b.customFees) {
    rows.push({ label: fee.label, amount: fee.amount, isDeduction: true });
  }
  rows.push({ label: "Total deductions", amount: b.totalFees + b.costPrice, isSummary: true });
  return rows;
}
function buildFormulaText(b, excluded, labels) {
  const terms = buildBreakdownRows(b, excluded, labels).filter((r) => !r.isSummary && !r.isExcluded);
  const chain = terms.map((r, i) => {
    const amt = formatGBP(r.amount);
    if (i === 0) return `${r.label} (${amt})`;
    return `${r.isDeduction ? "\u2212" : "+"} ${r.label} (${amt})`;
  }).join(" ");
  return `${chain} = Net profit (${formatGBP(b.netProfit)})`;
}

// src/marketplaces/ebay-cost-builder.ts
function buildCostFormulaText(unitCost, packingMaterials, ppIncludedInPrice, ppCost, vatFixedAmount, listingFee, adFixedAmount, costPrice) {
  const terms = [{ label: "Unit cost", amount: unitCost }];
  if (packingMaterials > 0) terms.push({ label: "Packing materials", amount: packingMaterials });
  if (ppIncludedInPrice && ppCost > 0) terms.push({ label: "P+P", amount: ppCost });
  if (vatFixedAmount > 0) terms.push({ label: "VAT on selling price", amount: vatFixedAmount });
  if (listingFee > 0) terms.push({ label: "Listing fee", amount: listingFee });
  if (adFixedAmount > 0) terms.push({ label: "Ad / promoted listings cost", amount: adFixedAmount });
  const chain = terms.map((t, i) => i === 0 ? `${t.label} (${formatGBP(t.amount)})` : `+ ${t.label} (${formatGBP(t.amount)})`).join(" ");
  return `${chain} = Cost price (${formatGBP(costPrice)})`;
}
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
  const vatFixedAmount = vatOnSellingPrice.mode === "fixed" ? vatOnSellingPrice.amount : 0;
  const adFixedAmount = adCost.mode === "fixed" ? adCost.amount : 0;
  const costPrice = roundPence(
    unitCost + packingMaterials + (ppIncludedInPrice ? ppCost : 0) + vatFixedAmount + listingFee + adFixedAmount
  );
  const shippingCost = ppIncludedInPrice ? 0 : ppCost;
  const generatedCustomFees = [];
  if (vatOnSellingPrice.mode === "rate") {
    generatedCustomFees.push({
      id: "ebay-vat-slice",
      label: "VAT on selling price",
      type: "percentage_of_sale",
      value: vatOnSellingPrice.rate
    });
  }
  if (adCost.mode === "rate") {
    generatedCustomFees.push({
      id: "ebay-ad-cost-rate",
      label: "Ad / promoted listings",
      type: "percentage_of_sale",
      value: adCost.rate
    });
  }
  const vatFormula = vatOnSellingPrice.mode === "fixed" ? { label: "VAT on selling price", formula: "entered amount", amount: vatFixedAmount } : {
    label: "VAT on selling price",
    formula: `${(vatOnSellingPrice.rate * 100).toFixed(2)}% of selling price -- applied as a percentage-of-sale fee, see Fee Calculation`,
    amount: 0
  };
  const adFormula = adCost.mode === "fixed" ? { label: "Ad / promoted listings cost", formula: "fixed amount", amount: adFixedAmount } : {
    label: "Ad / promoted listings cost",
    formula: `${(adCost.rate * 100).toFixed(2)}% of selling price -- applied as a percentage-of-sale fee, see Fee Calculation`,
    amount: 0
  };
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
    vatFormula,
    {
      label: "Listing fee",
      formula: "fixed per listing",
      amount: listingFee
    },
    adFormula,
    {
      label: "Cost price",
      formula: `${unitCost} + ${packingMaterials} + ${ppIncludedInPrice ? ppCost : 0} + ${vatFixedAmount} + ${listingFee} + ${adFixedAmount}`,
      amount: costPrice
    },
    {
      label: "Shipping cost",
      formula: ppIncludedInPrice ? "0 (P+P included in cost price)" : `${ppCost} (P+P charged separately)`,
      amount: shippingCost
    }
  ];
  const formulaText = buildCostFormulaText(
    unitCost,
    packingMaterials,
    ppIncludedInPrice,
    ppCost,
    vatFixedAmount,
    listingFee,
    adFixedAmount,
    costPrice
  );
  return { costPrice, shippingCost, unitCost, generatedCustomFees, formulas, formulaText };
}

// src/marketplaces/ebay-calculator.ts
var MAX_RATCHET_STEPS2 = 20;
function computeStage4(price, fixedCosts, ebayFeeRate, ebayFeeFlat, vatRate, adRate) {
  const ebayFeeAmount = roundPence(price * ebayFeeRate) + ebayFeeFlat;
  const vatAmount = roundPence(price * vatRate);
  const adAmount = roundPence(price * adRate);
  const totalFees = ebayFeeAmount + vatAmount + adAmount;
  const totalCosts = fixedCosts + ebayFeeAmount + vatAmount + adAmount - ebayFeeFlat;
  const profit = price - totalCosts;
  return { ebayFeeAmount, vatAmount, adAmount, totalFees, totalCosts, profit };
}
function targetProfitFor(price, targetMargin) {
  return Math.ceil(price * targetMargin);
}
function roundRate(value) {
  return Math.round(value * 1e6) / 1e6;
}
function calculateEbayPrice(inputs) {
  const {
    costPerBatch,
    uom,
    qtyRequired,
    discountRate,
    packingMaterials,
    ppCost,
    ppIncludedInPrice,
    targetMargin,
    adRate,
    ebayFeeRate,
    ebayFeeFlat,
    vatRate
  } = inputs;
  const safeUom = uom > 0 ? uom : 1;
  const lineCost = roundPence(costPerBatch / safeUom * qtyRequired * (1 - discountRate));
  const ppCostIncluded = ppIncludedInPrice ? ppCost : 0;
  const fixedCosts = lineCost + packingMaterials + ppCostIncluded + ebayFeeFlat;
  const combinedRate = roundRate(ebayFeeRate + vatRate + adRate);
  const divisor = roundRate(1 - combinedRate - targetMargin);
  const converged = divisor > 0;
  const algebraicEstimate = converged ? roundPence(fixedCosts / divisor) : 0;
  const breakEvenDivisor = roundRate(1 - combinedRate);
  const breakEvenPrice = breakEvenDivisor > 0 ? roundPence(fixedCosts / breakEvenDivisor) : 0;
  let suggestedPrice = algebraicEstimate;
  let stage4 = computeStage4(suggestedPrice, fixedCosts, ebayFeeRate, ebayFeeFlat, vatRate, adRate);
  if (converged) {
    for (let i = 0; i < MAX_RATCHET_STEPS2 && stage4.profit < targetProfitFor(suggestedPrice, targetMargin); i++) {
      suggestedPrice += 1;
      stage4 = computeStage4(suggestedPrice, fixedCosts, ebayFeeRate, ebayFeeFlat, vatRate, adRate);
    }
  }
  const profit = stage4.profit;
  const marginPercent = suggestedPrice > 0 ? Math.round(profit / suggestedPrice * 1e4) / 100 : 0;
  const roi = lineCost > 0 ? Math.round(profit / lineCost * 1e4) / 100 : 0;
  let formula = `${fixedCosts}p \xF7 (1 \u2212 ${ebayFeeRate} \u2212 ${vatRate} \u2212 ${adRate} \u2212 ${targetMargin}) = ${algebraicEstimate}p (\xA3${(algebraicEstimate / 100).toFixed(2)})`;
  if (suggestedPrice !== algebraicEstimate) {
    formula += ` \u2192 adjusted to ${suggestedPrice}p (\xA3${(suggestedPrice / 100).toFixed(2)}) to guarantee target margin`;
  }
  return {
    suggestedPrice,
    breakEvenPrice,
    costs: {
      lineCost,
      packingMaterials,
      ppCost: ppCostIncluded,
      ebayFeeFlat,
      fixedCosts
    },
    fees: {
      ebayFeeRate,
      ebayFeeAmount: stage4.ebayFeeAmount,
      vatRate,
      vatAmount: stage4.vatAmount,
      adRate,
      adAmount: stage4.adAmount,
      totalFees: stage4.totalFees
    },
    totalCosts: stage4.totalCosts,
    profit,
    marginPercent,
    roi,
    solver: {
      fixedCosts,
      combinedRate,
      targetMargin,
      divisor,
      formula,
      converged
    },
    inputs: {
      costPerBatch,
      uom,
      qtyRequired,
      discountRate,
      packingMaterials,
      ppCost,
      ppIncludedInPrice,
      targetMargin,
      adRate,
      ebayFeeRate,
      ebayFeeFlat,
      vatRate
    }
  };
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
function optionalNumberOrUndefined(body, key) {
  if (body[key] === void 0) return void 0;
  return requireNumber(body, key);
}
function parsePaymentFeeOverride(body) {
  const raw = body.paymentFeeOverride;
  if (raw === void 0) return void 0;
  if (!isRecord(raw)) throw new ApiError(400, '"paymentFeeOverride" must be an object like { "percentage": 0, "fixed": 36 }');
  return {
    percentage: requireNumber(raw, "percentage"),
    fixed: requireNumber(raw, "fixed")
  };
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
  const referralRateOverride = optionalNumberOrUndefined(body, "referralRateOverride");
  const paymentFeeOverride = parsePaymentFeeOverride(body);
  return {
    costPrice: requireNumber(body, "costPrice"),
    vatRegistered: body.vatRegistered === true,
    vatRate: optionalNumber(body, "vatRate", 0.2),
    fulfilmentModeId: requireString(body, "fulfilmentModeId"),
    shippingCost: optionalNumber(body, "shippingCost", 0),
    ...typeof body.weightGrams === "number" ? { weightGrams: body.weightGrams } : {},
    ...referralRateOverride !== void 0 ? { referralRateOverride } : {},
    ...paymentFeeOverride !== void 0 ? { paymentFeeOverride } : {},
    customFees: parseCustomFees(body),
    excludedFees: parseExcludedFees(body)
  };
}
function parseEbayFeeInput(body, key) {
  const raw = body[key];
  if (raw === void 0) return { mode: "fixed", amount: 0 };
  if (!isRecord(raw)) {
    throw new ApiError(400, `"${key}" must be an object like { "mode": "fixed", "amount": 0 } or { "mode": "rate", "rate": 0 }`);
  }
  if (raw.mode === "rate") return { mode: "rate", rate: requireNumber(raw, "rate") };
  if (raw.mode === "fixed") return { mode: "fixed", amount: requireNumber(raw, "amount") };
  throw new ApiError(400, `"${key}.mode" must be "fixed" or "rate"`);
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
  if (withTrace) {
    const { breakdown: breakdown2, trace } = calculateFeesWithTrace(config, options);
    return { breakdown: breakdown2, trace, formulaText: buildFormulaText(breakdown2, options.excludedFees, config) };
  }
  const breakdown = calculateFees(config, options);
  return { breakdown, formulaText: buildFormulaText(breakdown, options.excludedFees, config) };
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
  const result = solveForPrice(config, options);
  return { ...result, formulaText: buildFormulaText(result.breakdown, options.excludedFees, config) };
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
    vatOnSellingPrice: parseEbayFeeInput(body, "vatOnSellingPrice"),
    listingFee: optionalNumber(body, "listingFee", 0),
    adCost: parseEbayFeeInput(body, "adCost")
  });
}
function parseEbayCalculateRequest(body) {
  return {
    costPerBatch: requireNumber(body, "costPerBatch"),
    uom: requireNumber(body, "uom"),
    qtyRequired: requireNumber(body, "qtyRequired"),
    discountRate: requireNumber(body, "discountRate"),
    packingMaterials: requireNumber(body, "packingMaterials"),
    ppCost: requireNumber(body, "ppCost"),
    ppIncludedInPrice: body.ppIncludedInPrice === true,
    targetMargin: requireNumber(body, "targetMargin"),
    adRate: optionalNumber(body, "adRate", 0),
    ebayFeeRate: optionalNumber(body, "ebayFeeRate", 0.129),
    ebayFeeFlat: optionalNumber(body, "ebayFeeFlat", 36),
    vatRate: optionalNumber(body, "vatRate", 0.1667)
  };
}
function handleEbayCalculate(body) {
  if (!isRecord(body)) throw new ApiError(400, "Request body must be a JSON object");
  return calculateEbayPrice(parseEbayCalculateRequest(body));
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
        "POST /api/ebay-cost",
        "POST /api/ebay-calculate"
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
  if (pathname === "/api/ebay-calculate" && method === "POST") {
    return handleEbayCalculate(await readBody(req));
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

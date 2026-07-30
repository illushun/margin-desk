"use strict";
(() => {
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
  function penceToDecimal(pence) {
    return (pence / 100).toFixed(2);
  }
  function poundsToPence(pounds) {
    const value = typeof pounds === "string" ? parseFloat(pounds) : pounds;
    if (isNaN(value)) return 0;
    return Math.round(value * 100);
  }
  function percentageToRate(percentage) {
    const value = typeof percentage === "string" ? parseFloat(percentage) : percentage;
    if (isNaN(value)) return 0;
    return value / 100;
  }

  // src/ui/render.ts
  function animateCountUp(el2, targetPence, duration = 550) {
    const isNegative = targetPence < 0;
    const abs = Math.abs(targetPence);
    const start = performance.now();
    function tick(now) {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el2.textContent = (isNegative ? "-" : "") + formatGBP(Math.round(abs * eased));
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  function readExcluded() {
    const excluded = /* @__PURE__ */ new Set();
    const ids = ["referralFee", "paymentFee", "fulfilmentFee", "vatOnFees", "shippingCost"];
    for (const id of ids) {
      const cb = document.getElementById(`exclude-${id}`);
      if (cb?.checked) excluded.add(id);
    }
    return excluded;
  }
  function buildRows(b, excluded) {
    const rows = [
      { label: "Selling price", amount: b.sellingPrice },
      { label: "Cost price", amount: b.costPrice, isDeduction: true },
      { label: "Referral fee", amount: b.referralFee, isDeduction: true, isExcluded: excluded.has("referralFee") }
    ];
    if (b.closingFee > 0) rows.push({ label: "Closing fee", amount: b.closingFee, isDeduction: true });
    rows.push({ label: "Payment fee", amount: b.paymentFee, isDeduction: true, isExcluded: excluded.has("paymentFee") });
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
  function buildBreakdownHTML(b, excluded) {
    const rows = buildRows(b, excluded);
    const tableRows = rows.map((r) => {
      let cls = "";
      if (r.isDeduction) cls = "deduction";
      if (r.isSummary) cls = "summary";
      if (r.isExcluded) cls += " excluded";
      const prefix = r.isDeduction ? "-" : "";
      const amt = r.isExcluded ? `<s>${prefix}${formatGBP(r.amount)}</s> <span class="debug-tag">excl.</span>` : `${prefix}${formatGBP(r.amount)}`;
      return `<tr class="${cls.trim()}">
      <td class="row-label">${r.label}</td>
      <td class="row-amount">${amt}</td>
    </tr>`;
    }).join("");
    return `<table class="breakdown-table"><tbody>${tableRows}</tbody></table>`;
  }
  function renderBreakdown(container, breakdown) {
    const excluded = readExcluded();
    const cls = breakdown.netProfit >= 0 ? "positive" : "negative";
    container.innerHTML = `
    <div class="result-hero">
      <p class="result-hero-label">Net profit</p>
      <p class="result-hero-amount ${cls}" id="hero-amount"></p>
    </div>

    <div class="metrics">
      <div class="metric">
        <span class="metric-label">Net margin</span>
        <span class="metric-value ${cls}">${breakdown.netMargin.toFixed(1)}%</span>
      </div>
      <div class="metric">
        <span class="metric-label">ROI</span>
        <span class="metric-value ${cls}">${breakdown.roi.toFixed(1)}%</span>
      </div>
    </div>

    <p class="breakdown-section-title">Breakdown</p>
    ${buildBreakdownHTML(breakdown, excluded)}

    <button class="btn-workings" id="open-workings">Show workings</button>
  `;
    const heroEl = container.querySelector("#hero-amount");
    if (heroEl) animateCountUp(heroEl, breakdown.netProfit);
    container.querySelector("#open-workings")?.addEventListener("click", () => {
      const modal = document.getElementById("workings-modal");
      const backdrop = document.getElementById("workings-backdrop");
      modal?.classList.add("open");
      backdrop?.classList.add("open");
    });
  }
  function renderSolverResult(container, result) {
    const excluded = readExcluded();
    container.innerHTML = `
    <div class="result-hero solver-mode">
      <p class="result-hero-label">Minimum selling price</p>
      <p class="result-hero-amount" id="hero-amount"></p>
      ${!result.converged ? '<p class="solver-warning" style="margin-top:0.35rem;font-size:0.72rem;">Result may not be exact.</p>' : ""}
    </div>

    <div class="metrics">
      <div class="metric">
        <span class="metric-label">Net margin</span>
        <span class="metric-value positive">${result.breakdown.netMargin.toFixed(1)}%</span>
      </div>
      <div class="metric">
        <span class="metric-label">ROI</span>
        <span class="metric-value positive">${result.breakdown.roi.toFixed(1)}%</span>
      </div>
    </div>

    <p class="breakdown-section-title">Breakdown</p>
    ${buildBreakdownHTML(result.breakdown, excluded)}

    <button class="btn-workings" id="open-workings">Show workings</button>
  `;
    const heroEl = container.querySelector("#hero-amount");
    if (heroEl) animateCountUp(heroEl, result.requiredSellingPrice);
    container.querySelector("#open-workings")?.addEventListener("click", () => {
      const modal = document.getElementById("workings-modal");
      const backdrop = document.getElementById("workings-backdrop");
      modal?.classList.add("open");
      backdrop?.classList.add("open");
    });
  }
  function renderError(container, message) {
    container.innerHTML = `<p class="error-message">${message}</p>`;
  }

  // src/ui/debug.ts
  function gbp(pence) {
    return formatGBP(pence);
  }
  function row(label, formula, result, excluded = false) {
    const cls = excluded ? ' class="debug-excluded"' : "";
    return `
    <tr${cls}>
      <td class="debug-label">${label}</td>
      <td class="debug-formula">${formula}</td>
      <td class="debug-result">${excluded ? `<s>${result}</s> <span class="debug-tag">excluded</span>` : result}</td>
    </tr>
  `;
  }
  function section(title, rows) {
    return `
    <div class="debug-section">
      <p class="debug-section-title">${title}</p>
      <table class="debug-table">
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  }
  var EBAY_COST_HIDE_IF_ZERO = /* @__PURE__ */ new Set([
    "Packing materials",
    "VAT on selling price",
    "Listing fee",
    "Ad / promoted listings cost"
  ]);
  var EBAY_COST_TOTAL_LABELS = /* @__PURE__ */ new Set(["Cost price", "Shipping cost"]);
  function renderEbayCostTrace(t) {
    let rows = "";
    for (const f of t.formulas) {
      if (EBAY_COST_HIDE_IF_ZERO.has(f.label) && f.amount === 0) continue;
      rows += EBAY_COST_TOTAL_LABELS.has(f.label) ? `
        <tr class="debug-total">
          <td class="debug-label">${f.label}</td>
          <td class="debug-formula">${f.formula}</td>
          <td class="debug-result">${gbp(f.amount)}</td>
        </tr>
      ` : row(f.label, f.formula, gbp(f.amount));
    }
    return section("Cost Builder", rows);
  }
  var FEE_TRACE_HIDE_IF_ZERO = /* @__PURE__ */ new Set([
    "Closing fee",
    "Payment processing fee",
    "Fulfilment fee",
    "Shipping cost",
    "VAT on fees"
  ]);
  function renderFeeTrace(t) {
    let rows = "";
    for (const f of t.formulas) {
      if (FEE_TRACE_HIDE_IF_ZERO.has(f.label) && f.amount === 0 && !f.excluded) continue;
      if (f.label === "Total deductions") {
        rows += `
        <tr class="debug-total">
          <td class="debug-label">${f.label}</td>
          <td class="debug-formula">${f.formula}</td>
          <td class="debug-result">${gbp(f.amount)}</td>
        </tr>
      `;
      } else if (f.label === "Net profit") {
        rows += `
        <tr class="debug-profit">
          <td class="debug-label">${f.label}</td>
          <td class="debug-formula">${f.formula}</td>
          <td class="debug-result ${f.amount >= 0 ? "positive" : "negative"}">${gbp(f.amount)}</td>
        </tr>
      `;
      } else {
        rows += row(f.label, f.formula, gbp(f.amount), f.excluded);
      }
    }
    return section("Fee Calculation", rows);
  }
  function renderSolverTrace(t) {
    const targetLabel = t.targetMode === "margin" ? `${(t.targetMargin * 100).toFixed(1)}% net margin` : `${gbp(t.targetNetProfit)} net profit`;
    const estimateFormula = t.formulas.find((f) => f.label === "Starting price estimate");
    const targetProfitFormula = t.formulas.find((f) => f.label === "Target profit");
    let rows = `
    <tr>
      <td class="debug-label">Target</td>
      <td class="debug-formula" colspan="2">${targetLabel}</td>
      <td class="debug-result">${targetProfitFormula ? gbp(targetProfitFormula.amount) : ""}</td>
    </tr>
    <tr>
      <td class="debug-label">Starting price estimate</td>
      <td class="debug-formula" colspan="2">${estimateFormula?.formula ?? ""}</td>
      <td class="debug-result">${gbp(t.algebraicEstimate)}</td>
    </tr>
    <tr class="debug-iter-header">
      <td>Iteration</td>
      <td>Price</td>
      <td>Net profit</td>
      <td>Error</td>
    </tr>
  `;
    for (const iter of t.iterations) {
      const errorStr = iter.error > 0 ? `+${gbp(iter.error)}` : gbp(iter.error);
      rows += `
      <tr class="debug-iter">
        <td class="debug-label">#${iter.iteration}</td>
        <td>${gbp(iter.price)}</td>
        <td>${gbp(iter.netProfit)}</td>
        <td class="${Math.abs(iter.error) <= 1 ? "positive" : ""}">${errorStr}</td>
      </tr>
    `;
    }
    rows += `
    <tr class="debug-total">
      <td class="debug-label">Final price</td>
      <td colspan="3">${gbp(t.finalPrice)} (converged in ${t.iterations.length} iteration${t.iterations.length !== 1 ? "s" : ""})</td>
    </tr>
  `;
    return section("Solver Trace", rows);
  }
  function renderDebugTrace(container, trace) {
    let html = "";
    if (trace.ebayCost) html += renderEbayCostTrace(trace.ebayCost);
    html += renderFeeTrace(trace.fees);
    if (trace.solver) html += renderSolverTrace(trace.solver);
    container.innerHTML = html;
  }
  function clearDebugTrace(container) {
    container.innerHTML = '<p class="debug-empty">Run a calculation to see the workings.</p>';
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
    return { costPrice, shippingCost, unitCost, generatedCustomFees, formulas };
  }

  // src/ui/icons.ts
  var icons = {
    marketplace: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.5 3h2l2.6 12.4a2 2 0 0 0 2 1.6h8.4a2 2 0 0 0 2-1.6L21 8H6"/></svg>',
    cost: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 12h.01M18 12h.01"/></svg>',
    fees: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.59 3.17H4a1 1 0 0 0-1 1v5.59c0 .53.21 1.04.59 1.41l9.58 9.58a2 2 0 0 0 2.83 0l4.59-4.59a2 2 0 0 0 0-2.83Z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>'
  };

  // src/ui/app.ts
  var customFees = [];
  var customFeeCounter = 0;
  var currentStep = 1;
  var visitedSteps = /* @__PURE__ */ new Set([1]);
  var lastEbayCostResult;
  var el = (id) => document.getElementById(id);
  function getSteps() {
    const isEbay = el("marketplace").value === "ebay-uk";
    return isEbay ? [1, 2, 3, 4] : [1, 3, 4];
  }
  function totalSteps() {
    return getSteps().length;
  }
  function stepIndex() {
    return getSteps().indexOf(currentStep);
  }
  function goToStep(id) {
    currentStep = id;
    visitedSteps.add(id);
    [1, 2, 3, 4].forEach((n) => {
      el(`step-panel-${n}`).classList.toggle("active", n === id);
    });
    const topBack = el("topbar-back");
    const barBack = el("bar-back");
    const isFirst = stepIndex() === 0;
    topBack.classList.toggle("hidden", isFirst);
    barBack.classList.toggle("hidden", isFirst);
    const isLast = stepIndex() === totalSteps() - 1;
    el("bar-next").textContent = isLast ? "Calculate" : "Continue";
    updateStepDots();
    updateStepEyebrows();
    updateSummarySheet();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function next() {
    const steps = getSteps();
    const idx = stepIndex();
    if (idx < steps.length - 1) {
      goToStep(steps[idx + 1]);
    } else {
      runAndShowResult();
    }
  }
  function prev() {
    const steps = getSteps();
    const idx = stepIndex();
    if (idx > 0) goToStep(steps[idx - 1]);
  }
  function updateStepDots() {
    const dots = el("step-dots");
    const steps = getSteps();
    dots.innerHTML = steps.map((id) => {
      let cls = "step-dot";
      if (id === currentStep) cls += " active";
      else if (visitedSteps.has(id) && id !== currentStep) cls += " complete";
      return `<div class="${cls}"></div>`;
    }).join("");
  }
  function updateStepEyebrows() {
    const steps = getSteps();
    const idx = steps.indexOf(currentStep) + 1;
    const total = steps.length;
    const isEbay = el("marketplace").value === "ebay-uk";
    const s2 = el("step-2-eyebrow");
    const s3 = el("step-3-eyebrow");
    const s4 = el("step-4-eyebrow");
    if (s2) s2.textContent = `Step ${idx} of ${total}`;
    if (s3) s3.textContent = `Step ${idx} of ${total}`;
    if (s4) s4.textContent = `Step ${idx} of ${total}`;
    const sub3 = el("step-3-sub");
    if (sub3) {
      sub3.textContent = isEbay ? "Add eBay fees, VAT, and any items to exclude." : "Enter your cost, shipping, and any items to exclude.";
    }
  }
  function populateMarketplaceSelect() {
    const select = el("marketplace");
    listMarketplaces().forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.name;
      select.appendChild(opt);
    });
  }
  function populateFulfilmentModes(id) {
    const config = getMarketplace(id);
    const select = el("fulfilment-mode");
    select.innerHTML = "";
    config?.fulfilmentModes.forEach((mode) => {
      const opt = document.createElement("option");
      opt.value = mode.id;
      opt.textContent = mode.label;
      select.appendChild(opt);
    });
    const hasWeightBands = config?.fulfilmentModes.some((m) => Array.isArray(m.fee)) ?? false;
    el("weight-group").style.display = hasWeightBands ? "block" : "none";
  }
  function applyMarketplaceContext() {
    const isEbay = el("marketplace").value === "ebay-uk";
    el("manual-cost-group").style.display = isEbay ? "none" : "block";
    el("ebay-fees-group").style.display = isEbay ? "block" : "none";
  }
  function readEbayFeeInput(modeId, valueId) {
    const mode = el(modeId).value;
    const raw = el(valueId).value;
    return mode === "rate" ? { mode: "rate", rate: percentageToRate(raw) } : { mode: "fixed", amount: poundsToPence(raw) };
  }
  function updateEbayFeeInputLabel(modeId, valueLabelId, valueInputId, fixedPlaceholder, ratePlaceholder) {
    const mode = el(modeId).value;
    el(valueLabelId).textContent = mode === "rate" ? "Rate (%)" : "Amount (\xA3)";
    el(valueInputId).placeholder = mode === "rate" ? ratePlaceholder : fixedPlaceholder;
  }
  function applyEbayCostBuilder() {
    const ppIncluded = el("ebay-pp-included").checked;
    const result = buildEbayCost({
      costPerBatch: poundsToPence(el("ebay-cost-per-batch").value),
      uom: parseFloat(el("ebay-uom").value) || 1,
      qtyRequired: parseFloat(el("ebay-qty-required").value) || 1,
      discountRate: percentageToRate(el("ebay-discount").value),
      packingMaterials: poundsToPence(el("ebay-packing-materials").value),
      ppCost: poundsToPence(el("ebay-pp-cost").value),
      ppIncludedInPrice: ppIncluded,
      vatOnSellingPrice: readEbayFeeInput("ebay-vat-mode", "ebay-vat-value"),
      listingFee: poundsToPence(el("ebay-listing-fee").value),
      adCost: readEbayFeeInput("ebay-ad-mode", "ebay-ad-value")
    });
    el("cost-price-ebay").value = String(result.costPrice);
    el("shipping-cost-ebay").value = String(result.shippingCost);
    const excl = el("exclude-shippingCost");
    excl.checked = ppIncluded || excl.checked;
    excl.disabled = ppIncluded;
    return result;
  }
  function renderCustomFeeList() {
    const list = el("custom-fee-list");
    list.innerHTML = "";
    customFees.forEach((fee) => {
      const item = document.createElement("div");
      item.className = "custom-fee-item";
      const displayValue = fee.type === "fixed_per_item" ? `\xA3${penceToDecimal(fee.value)}` : `${(fee.value * 100).toFixed(2)}%`;
      const typeLabel = {
        fixed_per_item: "Fixed",
        percentage_of_sale: "% sale",
        percentage_of_profit: "% profit"
      };
      item.innerHTML = `
      <span class="fee-label">${fee.label}</span>
      <span class="fee-meta">${typeLabel[fee.type]} \xB7 ${displayValue}</span>
      <button class="remove-fee" data-id="${fee.id}">Remove</button>
    `;
      list.appendChild(item);
    });
    list.querySelectorAll(".remove-fee").forEach((btn) => {
      btn.addEventListener("click", () => {
        customFees = customFees.filter((f) => f.id !== btn.dataset.id);
        renderCustomFeeList();
      });
    });
  }
  function addCustomFee() {
    const labelInput = el("custom-fee-label");
    const typeSelect = el("custom-fee-type");
    const valueInput = el("custom-fee-value");
    const label = labelInput.value.trim();
    const type = typeSelect.value;
    const rawValue = parseFloat(valueInput.value);
    if (!label) {
      labelInput.focus();
      return;
    }
    if (isNaN(rawValue) || rawValue < 0) {
      valueInput.focus();
      return;
    }
    const value = type === "fixed_per_item" ? poundsToPence(rawValue) : percentageToRate(rawValue);
    customFees.push({ id: `custom-${++customFeeCounter}`, label, type, value });
    labelInput.value = "";
    valueInput.value = "";
    renderCustomFeeList();
  }
  function readExcludedFees() {
    const excluded = /* @__PURE__ */ new Set();
    const ids = ["referralFee", "paymentFee", "fulfilmentFee", "vatOnFees", "shippingCost"];
    for (const id of ids) {
      const cb = document.getElementById(`exclude-${id}`);
      if (cb?.checked) excluded.add(id);
    }
    return excluded;
  }
  function buildBaseOptions() {
    const isEbay = el("marketplace").value === "ebay-uk";
    lastEbayCostResult = isEbay ? applyEbayCostBuilder() : void 0;
    const costPrice = isEbay ? parseInt(el("cost-price-ebay").value || "0") : poundsToPence(el("cost-price").value);
    const shippingCost = isEbay ? parseInt(el("shipping-cost-ebay").value || "0") : poundsToPence(el("shipping-cost").value);
    const weightRaw = parseFloat(el("weight-grams").value);
    const opts = {
      costPrice,
      vatRegistered: el("vat-registered").checked,
      vatRate: 0.2,
      fulfilmentModeId: el("fulfilment-mode").value,
      shippingCost,
      customFees: lastEbayCostResult ? [...customFees, ...lastEbayCostResult.generatedCustomFees] : customFees,
      excludedFees: readExcludedFees()
    };
    if (!isNaN(weightRaw)) opts.weightGrams = weightRaw;
    return opts;
  }
  function openResultSheet() {
    el("result-backdrop").classList.add("open");
    el("result-sheet").classList.add("open");
  }
  function closeResultSheet() {
    el("result-backdrop").classList.remove("open");
    el("result-sheet").classList.remove("open");
  }
  function runAndShowResult() {
    const marketplaceId = el("marketplace").value;
    const config = getMarketplace(marketplaceId);
    const resultBody = el("result-body");
    const debugContainer = el("debug-content");
    const mode = el("bar-next").dataset.calcMode ?? "calculate";
    if (!config) {
      renderError(resultBody, "Please select a marketplace.");
      openResultSheet();
      return;
    }
    if (mode === "solve") {
      const targetMode = el("target-mode").value;
      const rawValue = parseFloat(el("target-profit").value);
      if (isNaN(rawValue) || rawValue < 0) {
        el("step-4-warning").textContent = "Please enter a valid target.";
        el("step-4-warning").style.display = "block";
        return;
      }
      el("step-4-warning").style.display = "none";
      const solverOpts = {
        ...buildBaseOptions(),
        targetMode,
        targetNetProfit: targetMode === "fixed" ? poundsToPence(rawValue) : 0,
        targetMargin: targetMode === "margin" ? percentageToRate(rawValue) : 0
      };
      const result = solveForPrice(config, solverOpts);
      renderSolverResult(resultBody, result);
      const debugTrace = lastEbayCostResult ? { fees: result.trace.feeTrace, solver: result.trace, ebayCost: lastEbayCostResult } : { fees: result.trace.feeTrace, solver: result.trace };
      renderDebugTrace(debugContainer, debugTrace);
    } else {
      const sellingPrice = poundsToPence(el("selling-price").value);
      if (sellingPrice <= 0) {
        el("step-4-warning").textContent = "Please enter a valid selling price.";
        el("step-4-warning").style.display = "block";
        return;
      }
      el("step-4-warning").style.display = "none";
      const { breakdown, trace: feeTrace } = calculateFeesWithTrace(config, { ...buildBaseOptions(), sellingPrice });
      renderBreakdown(resultBody, breakdown);
      const debugTrace = lastEbayCostResult ? { fees: feeTrace, ebayCost: lastEbayCostResult } : { fees: feeTrace };
      renderDebugTrace(debugContainer, debugTrace);
    }
    openResultSheet();
  }
  function setMode(mode) {
    el("calculate-group").style.display = mode === "calculate" ? "block" : "none";
    el("solve-group").style.display = mode === "solve" ? "block" : "none";
    el("mode-calculate").classList.toggle("active", mode === "calculate");
    el("mode-solve").classList.toggle("active", mode === "solve");
    el("bar-next").dataset.calcMode = mode;
  }
  function updateTargetInputLabel() {
    const mode = el("target-mode").value;
    const label = el("target-profit-label");
    const input = el("target-profit");
    if (mode === "margin") {
      label.textContent = "Target net margin (%)";
      input.placeholder = "20";
      input.step = "0.1";
    } else {
      label.textContent = "Target net profit (\xA3)";
      input.placeholder = "5.00";
      input.step = "0.01";
    }
  }
  function updateSummarySheet() {
    const isEbay = el("marketplace").value === "ebay-uk";
    const config = getMarketplace(el("marketplace").value);
    const modeEl = el("fulfilment-mode");
    const modeLabel = modeEl.options[modeEl.selectedIndex]?.text ?? "";
    const rows = [
      {
        icon: icons.marketplace,
        key: "Marketplace",
        val: config ? `${config.name} / ${modeLabel}` : "Not set",
        step: 1,
        visited: true
      },
      {
        icon: icons.cost,
        key: "Cost",
        val: (() => {
          if (isEbay) {
            const cost2 = parseFloat(el("ebay-cost-per-batch").value);
            const uom = parseFloat(el("ebay-uom").value) || 1;
            const qty = parseFloat(el("ebay-qty-required").value) || 1;
            const disc = parseFloat(el("ebay-discount").value) || 0;
            if (cost2 > 0) return `${formatGBP(Math.round(cost2 / uom * qty * (1 - disc / 100) * 100))} unit cost`;
            return "Not set";
          }
          const cost = parseFloat(el("cost-price").value);
          return cost > 0 ? formatGBP(Math.round(cost * 100)) : "Not set";
        })(),
        step: isEbay ? 2 : 3,
        visited: visitedSteps.has(isEbay ? 2 : 3)
      },
      {
        icon: icons.fees,
        key: "Fees",
        val: (() => {
          const vatReg = el("vat-registered").checked;
          const excl = [];
          ["referralFee", "paymentFee", "fulfilmentFee", "shippingCost", "vatOnFees"].forEach((id) => {
            if (document.getElementById(`exclude-${id}`)?.checked) excl.push(id.replace(/Fee|Cost/, ""));
          });
          const parts = [vatReg ? "VAT reg" : null, excl.length ? `excl. ${excl.join(", ")}` : null].filter(Boolean);
          return parts.join(" \xB7 ") || "Standard";
        })(),
        step: 3,
        visited: visitedSteps.has(3)
      },
      {
        icon: icons.target,
        key: "Target",
        val: (() => {
          const calcMode = el("bar-next").dataset.calcMode ?? "calculate";
          if (calcMode === "solve") {
            const tm = el("target-mode").value;
            const val = parseFloat(el("target-profit").value);
            return tm === "margin" ? val > 0 ? `${val}% margin` : "Not set" : val > 0 ? `${formatGBP(Math.round(val * 100))} profit` : "Not set";
          }
          const sp = parseFloat(el("selling-price").value);
          return sp > 0 ? `Sell at ${formatGBP(Math.round(sp * 100))}` : "Not set";
        })(),
        step: 4,
        visited: visitedSteps.has(4)
      }
    ];
    el("summary-body").innerHTML = rows.map((r) => `
    <div class="overview-row ${r.visited ? "" : "dimmed"}">
      <div class="overview-icon">${r.icon}</div>
      <div class="overview-meta">
        <div class="overview-key">${r.key}</div>
        <div class="overview-val ${r.val === "Not set" ? "placeholder" : ""}">${r.val}</div>
      </div>
      <button class="edit-btn" data-step="${r.step}">Edit</button>
    </div>
  `).join("");
    el("summary-body").querySelectorAll(".edit-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        closeSummarySheet();
        goToStep(parseInt(btn.dataset.step ?? "1"));
      });
    });
  }
  function openSummarySheet() {
    updateSummarySheet();
    el("summary-backdrop").classList.add("open");
    el("summary-sheet").classList.add("open");
  }
  function closeSummarySheet() {
    el("summary-backdrop").classList.remove("open");
    el("summary-sheet").classList.remove("open");
  }
  document.addEventListener("DOMContentLoaded", () => {
    populateMarketplaceSelect();
    const first = listMarketplaces()[0];
    if (first) populateFulfilmentModes(first.id);
    applyMarketplaceContext();
    el("marketplace").addEventListener("change", (e) => {
      const id = e.target.value;
      populateFulfilmentModes(id);
      applyMarketplaceContext();
    });
    el("bar-next").dataset.calcMode = "calculate";
    el("bar-next").addEventListener("click", () => {
      const isLast = stepIndex() === totalSteps() - 1;
      if (isLast) runAndShowResult();
      else next();
    });
    el("bar-back").addEventListener("click", prev);
    el("topbar-back").addEventListener("click", prev);
    el("mode-calculate").addEventListener("click", () => setMode("calculate"));
    el("mode-solve").addEventListener("click", () => setMode("solve"));
    el("target-mode").addEventListener("change", updateTargetInputLabel);
    el("ebay-vat-mode").addEventListener("change", () => updateEbayFeeInputLabel("ebay-vat-mode", "ebay-vat-value-label", "ebay-vat-value", "4.00", "16.67"));
    el("ebay-ad-mode").addEventListener("change", () => updateEbayFeeInputLabel("ebay-ad-mode", "ebay-ad-value-label", "ebay-ad-value", "0.50", "5"));
    el("ebay-vat-preset-btn").addEventListener("click", () => {
      el("ebay-vat-mode").value = "rate";
      el("ebay-vat-value").value = ((1 - 1 / 1.2) * 100).toFixed(4);
      updateEbayFeeInputLabel("ebay-vat-mode", "ebay-vat-value-label", "ebay-vat-value", "4.00", "16.67");
    });
    el("add-fee-btn").addEventListener("click", addCustomFee);
    el("summary-btn").addEventListener("click", openSummarySheet);
    el("summary-close").addEventListener("click", closeSummarySheet);
    el("summary-backdrop").addEventListener("click", closeSummarySheet);
    el("result-close").addEventListener("click", closeResultSheet);
    el("result-backdrop").addEventListener("click", closeResultSheet);
    el("workings-close").addEventListener("click", () => {
      el("workings-modal").classList.remove("open");
      el("workings-backdrop").classList.remove("open");
    });
    el("workings-backdrop").addEventListener("click", () => {
      el("workings-modal").classList.remove("open");
      el("workings-backdrop").classList.remove("open");
    });
    clearDebugTrace(el("debug-content"));
    goToStep(1);
  });
})();

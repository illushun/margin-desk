"use strict";
(() => {
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
      totalDeductions: totalFees + costPrice,
      netProfit
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
  function pct(rate) {
    return `${(rate * 100).toFixed(3).replace(/\.?0+$/, "")}%`;
  }
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
  function renderEbayCostTrace(t) {
    const discPct = pct(t.discountRate);
    const unitFormula = t.discountRate > 0 ? `(${gbp(t.costPerBatch)} \xF7 ${t.uom}) \xD7 ${t.qtyRequired} \xD7 (1 \u2212 ${discPct})` : `(${gbp(t.costPerBatch)} \xF7 ${t.uom}) \xD7 ${t.qtyRequired}`;
    let rows = row("Unit cost", unitFormula, gbp(t.unitCost));
    if (t.packingMaterials > 0) {
      rows += row("Packing materials", "fixed per item", gbp(t.packingMaterials));
    }
    if (t.ppIncludedInPrice) {
      rows += row("P+P (in price)", "included in cost price", gbp(t.ppCost));
    } else {
      rows += row("P+P (separate)", "charged as shipping", gbp(t.ppCost));
    }
    if (t.vatOnSellingPrice > 0) {
      rows += row("VAT on selling price", "entered amount", gbp(t.vatOnSellingPrice));
    }
    if (t.listingFee > 0) {
      rows += row("Listing fee", "fixed per listing", gbp(t.listingFee));
    }
    if (t.adCost > 0) {
      rows += row("Ad / promoted listings", "fixed amount", gbp(t.adCost));
    }
    rows += `
    <tr class="debug-total">
      <td class="debug-label">Cost price</td>
      <td class="debug-formula">${gbp(t.unitCost)} + overheads</td>
      <td class="debug-result">${gbp(t.costPrice)}</td>
    </tr>
  `;
    if (!t.ppIncludedInPrice && t.ppCost > 0) {
      rows += `
      <tr class="debug-total">
        <td class="debug-label">Shipping cost</td>
        <td class="debug-formula">P+P passed through</td>
        <td class="debug-result">${gbp(t.shippingCost)}</td>
      </tr>
    `;
    }
    return section("Cost Builder", rows);
  }
  function renderFeeTrace(t) {
    let rows = "";
    if (t.referralMinimum > 0 && t.referralFee === t.referralMinimum) {
      rows += row(
        "Referral fee",
        `${gbp(t.sellingPrice)} \xD7 ${pct(t.referralRate)} = ${gbp(Math.round(t.sellingPrice * t.referralRate))} \u2192 minimum applies`,
        gbp(t.referralFee),
        t.referralExcluded
      );
    } else {
      rows += row(
        "Referral fee",
        `${gbp(t.sellingPrice)} \xD7 ${pct(t.referralRate)}`,
        gbp(t.referralFee),
        t.referralExcluded
      );
    }
    if (t.closingFee > 0) {
      rows += row("Closing fee", "fixed per item", gbp(t.closingFee));
    }
    if (t.paymentFee > 0 || t.paymentExcluded) {
      const formula = t.paymentFixed > 0 ? `${gbp(t.sellingPrice)} \xD7 ${pct(t.paymentPercentage)} + ${gbp(t.paymentFixed)}` : `${gbp(t.sellingPrice)} \xD7 ${pct(t.paymentPercentage)}`;
      rows += row("Payment processing fee", formula, gbp(t.paymentFee), t.paymentExcluded);
    }
    if (t.fulfilmentFee > 0 || t.fulfilmentExcluded) {
      rows += row("Fulfilment fee", "weight/mode lookup", gbp(t.fulfilmentFee), t.fulfilmentExcluded);
    }
    if (t.shippingCost > 0 || t.shippingExcluded) {
      rows += row("Shipping cost", "entered amount", gbp(t.shippingCost), t.shippingExcluded);
    }
    if (t.vatOnFees > 0 || t.vatExcluded) {
      rows += row(
        "VAT on fees",
        `${gbp(t.marketplaceFeeSubtotal)} \xD7 ${pct(t.vatRate)}`,
        gbp(t.vatOnFees),
        t.vatExcluded
      );
    }
    for (const fee of t.customFees) {
      rows += row(fee.label, fee.formula, gbp(fee.amount));
    }
    rows += `
    <tr class="debug-total">
      <td class="debug-label">Total deductions</td>
      <td class="debug-formula">all fees + cost price</td>
      <td class="debug-result">${gbp(t.totalDeductions)}</td>
    </tr>
    <tr class="debug-profit">
      <td class="debug-label">Net profit</td>
      <td class="debug-formula">${gbp(t.sellingPrice)} \u2212 ${gbp(t.totalDeductions)}</td>
      <td class="debug-result ${t.netProfit >= 0 ? "positive" : "negative"}">${gbp(t.netProfit)}</td>
    </tr>
  `;
    return section("Fee Calculation", rows);
  }
  function renderSolverTrace(t) {
    const targetLabel = t.targetMode === "margin" ? `${(t.targetMargin * 100).toFixed(1)}% net margin` : `${gbp(t.targetNetProfit)} net profit`;
    let rows = `
    <tr>
      <td class="debug-label">Target</td>
      <td class="debug-formula" colspan="3">${targetLabel}</td>
    </tr>
    <tr>
      <td class="debug-label">Algebraic estimate</td>
      <td class="debug-formula" colspan="3">
        constants \xF7 (1 \u2212 percentage rates) = ${gbp(t.algebraicEstimate)}
      </td>
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
      }
    ];
    return { costPrice, shippingCost, unitCost, formulas };
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
      vatOnSellingPrice: poundsToPence(el("ebay-vat-amount").value),
      listingFee: poundsToPence(el("ebay-listing-fee").value),
      adCost: poundsToPence(el("ebay-ad-cost").value)
    });
    el("cost-price-ebay").value = String(result.costPrice);
    el("shipping-cost-ebay").value = String(result.shippingCost);
    const excl = el("exclude-shippingCost");
    excl.checked = ppIncluded || excl.checked;
    excl.disabled = ppIncluded;
  }
  function buildEbayCostTrace() {
    if (el("marketplace").value !== "ebay-uk") return void 0;
    const ppIncluded = el("ebay-pp-included").checked;
    const costPerBatch = poundsToPence(el("ebay-cost-per-batch").value);
    const uom = parseFloat(el("ebay-uom").value) || 1;
    const qty = parseFloat(el("ebay-qty-required").value) || 1;
    const disc = percentageToRate(el("ebay-discount").value);
    const packing = poundsToPence(el("ebay-packing-materials").value);
    const ppCost = poundsToPence(el("ebay-pp-cost").value);
    const vatAmt = poundsToPence(el("ebay-vat-amount").value);
    const listingFee = poundsToPence(el("ebay-listing-fee").value);
    const adCost = poundsToPence(el("ebay-ad-cost").value);
    const safeUom = uom <= 0 ? 1 : uom;
    const unitCost = Math.round(costPerBatch / safeUom * qty * (1 - disc));
    const costPrice = unitCost + packing + (ppIncluded ? ppCost : 0) + vatAmt + listingFee + adCost;
    return {
      costPerBatch,
      uom,
      qtyRequired: qty,
      discountRate: disc,
      unitCost,
      packingMaterials: packing,
      ppCost,
      ppIncludedInPrice: ppIncluded,
      vatOnSellingPrice: vatAmt,
      listingFee,
      adCost,
      costPrice,
      shippingCost: ppIncluded ? 0 : ppCost
    };
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
    if (isEbay) applyEbayCostBuilder();
    const costPrice = isEbay ? parseInt(el("cost-price-ebay").value || "0") : poundsToPence(el("cost-price").value);
    const shippingCost = isEbay ? parseInt(el("shipping-cost-ebay").value || "0") : poundsToPence(el("shipping-cost").value);
    const weightRaw = parseFloat(el("weight-grams").value);
    const opts = {
      costPrice,
      vatRegistered: el("vat-registered").checked,
      vatRate: 0.2,
      fulfilmentModeId: el("fulfilment-mode").value,
      shippingCost,
      customFees,
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
      const ebayCostTrace = buildEbayCostTrace();
      const debugTrace = ebayCostTrace ? { fees: result.trace.feeTrace, solver: result.trace, ebayCost: ebayCostTrace } : { fees: result.trace.feeTrace, solver: result.trace };
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
      const ebayCostTrace = buildEbayCostTrace();
      const debugTrace = ebayCostTrace ? { fees: feeTrace, ebayCost: ebayCostTrace } : { fees: feeTrace };
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

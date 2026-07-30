import type { EbayCalculatorInputs, EbayCalculateResponse } from '../types';
import { roundPence } from '../utils/math';

/**
 * A one-shot algebraic divide for a percentage-of-price margin target
 * reliably lands a fraction of a penny under the true target once pence
 * rounding applies (e.g. 4.99% when 5% was asked for). The price is
 * ratcheted up a penny at a time afterwards until margin actually clears
 * targetMargin, so the result never falls short of what was requested --
 * same pattern and step budget as engine/solver.ts's ratchetToTarget.
 */
const MAX_RATCHET_STEPS = 20;

interface Stage4Result {
  ebayFeeAmount: number;
  vatAmount: number;
  adAmount: number;
  totalFees: number;
  totalCosts: number;
  profit: number;
}

function computeStage4(
  price: number,
  fixedCosts: number,
  ebayFeeRate: number,
  ebayFeeFlat: number,
  vatRate: number,
  adRate: number,
): Stage4Result {
  const ebayFeeAmount = roundPence(price * ebayFeeRate) + ebayFeeFlat;
  const vatAmount = roundPence(price * vatRate);
  const adAmount = roundPence(price * adRate);
  const totalFees = ebayFeeAmount + vatAmount + adAmount;
  // ebayFeeFlat is already in fixedCosts (Stage 1), so it's subtracted back
  // out here to avoid counting it twice.
  const totalCosts = fixedCosts + ebayFeeAmount + vatAmount + adAmount - ebayFeeFlat;
  const profit = price - totalCosts;
  return { ebayFeeAmount, vatAmount, adAmount, totalFees, totalCosts, profit };
}

/** Ceiling, not nearest-pence: profit is always a whole number of pence, so
 * clearing "at least targetMargin" must round the bar up, same reasoning as
 * engine/solver.ts's resolveTargetProfit. */
function targetProfitFor(price: number, targetMargin: number): number {
  return Math.ceil(price * targetMargin);
}

/** Rounds a decimal rate to 6dp to strip float noise from summing rates
 * (e.g. 0.129 + 0.1667 + 0 -> 0.29569999999999996 without this). */
function roundRate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Calculate a suggested eBay selling price from already-resolved cost and
 * rate inputs (Laravel has already worked out cost lookups, discounts,
 * delivery codes, packing materials, and the target margin -- this function
 * is maths only).
 */
export function calculateEbayPrice(inputs: EbayCalculatorInputs): EbayCalculateResponse {
  const {
    costPerBatch, uom, qtyRequired, discountRate, packingMaterials, ppCost,
    ppIncludedInPrice, targetMargin, adRate, ebayFeeRate, ebayFeeFlat, vatRate,
  } = inputs;

  // Stage 1 -- cost build
  const safeUom = uom > 0 ? uom : 1;
  const lineCost = roundPence((costPerBatch / safeUom) * qtyRequired * (1 - discountRate));
  const ppCostIncluded = ppIncludedInPrice ? ppCost : 0;
  const fixedCosts = lineCost + packingMaterials + ppCostIncluded + ebayFeeFlat;

  // Stage 2 -- rate build
  const combinedRate = roundRate(ebayFeeRate + vatRate + adRate);

  // Stage 3 -- solve for suggested price
  const divisor = roundRate(1 - combinedRate - targetMargin);
  const converged = divisor > 0;
  const algebraicEstimate = converged ? roundPence(fixedCosts / divisor) : 0;

  const breakEvenDivisor = roundRate(1 - combinedRate);
  const breakEvenPrice = breakEvenDivisor > 0 ? roundPence(fixedCosts / breakEvenDivisor) : 0;

  let suggestedPrice = algebraicEstimate;
  let stage4 = computeStage4(suggestedPrice, fixedCosts, ebayFeeRate, ebayFeeFlat, vatRate, adRate);

  if (converged) {
    for (
      let i = 0;
      i < MAX_RATCHET_STEPS && stage4.profit < targetProfitFor(suggestedPrice, targetMargin);
      i++
    ) {
      suggestedPrice += 1;
      stage4 = computeStage4(suggestedPrice, fixedCosts, ebayFeeRate, ebayFeeFlat, vatRate, adRate);
    }
  }

  const profit = stage4.profit;
  const marginPercent = suggestedPrice > 0 ? Math.round((profit / suggestedPrice) * 10000) / 100 : 0;
  const roi = lineCost > 0 ? Math.round((profit / lineCost) * 10000) / 100 : 0;

  let formula = `${fixedCosts}p ÷ (1 − ${ebayFeeRate} − ${vatRate} − ${adRate} − ${targetMargin}) = ${algebraicEstimate}p (£${(algebraicEstimate / 100).toFixed(2)})`;
  if (suggestedPrice !== algebraicEstimate) {
    formula += ` → adjusted to ${suggestedPrice}p (£${(suggestedPrice / 100).toFixed(2)}) to guarantee target margin`;
  }

  return {
    suggestedPrice,
    breakEvenPrice,
    costs: {
      lineCost,
      packingMaterials,
      ppCost: ppCostIncluded,
      ebayFeeFlat,
      fixedCosts,
    },
    fees: {
      ebayFeeRate,
      ebayFeeAmount: stage4.ebayFeeAmount,
      vatRate,
      vatAmount: stage4.vatAmount,
      adRate,
      adAmount: stage4.adAmount,
      totalFees: stage4.totalFees,
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
      converged,
    },
    inputs: {
      costPerBatch, uom, qtyRequired, discountRate, packingMaterials, ppCost,
      ppIncludedInPrice, targetMargin, adRate, ebayFeeRate, ebayFeeFlat, vatRate,
    },
  };
}

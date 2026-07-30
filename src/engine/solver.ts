import type { MarketplaceConfig, SolverOptions, SolverResult, SolverTrace, FormulaLine, FeeTrace, FeeBreakdown } from '../types';
import { calculateFees, calculateFeesWithTrace } from './fees';
import { roundPence } from '../utils/math';

const MAX_ITERATIONS = 100;
const CONVERGENCE_THRESHOLD = 1; // within 1 pence is close enough
const MAX_RATCHET_STEPS = 20; // pennies to nudge up while closing the final gap

/**
 * Algebraically derive a starting estimate for the required selling price.
 *
 * For fees that are a straight percentage of selling price (referral, payment,
 * percentage-of-sale custom fees, and target margin), the relationship is linear:
 *
 *   netProfit = sp - sp * percentageRates - constants
 *   sp = (netProfit + constants) / (1 - percentageRates)
 *
 * When mode is 'margin', the target itself is also a percentage of selling price,
 * so it folds into the divisor rather than the constants.
 *
 * Excluded fees are omitted from both the percentage rates and constants so the
 * estimate stays accurate regardless of which fees are active.
 */
function estimateSellingPrice(
  config: MarketplaceConfig,
  options: SolverOptions,
): { estimate: number; formula: string } {
  const { costPrice, shippingCost, excludedFees } = options;

  const paymentFeeConfig = options.paymentFeeOverride ?? config.paymentFee;
  const referralRate  = excludedFees.has('referralFee') ? 0 : (options.referralRateOverride ?? config.referralFees[0]?.rate ?? 0);
  const paymentRate   = excludedFees.has('paymentFee')  ? 0 : paymentFeeConfig.percentage;
  const paymentFixed  = excludedFees.has('paymentFee')  ? 0 : paymentFeeConfig.fixed;
  const shipping      = excludedFees.has('shippingCost') ? 0 : shippingCost;

  const percentageOfSaleCustomRates = options.customFees
    .filter((f) => f.type === 'percentage_of_sale')
    .reduce((sum, f) => sum + f.value, 0);

  const fixedCustomFees = options.customFees
    .filter((f) => f.type === 'fixed_per_item')
    .reduce((sum, f) => sum + f.value, 0);

  const constants =
    costPrice +
    shipping +
    config.closingFee +
    paymentFixed +
    fixedCustomFees;

  if (options.targetMode === 'margin') {
    const divisor = 1 - referralRate - paymentRate - percentageOfSaleCustomRates - options.targetMargin;
    if (divisor <= 0) {
      return { estimate: roundPence(constants * 10), formula: `${constants} × 10 (percentage rates left no positive divisor)` };
    }
    return {
      estimate: roundPence(constants / divisor),
      formula: `${constants} ÷ (1 − ${referralRate} − ${paymentRate} − ${percentageOfSaleCustomRates} − ${options.targetMargin})`,
    };
  }

  const totalPercentageRate = referralRate + paymentRate + percentageOfSaleCustomRates;
  const divisor = 1 - totalPercentageRate;
  if (divisor <= 0) {
    return { estimate: roundPence(constants + options.targetNetProfit), formula: `${constants} + ${options.targetNetProfit} (percentage rates left no positive divisor)` };
  }

  return {
    estimate: roundPence((constants + options.targetNetProfit) / divisor),
    formula: `(${constants} + ${options.targetNetProfit}) ÷ (1 − ${totalPercentageRate})`,
  };
}

function resolveTargetProfit(options: SolverOptions, currentPrice: number): number {
  if (options.targetMode === 'fixed') return options.targetNetProfit;
  // Ceiling, not nearest-pence rounding: netProfit is always a whole number of
  // pence, so the bar for "at least this margin" must round up. Rounding to
  // nearest can round the true target down by a fraction of a penny and let a
  // netProfit through that's actually below the requested percentage.
  return Math.ceil(currentPrice * options.targetMargin);
}

/**
 * Nudge the price up a penny at a time until net profit actually clears the target
 * at that price, re-checking both after every step.
 *
 * A single unconditional "+1 penny" isn't enough on its own: in margin mode the
 * target itself is a percentage of price, so it creeps up right along with any
 * bump, and a bump that's enough to close a fixed-profit gap can still land a
 * fraction under a margin target. Re-deriving both sides at each candidate price
 * is what actually guarantees the result is never below what was asked for.
 */
function ratchetToTarget(
  config: MarketplaceConfig,
  options: SolverOptions,
  startPrice: number,
): { finalPrice: number; breakdown: FeeBreakdown; feeTrace: FeeTrace } {
  let finalPrice = startPrice;
  let { breakdown, trace: feeTrace } = calculateFeesWithTrace(config, { ...options, sellingPrice: finalPrice });

  for (let i = 0; i < MAX_RATCHET_STEPS && breakdown.netProfit < resolveTargetProfit(options, finalPrice); i++) {
    finalPrice += 1;
    ({ breakdown, trace: feeTrace } = calculateFeesWithTrace(config, { ...options, sellingPrice: finalPrice }));
  }

  return { finalPrice, breakdown, feeTrace };
}

function buildFormulaLines(
  options: SolverOptions,
  algebraicEstimate: number,
  estimateFormula: string,
  finalPrice: number,
): FormulaLine[] {
  const targetProfitFormula = options.targetMode === 'margin'
    ? `${finalPrice} × ${options.targetMargin}`
    : 'fixed target amount';

  return [
    { label: 'Starting price estimate', formula: estimateFormula, amount: algebraicEstimate },
    { label: 'Target profit', formula: targetProfitFormula, amount: resolveTargetProfit(options, finalPrice) },
  ];
}

/**
 * Find the selling price that produces (at least) the target net profit or margin.
 * Returns both the result and a full trace of the solver's iterations for debug output.
 */
export function solveForPrice(
  config: MarketplaceConfig,
  options: SolverOptions,
): SolverResult & { trace: SolverTrace & { feeTrace: FeeTrace } } {
  const { estimate: algebraicEstimate, formula: estimateFormula } = estimateSellingPrice(config, options);
  let price = algebraicEstimate;
  let converged = false;

  const iterations: SolverTrace['iterations'] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const breakdown = calculateFees(config, { ...options, sellingPrice: price });
    const targetProfit = resolveTargetProfit(options, price);
    const error = targetProfit - breakdown.netProfit;

    iterations.push({
      iteration: i + 1,
      price,
      netProfit: breakdown.netProfit,
      targetProfit,
      error,
    });

    if (Math.abs(error) <= CONVERGENCE_THRESHOLD) {
      converged = true;
      const { finalPrice, breakdown: finalBreakdown, feeTrace } = ratchetToTarget(config, options, price);

      const trace = {
        targetMode: options.targetMode,
        targetNetProfit: options.targetNetProfit,
        targetMargin: options.targetMargin,
        algebraicEstimate,
        iterations,
        converged,
        finalPrice,
        formulas: buildFormulaLines(options, algebraicEstimate, estimateFormula, finalPrice),
        feeTrace,
      };

      return { requiredSellingPrice: finalPrice, breakdown: finalBreakdown, converged, trace };
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
    feeTrace,
  };

  return { requiredSellingPrice: price, breakdown, converged: false, trace };
}

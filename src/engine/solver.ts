import type { MarketplaceConfig, SolverOptions, SolverResult, SolverTrace, FeeTrace } from '../types';
import { calculateFees, calculateFeesWithTrace } from './fees';
import { roundPence } from '../utils/math';

const MAX_ITERATIONS = 100;
const CONVERGENCE_THRESHOLD = 1; // within 1 pence is close enough

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
): number {
  const { costPrice, shippingCost, excludedFees } = options;

  const referralRate  = excludedFees.has('referralFee') ? 0 : (config.referralFees[0]?.rate ?? 0);
  const paymentRate   = excludedFees.has('paymentFee')  ? 0 : config.paymentFee.percentage;
  const paymentFixed  = excludedFees.has('paymentFee')  ? 0 : config.paymentFee.fixed;
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
    if (divisor <= 0) return roundPence(constants * 10);
    return roundPence(constants / divisor);
  }

  const totalPercentageRate = referralRate + paymentRate + percentageOfSaleCustomRates;
  const divisor = 1 - totalPercentageRate;
  if (divisor <= 0) return roundPence(constants + options.targetNetProfit);

  return roundPence((constants + options.targetNetProfit) / divisor);
}

function resolveTargetProfit(options: SolverOptions, currentPrice: number): number {
  if (options.targetMode === 'fixed') return options.targetNetProfit;
  return roundPence(currentPrice * options.targetMargin);
}

/**
 * Find the selling price that produces (at least) the target net profit or margin.
 * Returns both the result and a full trace of the solver's iterations for debug output.
 */
export function solveForPrice(
  config: MarketplaceConfig,
  options: SolverOptions,
): SolverResult & { trace: SolverTrace & { feeTrace: FeeTrace } } {
  const algebraicEstimate = estimateSellingPrice(config, options);
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
      const finalPrice = breakdown.netProfit < targetProfit ? price + 1 : price;
      const { breakdown: finalBreakdown, trace: feeTrace } = calculateFeesWithTrace(config, { ...options, sellingPrice: finalPrice });

      const trace = {
        targetMode: options.targetMode,
        targetNetProfit: options.targetNetProfit,
        targetMargin: options.targetMargin,
        algebraicEstimate,
        iterations,
        converged,
        finalPrice,
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
    feeTrace,
  };

  return { requiredSellingPrice: price, breakdown, converged: false, trace };
}

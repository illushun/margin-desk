import type {
  MarketplaceConfig,
  CalculationOptions,
  FeeBreakdown,
  FeeTrace,
  CustomFeeResult,
  WeightBand,
  FormulaLine,
} from '../types';
import { roundPence, round2dp, safeDivide } from '../utils/math';
import { calcVatOnFees } from './vat';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Find the applicable referral fee for a given selling price.
 * Tiers are evaluated in order; the first matching upTo wins.
 * A tier with no upTo is the catch-all.
 */
function calcReferralFee(
  sellingPrice: number,
  config: MarketplaceConfig,
): { fee: number; rate: number; minimum: number } {
  const tier = config.referralFees.find(
    (t) => t.upTo === undefined || sellingPrice <= t.upTo,
  );

  if (!tier) return { fee: 0, rate: 0, minimum: 0 };

  const calculated = roundPence(sellingPrice * tier.rate);
  const minimum = tier.minimum ?? 0;
  const fee = minimum ? Math.max(calculated, minimum) : calculated;

  return { fee, rate: tier.rate, minimum };
}

/** Resolve a fulfilment fee -- either a flat value or a weight band lookup. */
function calcFulfilmentFee(
  config: MarketplaceConfig,
  modeId: string,
  weightGrams?: number,
): number {
  const mode = config.fulfilmentModes.find((m) => m.id === modeId);
  if (!mode) return 0;

  if (typeof mode.fee === 'number') return mode.fee;

  if (weightGrams === undefined) return 0;

  const bands = mode.fee as WeightBand[];
  const band = bands.find((b) => weightGrams <= b.upToGrams);
  return band ? band.fee : bands[bands.length - 1]?.fee ?? 0;
}

/** Resolve custom fees against the selling price. Profit-based fees are deferred. */
function calcCustomFees(
  sellingPrice: number,
  options: CalculationOptions,
): { fixedAndSaleResults: CustomFeeResult[]; profitBasedFees: typeof options.customFees } {
  const fixedAndSaleResults: CustomFeeResult[] = [];
  const profitBasedFees = [];

  for (const fee of options.customFees) {
    if (fee.type === 'percentage_of_profit') {
      profitBasedFees.push(fee);
      continue;
    }

    const amount =
      fee.type === 'fixed_per_item'
        ? fee.value
        : roundPence(sellingPrice * fee.value);

    fixedAndSaleResults.push({ id: fee.id, label: fee.label, amount });
  }

  return { fixedAndSaleResults, profitBasedFees };
}

// ---------------------------------------------------------------------------
// Main calculation
// ---------------------------------------------------------------------------

export interface CalculationResult {
  breakdown: FeeBreakdown;
  trace: FeeTrace;
}

/**
 * Calculate the full fee breakdown for a given selling price.
 * Returns both the breakdown and a trace of the individual fee formulae.
 * All monetary values in pence.
 */
export function calculateFees(
  config: MarketplaceConfig,
  options: CalculationOptions,
): FeeBreakdown {
  return calculateFeesWithTrace(config, options).breakdown;
}

/**
 * Same as calculateFees but also returns the full FeeTrace for debug output.
 */
export function calculateFeesWithTrace(
  config: MarketplaceConfig,
  options: CalculationOptions,
): CalculationResult {
  const { sellingPrice, costPrice, vatRegistered, vatRate, excludedFees } = options;

  const referral = calcReferralFee(sellingPrice, config);
  const referralFee = excludedFees.has('referralFee') ? 0 : referral.fee;

  const closingFee = config.closingFee;

  const rawPaymentFee = roundPence(
    sellingPrice * config.paymentFee.percentage + config.paymentFee.fixed,
  );
  const paymentFee = excludedFees.has('paymentFee') ? 0 : rawPaymentFee;

  const rawFulfilmentFee = calcFulfilmentFee(config, options.fulfilmentModeId, options.weightGrams);
  const fulfilmentFee = excludedFees.has('fulfilmentFee') ? 0 : rawFulfilmentFee;

  const rawShippingCost = options.shippingCost;
  const shippingCost = excludedFees.has('shippingCost') ? 0 : rawShippingCost;

  const marketplaceFeeSubtotal = referralFee + closingFee + paymentFee + fulfilmentFee;

  const rawVatOnFees = calcVatOnFees(marketplaceFeeSubtotal, vatRate, config.vatOnFees, vatRegistered);
  const vatOnFees = excludedFees.has('vatOnFees') ? 0 : rawVatOnFees;

  const { fixedAndSaleResults, profitBasedFees } = calcCustomFees(sellingPrice, options);
  const fixedAndSaleTotal = fixedAndSaleResults.reduce((sum, f) => sum + f.amount, 0);

  const provisionalProfit =
    sellingPrice - marketplaceFeeSubtotal - vatOnFees - shippingCost - costPrice - fixedAndSaleTotal;

  const profitBasedResults: CustomFeeResult[] = profitBasedFees.map((fee) => ({
    id: fee.id,
    label: fee.label,
    amount: roundPence(Math.max(provisionalProfit, 0) * fee.value),
  }));

  const allCustomFees = [...fixedAndSaleResults, ...profitBasedResults];
  const customFeeTotal = allCustomFees.reduce((sum, f) => sum + f.amount, 0);

  const totalFees = marketplaceFeeSubtotal + vatOnFees + shippingCost + customFeeTotal;
  const netProfit = sellingPrice - totalFees - costPrice;

  const breakdown: FeeBreakdown = {
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
    roi: round2dp(safeDivide(netProfit, costPrice) * 100),
  };

  // Build custom fee formula strings for the trace
  const customFeeTraces = allCustomFees.map((fee) => {
    const src = options.customFees.find((f) => f.id === fee.id);
    let formula = 'fixed per item';
    if (src?.type === 'percentage_of_sale') {
      formula = `${(src.value * 100).toFixed(2)}% of selling price`;
    } else if (src?.type === 'percentage_of_profit') {
      formula = `${(src.value * 100).toFixed(2)}% of provisional profit`;
    }
    return { label: fee.label, formula, amount: fee.amount };
  });

  const totalDeductions = totalFees + costPrice;

  const referralFormula = referral.minimum > 0 && referral.fee === referral.minimum
    ? `${sellingPrice} × ${referral.rate} = ${roundPence(sellingPrice * referral.rate)} → minimum applies`
    : `${sellingPrice} × ${referral.rate}`;

  const paymentFormula = config.paymentFee.fixed > 0
    ? `${sellingPrice} × ${config.paymentFee.percentage} + ${config.paymentFee.fixed}`
    : `${sellingPrice} × ${config.paymentFee.percentage}`;

  const vatFormula = !config.vatOnFees
    ? 'not applicable for this marketplace'
    : !vatRegistered
      ? 'not applicable (not VAT registered)'
      : `${marketplaceFeeSubtotal} × ${vatRate}`;

  const formulas: FormulaLine[] = [
    { label: 'Referral fee', formula: referralFormula, amount: referral.fee, excluded: excludedFees.has('referralFee') },
    { label: 'Closing fee', formula: 'fixed per item', amount: closingFee },
    { label: 'Payment processing fee', formula: paymentFormula, amount: rawPaymentFee, excluded: excludedFees.has('paymentFee') },
    { label: 'Fulfilment fee', formula: 'weight/mode lookup', amount: rawFulfilmentFee, excluded: excludedFees.has('fulfilmentFee') },
    { label: 'Shipping cost', formula: 'entered amount', amount: rawShippingCost, excluded: excludedFees.has('shippingCost') },
    { label: 'VAT on fees', formula: vatFormula, amount: rawVatOnFees, excluded: excludedFees.has('vatOnFees') },
    ...customFeeTraces,
    { label: 'Total deductions', formula: 'all fees + cost price', amount: totalDeductions },
    { label: 'Net profit', formula: `${sellingPrice} − ${totalDeductions}`, amount: netProfit },
  ];

  const trace: FeeTrace = {
    sellingPrice,
    referralRate: referral.rate,
    referralMinimum: referral.minimum,
    referralFee: referral.fee,
    referralExcluded: excludedFees.has('referralFee'),
    closingFee,
    paymentPercentage: config.paymentFee.percentage,
    paymentFixed: config.paymentFee.fixed,
    paymentFee: rawPaymentFee,
    paymentExcluded: excludedFees.has('paymentFee'),
    fulfilmentFee: rawFulfilmentFee,
    fulfilmentExcluded: excludedFees.has('fulfilmentFee'),
    shippingCost: rawShippingCost,
    shippingExcluded: excludedFees.has('shippingCost'),
    marketplaceFeeSubtotal,
    vatRate,
    vatOnFees: rawVatOnFees,
    vatExcluded: excludedFees.has('vatOnFees'),
    customFees: customFeeTraces,
    costPrice,
    totalDeductions,
    netProfit,
    formulas,
  };

  return { breakdown, trace };
}

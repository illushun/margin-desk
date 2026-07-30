// ---------------------------------------------------------------------------
// Marketplace config types
// ---------------------------------------------------------------------------

/**
 * A price tier for referral fees. Tiers are evaluated in order;
 * the first tier where sellingPrice <= upTo wins.
 * A tier with no upTo is the catch-all fallback.
 */
export interface ReferralTier {
  upTo?: number;       // max selling price this tier applies to (inclusive), in pence
  rate: number;        // e.g. 0.10 for 10%
  minimum?: number;    // minimum fee in pence, overrides calculated fee if higher
}

export interface PaymentFee {
  percentage: number;  // e.g. 0.029 for 2.9%
  fixed: number;       // flat charge per transaction, in pence
}

/** Weight bands used by fulfilment services (e.g. FBA). */
export interface WeightBand {
  upToGrams: number;   // inclusive upper bound
  fee: number;         // fee in pence
}

export interface FulfilmentMode {
  id: string;
  label: string;
  /** Flat fee in pence, or weight-banded. Use 0 for self-fulfilled with no fee. */
  fee: number | WeightBand[];
}

export interface MarketplaceConfig {
  id: string;
  name: string;
  currency: string;    // ISO 4217, e.g. 'GBP'

  referralFees: ReferralTier[];
  closingFee: number;                   // flat per-item fee in pence
  paymentFee: PaymentFee;
  vatOnFees: boolean;                   // does the marketplace charge VAT on its fees?
  fulfilmentModes: FulfilmentMode[];
}

// ---------------------------------------------------------------------------
// Custom fees
// ---------------------------------------------------------------------------

export type CustomFeeType =
  | 'fixed_per_item'        // e.g. £0.50 packaging cost
  | 'percentage_of_sale'    // e.g. 3% sourcing agent fee
  | 'percentage_of_profit'; // e.g. 10% profit share -- applied after all other fees

export interface CustomFee {
  id: string;
  label: string;
  type: CustomFeeType;
  value: number; // pence for fixed, decimal rate for percentages (e.g. 0.03 = 3%)
}

// ---------------------------------------------------------------------------
// Excluded fees
// ---------------------------------------------------------------------------

/** Named deductions that can be individually suppressed. */
export type ExcludableFee = 'referralFee' | 'paymentFee' | 'fulfilmentFee' | 'vatOnFees' | 'shippingCost';

// ---------------------------------------------------------------------------
// Calculation inputs
// ---------------------------------------------------------------------------

export interface CalculationOptions {
  sellingPrice: number;       // in pence
  costPrice: number;          // in pence
  vatRegistered: boolean;
  vatRate: number;            // e.g. 0.20 for 20% -- applied to marketplace fees
  fulfilmentModeId: string;
  shippingCost: number;       // in pence, for seller-fulfilled shipping
  weightGrams?: number;       // required when fulfilment mode uses weight bands
  customFees: CustomFee[];
  excludedFees: Set<ExcludableFee>;
  /** Overrides the marketplace config's referralFees tiers with a single flat rate for this calculation only. */
  referralRateOverride?: number;
  /** Overrides the marketplace config's paymentFee for this calculation only. */
  paymentFeeOverride?: PaymentFee;
}

export type SolverTargetMode = 'fixed' | 'margin';

export interface SolverOptions extends Omit<CalculationOptions, 'sellingPrice'> {
  targetMode: SolverTargetMode;
  targetNetProfit: number; // pence when mode is 'fixed'; ignored when mode is 'margin'
  targetMargin: number;    // decimal rate e.g. 0.20 for 20%; ignored when mode is 'fixed'
}

// ---------------------------------------------------------------------------
// Calculation outputs
// ---------------------------------------------------------------------------

export interface CustomFeeResult {
  id: string;
  label: string;
  amount: number; // in pence
}

export interface FeeBreakdown {
  sellingPrice: number;
  referralFee: number;
  closingFee: number;
  paymentFee: number;
  fulfilmentFee: number;
  vatOnFees: number;
  shippingCost: number;
  customFees: CustomFeeResult[];
  totalFees: number;       // sum of all deductions except cost price
  costPrice: number;
  netProfit: number;       // sellingPrice - totalFees - costPrice
  netMargin: number;       // netProfit / sellingPrice * 100
  roi: number;             // netProfit / costPrice * 100
}

// ---------------------------------------------------------------------------
// Solver result
// ---------------------------------------------------------------------------

export interface SolverResult {
  requiredSellingPrice: number;
  breakdown: FeeBreakdown;
  converged: boolean; // false if the solver hit max iterations without converging
}

// ---------------------------------------------------------------------------
// Debug trace
// ---------------------------------------------------------------------------

/** One line of "show your working": a label, a human-readable formula with the
 * actual inputs substituted in (pence, not pounds), and the resulting amount. */
export interface FormulaLine {
  label: string;
  formula: string;
  amount: number;      // pence
  excluded?: boolean;  // true if this line was zeroed out by CalculationOptions.excludedFees
}

/**
 * VAT on selling price and ad/promoted-listings cost are either a fixed amount
 * the seller already knows, or a rate applied to whatever the selling price
 * turns out to be. A rate can't be pre-calculated into a pence amount before
 * the price is known -- that's a circular dependency when solving for price --
 * so rate mode is threaded through as a CustomFee (percentage_of_sale) instead
 * of being folded into costPrice. See EbayCostBuilderResult.generatedCustomFees.
 */
export type EbayFeeInput =
  | { mode: 'fixed'; amount: number } // pence
  | { mode: 'rate'; rate: number };   // decimal e.g. 0.1667 for 16.67%

export interface EbayCostBuilderInputs {
  costPerBatch: number;       // supplier price in pence (for the whole UoM batch)
  uom: number;                // units per batch e.g. 12 if supplier sells packs of 12
  qtyRequired: number;        // units needed per eBay listing
  discountRate: number;       // supplier discount as a decimal e.g. 0.10 for 10%
  packingMaterials: number;   // pence per item
  ppCost: number;             // actual postage + packing cost in pence
  ppIncludedInPrice: boolean; // true = bundle P+P into item price, false = charge separately
  vatOnSellingPrice: EbayFeeInput; // VAT the seller expects to remit on this item
  listingFee: number;         // eBay fixed listing fee in pence -- always a flat charge
  adCost: EbayFeeInput;       // promoted listings cost
}

export interface EbayCostBuilderResult {
  costPrice: number;          // feeds into CalculationOptions.costPrice
  shippingCost: number;       // feeds into CalculationOptions.shippingCost
  unitCost: number;           // ((cost / UoM) * qty) * (1 - disc) -- shown in breakdown
  generatedCustomFees: CustomFee[]; // rate-mode VAT/ad cost, to merge into CalculationOptions.customFees
  formulas: FormulaLine[]; // line-by-line working, so callers can show it without reimplementing the maths
  formulaText: string; // plain-text "Unit cost + Packing materials + ... = Cost price" reading of the above
}

export interface FeeTrace {
  sellingPrice: number;
  referralRate: number;
  referralMinimum: number;   // 0 if no minimum
  referralFee: number;
  referralExcluded: boolean;
  closingFee: number;
  paymentPercentage: number;
  paymentFixed: number;
  paymentFee: number;
  paymentExcluded: boolean;
  fulfilmentFee: number;
  fulfilmentExcluded: boolean;
  shippingCost: number;
  shippingExcluded: boolean;
  marketplaceFeeSubtotal: number;
  vatRate: number;
  vatOnFees: number;
  vatExcluded: boolean;
  customFees: { label: string; formula: string; amount: number }[];
  costPrice: number;
  totalDeductions: number;
  netProfit: number;
  formulas: FormulaLine[]; // line-by-line working through every fee, same shape as the eBay cost builder and solver
}

export interface SolverIteration {
  iteration: number;
  price: number;
  netProfit: number;
  targetProfit: number;
  error: number;
}

export interface SolverTrace {
  targetMode: SolverTargetMode;
  targetNetProfit: number;
  targetMargin: number;
  algebraicEstimate: number;
  iterations: SolverIteration[];
  converged: boolean;
  finalPrice: number;
  formulas: FormulaLine[]; // how the algebraic estimate and target profit were derived
}

export interface DebugTrace {
  ebayCost?: EbayCostBuilderResult;   // only present when eBay cost builder was used
  fees: FeeTrace;
  solver?: SolverTrace;       // only present in solve mode
}

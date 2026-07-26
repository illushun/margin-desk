import { roundPence } from '../utils/math';

export interface EbayCostBuilderInputs {
  costPerBatch: number;       // supplier price in pence (for the whole UoM batch)
  uom: number;                // units per batch e.g. 12 if supplier sells packs of 12
  qtyRequired: number;        // units needed per eBay listing
  discountRate: number;       // supplier discount as a decimal e.g. 0.10 for 10%
  packingMaterials: number;   // pence per item
  ppCost: number;             // actual postage + packing cost in pence
  ppIncludedInPrice: boolean; // true = bundle P+P into item price, false = charge separately
  vatOnSellingPrice: number;  // VAT amount in pence the seller expects to remit on this item
  listingFee: number;         // eBay fixed listing fee in pence
  adCost: number;             // promoted listings fixed cost in pence
}

export interface EbayCostBuilderResult {
  costPrice: number;          // feeds into CalculationOptions.costPrice
  shippingCost: number;       // feeds into CalculationOptions.shippingCost
  unitCost: number;           // ((cost / UoM) * qty) * (1 - disc) -- shown in breakdown
}

/**
 * Calculate the true cost of an eBay listing from supplier pricing inputs.
 *
 * When ppIncludedInPrice is true, P+P is baked into costPrice and shippingCost
 * is 0 -- eBay's referral fee will therefore be charged on the full item price.
 *
 * When ppIncludedInPrice is false, P+P becomes shippingCost so the main
 * calculator can pass it through correctly, and eBay charges referral fee on
 * the item price + postage (which the calculator handles via the shippingCost
 * field feeding into the breakdown separately from the referral base).
 */
export function buildEbayCost(inputs: EbayCostBuilderInputs): EbayCostBuilderResult {
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
    adCost,
  } = inputs;

  const safeUom = uom <= 0 ? 1 : uom;
  const unitCost = roundPence(((costPerBatch / safeUom) * qtyRequired) * (1 - discountRate));

  const costPrice = roundPence(
    unitCost +
    packingMaterials +
    (ppIncludedInPrice ? ppCost : 0) +
    vatOnSellingPrice +
    listingFee +
    adCost,
  );

  const shippingCost = ppIncludedInPrice ? 0 : ppCost;

  return { costPrice, shippingCost, unitCost };
}

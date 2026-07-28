import { roundPence } from '../utils/math';
import type { EbayCostBuilderInputs, EbayCostBuilderResult, FormulaLine } from '../types';

export type { EbayCostBuilderInputs, EbayCostBuilderResult };

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

  const formulas: FormulaLine[] = [
    {
      label: 'Unit cost',
      formula: `(${costPerBatch} ÷ ${safeUom}) × ${qtyRequired} × (1 − ${discountRate})`,
      amount: unitCost,
    },
    {
      label: 'Packing materials',
      formula: 'fixed per item',
      amount: packingMaterials,
    },
    {
      label: ppIncludedInPrice ? 'P+P (included in cost price)' : 'P+P (charged as shipping)',
      formula: ppIncludedInPrice
        ? 'added to cost price'
        : 'excluded from cost price, returned as shippingCost instead',
      amount: ppCost,
    },
    {
      label: 'VAT on selling price',
      formula: 'entered amount',
      amount: vatOnSellingPrice,
    },
    {
      label: 'Listing fee',
      formula: 'fixed per listing',
      amount: listingFee,
    },
    {
      label: 'Ad / promoted listings cost',
      formula: 'fixed amount',
      amount: adCost,
    },
    {
      label: 'Cost price',
      formula: `${unitCost} + ${packingMaterials} + ${ppIncludedInPrice ? ppCost : 0} + ${vatOnSellingPrice} + ${listingFee} + ${adCost}`,
      amount: costPrice,
    },
    {
      label: 'Shipping cost',
      formula: ppIncludedInPrice ? '0 (P+P included in cost price)' : `${ppCost} (P+P charged separately)`,
      amount: shippingCost,
    },
  ];

  return { costPrice, shippingCost, unitCost, formulas };
}

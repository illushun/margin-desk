import { roundPence } from '../utils/math';
import type { CustomFee, EbayCostBuilderInputs, EbayCostBuilderResult, EbayFeeInput, FormulaLine } from '../types';

export type { EbayCostBuilderInputs, EbayCostBuilderResult, EbayFeeInput };

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
 *
 * VAT on selling price and ad cost can each be a fixed pence amount (folded
 * straight into costPrice, same as before) or a rate. A rate can't be turned
 * into a pence amount here -- that would mean already knowing the selling
 * price this function is helping to build a cost for -- so rate-mode fees are
 * returned as generatedCustomFees for the caller to merge into
 * CalculationOptions.customFees, where the solver handles percentage-of-sale
 * fees algebraically.
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

  const vatFixedAmount = vatOnSellingPrice.mode === 'fixed' ? vatOnSellingPrice.amount : 0;
  const adFixedAmount = adCost.mode === 'fixed' ? adCost.amount : 0;

  const costPrice = roundPence(
    unitCost +
    packingMaterials +
    (ppIncludedInPrice ? ppCost : 0) +
    vatFixedAmount +
    listingFee +
    adFixedAmount,
  );

  const shippingCost = ppIncludedInPrice ? 0 : ppCost;

  const generatedCustomFees: CustomFee[] = [];
  if (vatOnSellingPrice.mode === 'rate') {
    generatedCustomFees.push({
      id: 'ebay-vat-slice',
      label: 'VAT on selling price',
      type: 'percentage_of_sale',
      value: vatOnSellingPrice.rate,
    });
  }
  if (adCost.mode === 'rate') {
    generatedCustomFees.push({
      id: 'ebay-ad-cost-rate',
      label: 'Ad / promoted listings',
      type: 'percentage_of_sale',
      value: adCost.rate,
    });
  }

  const vatFormula: FormulaLine = vatOnSellingPrice.mode === 'fixed'
    ? { label: 'VAT on selling price', formula: 'entered amount', amount: vatFixedAmount }
    : {
      label: 'VAT on selling price',
      formula: `${(vatOnSellingPrice.rate * 100).toFixed(2)}% of selling price -- applied as a percentage-of-sale fee, see Fee Calculation`,
      amount: 0,
    };

  const adFormula: FormulaLine = adCost.mode === 'fixed'
    ? { label: 'Ad / promoted listings cost', formula: 'fixed amount', amount: adFixedAmount }
    : {
      label: 'Ad / promoted listings cost',
      formula: `${(adCost.rate * 100).toFixed(2)}% of selling price -- applied as a percentage-of-sale fee, see Fee Calculation`,
      amount: 0,
    };

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
    vatFormula,
    {
      label: 'Listing fee',
      formula: 'fixed per listing',
      amount: listingFee,
    },
    adFormula,
    {
      label: 'Cost price',
      formula: `${unitCost} + ${packingMaterials} + ${ppIncludedInPrice ? ppCost : 0} + ${vatFixedAmount} + ${listingFee} + ${adFixedAmount}`,
      amount: costPrice,
    },
    {
      label: 'Shipping cost',
      formula: ppIncludedInPrice ? '0 (P+P included in cost price)' : `${ppCost} (P+P charged separately)`,
      amount: shippingCost,
    },
  ];

  return { costPrice, shippingCost, unitCost, generatedCustomFees, formulas };
}

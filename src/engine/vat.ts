import { roundPence } from '../utils/math';

/**
 * Returns the VAT amount on a given fee subtotal.
 *
 * Marketplaces like eBay add VAT on top of their fees when the seller
 * is VAT registered. The fee itself is the net amount; VAT is additional.
 *
 * Only applied when:
 *   - the marketplace config has vatOnFees: true
 *   - the seller has vatRegistered: true
 */
export function calcVatOnFees(
  feeSubtotal: number,
  vatRate: number,
  marketplaceChargesVat: boolean,
  sellerIsVatRegistered: boolean,
): number {
  if (!marketplaceChargesVat || !sellerIsVatRegistered) return 0;
  return roundPence(feeSubtotal * vatRate);
}

import type { MarketplaceConfig } from '../types';

/**
 * eBay UK fee structure.
 *
 * Combined selling fee: 12.9% of selling price + £0.36 flat per item (payment
 * processing is bundled into this combined rate, not charged separately).
 * No closing fee for most listings. VAT on fees: charged at 20% for
 * VAT-registered sellers.
 *
 * Callers can override this per calculation via CalculationOptions.referralRateOverride
 * / paymentFeeOverride when a seller's actual rate differs (category, subscription tier).
 */
const ebay: MarketplaceConfig = {
  id: 'ebay-uk',
  name: 'eBay UK',
  currency: 'GBP',

  referralFees: [
    { rate: 0.129 }, // 12.9% -- catch-all (no upTo)
  ],

  closingFee: 0,

  paymentFee: {
    percentage: 0,  // payment processing is bundled into the referral rate above
    fixed: 36,      // £0.36 flat per item
  },

  vatOnFees: true,

  fulfilmentModes: [
    { id: 'self', label: 'Self-fulfilled', fee: 0 },
  ],

  referralFeeLabel: 'eBay Final Value Fee',
  paymentFeeLabel: 'eBay flat fee',
};

export default ebay;

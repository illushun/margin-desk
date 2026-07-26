import type { MarketplaceConfig } from '../types';

/**
 * B&Q Marketplace fee structure.
 *
 * Commission: 5-15% depending on category. Using 12% as a general default.
 * No separate payment processing fee -- included in commission.
 * No VAT charged on fees (commission is VAT-exclusive for VAT-registered sellers).
 *
 * Source: https://www.bandqmarketplace.co.uk/seller-fees
 * Note: B&Q uses a category-based commission model. Add additional tiers
 * if you need to model specific categories (e.g. Power Tools at 8%).
 */
const bandq: MarketplaceConfig = {
  id: 'bandq-uk',
  name: 'B&Q Marketplace',
  currency: 'GBP',

  referralFees: [
    { rate: 0.12 }, // 12% general commission -- catch-all
  ],

  closingFee: 0,

  paymentFee: {
    percentage: 0,
    fixed: 0,
  },

  vatOnFees: false,

  fulfilmentModes: [
    { id: 'self', label: 'Self-fulfilled', fee: 0 },
  ],
};

export default bandq;

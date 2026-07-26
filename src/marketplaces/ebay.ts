import type { MarketplaceConfig } from '../types';

/**
 * eBay UK fee structure.
 *
 * Referral fee: 11.9% on most categories. No closing fee for most listings.
 * Payment processing: 0.3% + 30p (Managed Payments, as of 2024).
 * VAT on fees: charged at 20% for VAT-registered sellers.
 *
 * Source: https://www.ebay.co.uk/help/selling/fees-credits-invoices/selling-fees
 */
const ebay: MarketplaceConfig = {
  id: 'ebay-uk',
  name: 'eBay UK',
  currency: 'GBP',

  referralFees: [
    { rate: 0.119 }, // 11.9% -- catch-all (no upTo)
  ],

  closingFee: 0,

  paymentFee: {
    percentage: 0.003, // 0.3%
    fixed: 30,         // 30p
  },

  vatOnFees: true,

  fulfilmentModes: [
    { id: 'self', label: 'Self-fulfilled', fee: 0 },
  ],
};

export default ebay;

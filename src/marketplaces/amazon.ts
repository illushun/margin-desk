import type { MarketplaceConfig } from '../types';

/**
 * Amazon UK fee structure.
 *
 * Referral fee: 15% for most categories (Electronics 7%, Media 15%).
 * Closing fee: none for most categories (media has a fixed closing fee, omitted here).
 * Payment processing: included in the referral fee -- Amazon does not charge separately.
 * FBA fees are weight-banded; FBM sellers pay no fulfilment fee via Amazon.
 *
 * Source: https://sell.amazon.co.uk/pricing
 */
const amazon: MarketplaceConfig = {
  id: 'amazon-uk',
  name: 'Amazon UK',
  currency: 'GBP',

  referralFees: [
    { rate: 0.15, minimum: 30 }, // 15%, minimum 30p -- catch-all
  ],

  closingFee: 0,

  // Amazon bundles payment processing into the referral fee
  paymentFee: {
    percentage: 0,
    fixed: 0,
  },

  // Amazon does not charge VAT on seller fees in the UK
  vatOnFees: false,

  fulfilmentModes: [
    {
      id: 'fbm',
      label: 'Fulfilled by Merchant (FBM)',
      fee: 0,
    },
    {
      id: 'fba',
      label: 'Fulfilled by Amazon (FBA)',
      // Weight-banded FBA fees (standard size, as of 2024, in pence)
      // Source: Amazon FBA fee schedule
      fee: [
        { upToGrams: 100,  fee: 199 },
        { upToGrams: 200,  fee: 209 },
        { upToGrams: 300,  fee: 225 },
        { upToGrams: 400,  fee: 234 },
        { upToGrams: 500,  fee: 244 },
        { upToGrams: 1000, fee: 328 },
        { upToGrams: 1500, fee: 390 },
        { upToGrams: 2000, fee: 445 },
      ],
    },
  ],
};

export default amazon;

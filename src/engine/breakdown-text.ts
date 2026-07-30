import type { FeeBreakdown, ExcludableFee, MarketplaceConfig } from '../types';
import { formatGBP } from '../utils/currency';

/** The only parts of a MarketplaceConfig this module needs -- keeps it decoupled
 * from the full config shape. */
type BreakdownLabels = Pick<MarketplaceConfig, 'referralFeeLabel' | 'paymentFeeLabel'>;

/** One line of a fee breakdown: a label, a pence amount, and how it should read. */
export interface BreakdownRow {
  label: string;
  amount: number;
  isDeduction?: boolean;
  isSummary?: boolean;
  isExcluded?: boolean;
}

/**
 * Selling price, cost price, and every fee actually charged, in the order they'd
 * be read top to bottom. Excluded fees are still included (with isExcluded set)
 * so callers can choose to show them struck through rather than dropping them silently.
 */
export function buildBreakdownRows(b: FeeBreakdown, excluded: Set<ExcludableFee>, labels: BreakdownLabels): BreakdownRow[] {
  const referralLabel = labels.referralFeeLabel ?? 'Referral fee';
  const paymentLabel = labels.paymentFeeLabel ?? 'Payment fee';

  const rows: BreakdownRow[] = [
    { label: 'Selling price', amount: b.sellingPrice },
    { label: 'Cost price', amount: b.costPrice, isDeduction: true },
    { label: referralLabel, amount: b.referralFee, isDeduction: true, isExcluded: excluded.has('referralFee') },
  ];

  if (b.closingFee > 0) rows.push({ label: 'Closing fee', amount: b.closingFee, isDeduction: true });

  rows.push({ label: paymentLabel, amount: b.paymentFee, isDeduction: true, isExcluded: excluded.has('paymentFee') });

  if (b.fulfilmentFee > 0 || excluded.has('fulfilmentFee')) {
    rows.push({ label: 'Fulfilment fee', amount: b.fulfilmentFee, isDeduction: true, isExcluded: excluded.has('fulfilmentFee') });
  }

  if (b.shippingCost > 0 || excluded.has('shippingCost')) {
    rows.push({ label: 'Shipping', amount: b.shippingCost, isDeduction: true, isExcluded: excluded.has('shippingCost') });
  }

  if (b.vatOnFees > 0 || excluded.has('vatOnFees')) {
    rows.push({ label: 'VAT on fees', amount: b.vatOnFees, isDeduction: true, isExcluded: excluded.has('vatOnFees') });
  }

  for (const fee of b.customFees) {
    rows.push({ label: fee.label, amount: fee.amount, isDeduction: true });
  }

  rows.push({ label: 'Total deductions', amount: b.totalFees + b.costPrice, isSummary: true });
  return rows;
}

/** Plain-text "Selling price − Cost price − Referral fee = Net profit" reading of the breakdown. */
export function buildFormulaText(b: FeeBreakdown, excluded: Set<ExcludableFee>, labels: BreakdownLabels): string {
  const terms = buildBreakdownRows(b, excluded, labels).filter((r) => !r.isSummary && !r.isExcluded);

  const chain = terms
    .map((r, i) => {
      const amt = formatGBP(r.amount);
      if (i === 0) return `${r.label} (${amt})`;
      return `${r.isDeduction ? '−' : '+'} ${r.label} (${amt})`;
    })
    .join(' ');

  return `${chain} = Net profit (${formatGBP(b.netProfit)})`;
}

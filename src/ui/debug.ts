import type { DebugTrace, EbayCostTrace, FeeTrace, SolverTrace } from '../types';
import { formatGBP } from '../utils/currency';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(rate: number): string {
  return `${(rate * 100).toFixed(3).replace(/\.?0+$/, '')}%`;
}

function gbp(pence: number): string {
  return formatGBP(pence);
}

function row(label: string, formula: string, result: string, excluded = false): string {
  const cls = excluded ? ' class="debug-excluded"' : '';
  return `
    <tr${cls}>
      <td class="debug-label">${label}</td>
      <td class="debug-formula">${formula}</td>
      <td class="debug-result">${excluded ? `<s>${result}</s> <span class="debug-tag">excluded</span>` : result}</td>
    </tr>
  `;
}

function section(title: string, rows: string): string {
  return `
    <div class="debug-section">
      <p class="debug-section-title">${title}</p>
      <table class="debug-table">
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderEbayCostTrace(t: EbayCostTrace): string {
  const discPct = pct(t.discountRate);
  const unitFormula = t.discountRate > 0
    ? `(${gbp(t.costPerBatch)} ÷ ${t.uom}) × ${t.qtyRequired} × (1 − ${discPct})`
    : `(${gbp(t.costPerBatch)} ÷ ${t.uom}) × ${t.qtyRequired}`;

  let rows = row('Unit cost', unitFormula, gbp(t.unitCost));

  if (t.packingMaterials > 0) {
    rows += row('Packing materials', 'fixed per item', gbp(t.packingMaterials));
  }

  if (t.ppIncludedInPrice) {
    rows += row('P+P (in price)', 'included in cost price', gbp(t.ppCost));
  } else {
    rows += row('P+P (separate)', 'charged as shipping', gbp(t.ppCost));
  }

  if (t.vatOnSellingPrice > 0) {
    rows += row('VAT on selling price', 'entered amount', gbp(t.vatOnSellingPrice));
  }

  if (t.listingFee > 0) {
    rows += row('Listing fee', 'fixed per listing', gbp(t.listingFee));
  }

  if (t.adCost > 0) {
    rows += row('Ad / promoted listings', 'fixed amount', gbp(t.adCost));
  }

  rows += `
    <tr class="debug-total">
      <td class="debug-label">Cost price</td>
      <td class="debug-formula">${gbp(t.unitCost)} + overheads</td>
      <td class="debug-result">${gbp(t.costPrice)}</td>
    </tr>
  `;

  if (!t.ppIncludedInPrice && t.ppCost > 0) {
    rows += `
      <tr class="debug-total">
        <td class="debug-label">Shipping cost</td>
        <td class="debug-formula">P+P passed through</td>
        <td class="debug-result">${gbp(t.shippingCost)}</td>
      </tr>
    `;
  }

  return section('Cost Builder', rows);
}

function renderFeeTrace(t: FeeTrace): string {
  let rows = '';

  // Referral fee
  if (t.referralMinimum > 0 && t.referralFee === t.referralMinimum) {
    rows += row(
      'Referral fee',
      `${gbp(t.sellingPrice)} × ${pct(t.referralRate)} = ${gbp(Math.round(t.sellingPrice * t.referralRate))} → minimum applies`,
      gbp(t.referralFee),
      t.referralExcluded,
    );
  } else {
    rows += row(
      'Referral fee',
      `${gbp(t.sellingPrice)} × ${pct(t.referralRate)}`,
      gbp(t.referralFee),
      t.referralExcluded,
    );
  }

  if (t.closingFee > 0) {
    rows += row('Closing fee', 'fixed per item', gbp(t.closingFee));
  }

  if (t.paymentFee > 0 || t.paymentExcluded) {
    const formula = t.paymentFixed > 0
      ? `${gbp(t.sellingPrice)} × ${pct(t.paymentPercentage)} + ${gbp(t.paymentFixed)}`
      : `${gbp(t.sellingPrice)} × ${pct(t.paymentPercentage)}`;
    rows += row('Payment processing fee', formula, gbp(t.paymentFee), t.paymentExcluded);
  }

  if (t.fulfilmentFee > 0 || t.fulfilmentExcluded) {
    rows += row('Fulfilment fee', 'weight/mode lookup', gbp(t.fulfilmentFee), t.fulfilmentExcluded);
  }

  if (t.shippingCost > 0 || t.shippingExcluded) {
    rows += row('Shipping cost', 'entered amount', gbp(t.shippingCost), t.shippingExcluded);
  }

  if (t.vatOnFees > 0 || t.vatExcluded) {
    rows += row(
      'VAT on fees',
      `${gbp(t.marketplaceFeeSubtotal)} × ${pct(t.vatRate)}`,
      gbp(t.vatOnFees),
      t.vatExcluded,
    );
  }

  for (const fee of t.customFees) {
    rows += row(fee.label, fee.formula, gbp(fee.amount));
  }

  rows += `
    <tr class="debug-total">
      <td class="debug-label">Total deductions</td>
      <td class="debug-formula">all fees + cost price</td>
      <td class="debug-result">${gbp(t.totalDeductions)}</td>
    </tr>
    <tr class="debug-profit">
      <td class="debug-label">Net profit</td>
      <td class="debug-formula">${gbp(t.sellingPrice)} − ${gbp(t.totalDeductions)}</td>
      <td class="debug-result ${t.netProfit >= 0 ? 'positive' : 'negative'}">${gbp(t.netProfit)}</td>
    </tr>
  `;

  return section('Fee Calculation', rows);
}

function renderSolverTrace(t: SolverTrace): string {
  const targetLabel = t.targetMode === 'margin'
    ? `${(t.targetMargin * 100).toFixed(1)}% net margin`
    : `${gbp(t.targetNetProfit)} net profit`;

  let rows = `
    <tr>
      <td class="debug-label">Target</td>
      <td class="debug-formula" colspan="3">${targetLabel}</td>
    </tr>
    <tr>
      <td class="debug-label">Algebraic estimate</td>
      <td class="debug-formula" colspan="3">
        constants ÷ (1 − percentage rates) = ${gbp(t.algebraicEstimate)}
      </td>
    </tr>
    <tr class="debug-iter-header">
      <td>Iteration</td>
      <td>Price</td>
      <td>Net profit</td>
      <td>Error</td>
    </tr>
  `;

  for (const iter of t.iterations) {
    const errorStr = iter.error > 0 ? `+${gbp(iter.error)}` : gbp(iter.error);
    rows += `
      <tr class="debug-iter">
        <td class="debug-label">#${iter.iteration}</td>
        <td>${gbp(iter.price)}</td>
        <td>${gbp(iter.netProfit)}</td>
        <td class="${Math.abs(iter.error) <= 1 ? 'positive' : ''}">${errorStr}</td>
      </tr>
    `;
  }

  rows += `
    <tr class="debug-total">
      <td class="debug-label">Final price</td>
      <td colspan="3">${gbp(t.finalPrice)} (converged in ${t.iterations.length} iteration${t.iterations.length !== 1 ? 's' : ''})</td>
    </tr>
  `;

  return section('Solver Trace', rows);
}

// ---------------------------------------------------------------------------
// Public: render the full debug panel
// ---------------------------------------------------------------------------

export function renderDebugTrace(container: HTMLElement, trace: DebugTrace): void {
  let html = '';

  if (trace.ebayCost) html += renderEbayCostTrace(trace.ebayCost);
  html += renderFeeTrace(trace.fees);
  if (trace.solver) html += renderSolverTrace(trace.solver);

  container.innerHTML = html;
}

export function clearDebugTrace(container: HTMLElement): void {
  container.innerHTML = '<p class="debug-empty">Run a calculation to see the workings.</p>';
}

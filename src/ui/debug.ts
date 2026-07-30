import type { DebugTrace, EbayCostBuilderResult, FeeTrace, SolverTrace } from '../types';
import { formatGBP } from '../utils/currency';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function section(title: string, rows: string, extra = ''): string {
  return `
    <div class="debug-section">
      <p class="debug-section-title">${title}</p>
      <table class="debug-table">
        <tbody>${rows}</tbody>
      </table>
      ${extra}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

const EBAY_COST_HIDE_IF_ZERO = new Set([
  'Packing materials',
  'VAT on selling price',
  'Listing fee',
  'Ad / promoted listings cost',
]);
const EBAY_COST_TOTAL_LABELS = new Set(['Cost price', 'Shipping cost']);

function renderEbayCostTrace(t: EbayCostBuilderResult): string {
  let rows = '';

  for (const f of t.formulas) {
    if (EBAY_COST_HIDE_IF_ZERO.has(f.label) && f.amount === 0) continue;

    rows += EBAY_COST_TOTAL_LABELS.has(f.label)
      ? `
        <tr class="debug-total">
          <td class="debug-label">${f.label}</td>
          <td class="debug-formula">${f.formula}</td>
          <td class="debug-result">${gbp(f.amount)}</td>
        </tr>
      `
      : row(f.label, f.formula, gbp(f.amount));
  }

  return section('Cost Builder', rows, `<p class="breakdown-formula" style="margin-top:0.75rem;">${t.formulaText}</p>`);
}

const FEE_TRACE_HIDE_IF_ZERO = new Set([
  'Closing fee',
  'Payment processing fee',
  'eBay flat fee', // marketplace-specific override of "Payment processing fee", see MarketplaceConfig.paymentFeeLabel
  'Fulfilment fee',
  'Shipping cost',
  'VAT on fees',
]);

function renderFeeTrace(t: FeeTrace): string {
  let rows = '';

  for (const f of t.formulas) {
    if (FEE_TRACE_HIDE_IF_ZERO.has(f.label) && f.amount === 0 && !f.excluded) continue;

    if (f.label === 'Total deductions') {
      rows += `
        <tr class="debug-total">
          <td class="debug-label">${f.label}</td>
          <td class="debug-formula">${f.formula}</td>
          <td class="debug-result">${gbp(f.amount)}</td>
        </tr>
      `;
    } else if (f.label === 'Net profit') {
      rows += `
        <tr class="debug-profit">
          <td class="debug-label">${f.label}</td>
          <td class="debug-formula">${f.formula}</td>
          <td class="debug-result ${f.amount >= 0 ? 'positive' : 'negative'}">${gbp(f.amount)}</td>
        </tr>
      `;
    } else {
      rows += row(f.label, f.formula, gbp(f.amount), f.excluded);
    }
  }

  return section('Fee Calculation', rows);
}

function renderSolverTrace(t: SolverTrace): string {
  const targetLabel = t.targetMode === 'margin'
    ? `${(t.targetMargin * 100).toFixed(1)}% net margin`
    : `${gbp(t.targetNetProfit)} net profit`;

  const estimateFormula = t.formulas.find((f) => f.label === 'Starting price estimate');
  const targetProfitFormula = t.formulas.find((f) => f.label === 'Target profit');

  let rows = `
    <tr>
      <td class="debug-label">Target</td>
      <td class="debug-formula" colspan="2">${targetLabel}</td>
      <td class="debug-result">${targetProfitFormula ? gbp(targetProfitFormula.amount) : ''}</td>
    </tr>
    <tr>
      <td class="debug-label">Starting price estimate</td>
      <td class="debug-formula" colspan="2">${estimateFormula?.formula ?? ''}</td>
      <td class="debug-result">${gbp(t.algebraicEstimate)}</td>
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

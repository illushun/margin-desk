import type { FeeBreakdown, SolverResult, ExcludableFee, MarketplaceConfig } from '../types';
import { formatGBP } from '../utils/currency';
import { buildBreakdownRows, buildFormulaText } from '../engine/breakdown-text';

// ---------------------------------------------------------------------------
// Count-up animation
// ---------------------------------------------------------------------------

function animateCountUp(el: HTMLElement, targetPence: number, duration = 550): void {
  const isNegative = targetPence < 0;
  const abs = Math.abs(targetPence);
  const start = performance.now();

  function tick(now: number) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = (isNegative ? '-' : '') + formatGBP(Math.round(abs * eased));
    if (p < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// Read excluded fees from DOM
// ---------------------------------------------------------------------------

function readExcluded(): Set<ExcludableFee> {
  const excluded = new Set<ExcludableFee>();
  const ids: ExcludableFee[] = ['referralFee', 'paymentFee', 'fulfilmentFee', 'vatOnFees', 'shippingCost'];
  for (const id of ids) {
    const cb = document.getElementById(`exclude-${id}`) as HTMLInputElement | null;
    if (cb?.checked) excluded.add(id);
  }
  return excluded;
}

// ---------------------------------------------------------------------------
// Breakdown table
// ---------------------------------------------------------------------------

function buildBreakdownHTML(b: FeeBreakdown, excluded: Set<ExcludableFee>, config: MarketplaceConfig): string {
  const rows = buildBreakdownRows(b, excluded, config);
  const tableRows = rows.map((r) => {
    let cls = '';
    if (r.isDeduction) cls = 'deduction';
    if (r.isSummary) cls = 'summary';
    if (r.isExcluded) cls += ' excluded';

    const prefix = r.isDeduction ? '-' : '';
    const amt = r.isExcluded
      ? `<s>${prefix}${formatGBP(r.amount)}</s> <span class="debug-tag">excl.</span>`
      : `${prefix}${formatGBP(r.amount)}`;

    return `<tr class="${cls.trim()}">
      <td class="row-label">${r.label}</td>
      <td class="row-amount">${amt}</td>
    </tr>`;
  }).join('');

  return `<table class="breakdown-table"><tbody>${tableRows}</tbody></table>`;
}

// ---------------------------------------------------------------------------
// Render result into the result sheet body
// ---------------------------------------------------------------------------

export function renderBreakdown(container: HTMLElement, breakdown: FeeBreakdown, config: MarketplaceConfig): void {
  const excluded = readExcluded();
  const cls = breakdown.netProfit >= 0 ? 'positive' : 'negative';

  container.innerHTML = `
    <div class="result-hero">
      <p class="result-hero-label">Net profit</p>
      <p class="result-hero-amount ${cls}" id="hero-amount"></p>
    </div>

    <div class="metrics">
      <div class="metric">
        <span class="metric-label">Net margin</span>
        <span class="metric-value ${cls}">${breakdown.netMargin.toFixed(1)}%</span>
      </div>
      <div class="metric">
        <span class="metric-label">ROI</span>
        <span class="metric-value ${cls}">${breakdown.roi.toFixed(1)}%</span>
      </div>
    </div>

    <p class="breakdown-section-title">Breakdown</p>
    ${buildBreakdownHTML(breakdown, excluded, config)}

    <p class="breakdown-section-title">As a formula</p>
    <p class="breakdown-formula">${buildFormulaText(breakdown, excluded, config)}</p>

    <button class="btn-workings" id="open-workings">Show workings</button>
  `;

  const heroEl = container.querySelector<HTMLElement>('#hero-amount');
  if (heroEl) animateCountUp(heroEl, breakdown.netProfit);

  container.querySelector('#open-workings')?.addEventListener('click', () => {
    const modal = document.getElementById('workings-modal');
    const backdrop = document.getElementById('workings-backdrop');
    modal?.classList.add('open');
    backdrop?.classList.add('open');
  });
}

export function renderSolverResult(container: HTMLElement, result: SolverResult, config: MarketplaceConfig): void {
  const excluded = readExcluded();

  container.innerHTML = `
    <div class="result-hero solver-mode">
      <p class="result-hero-label">Minimum selling price</p>
      <p class="result-hero-amount" id="hero-amount"></p>
      ${!result.converged ? '<p class="solver-warning" style="margin-top:0.35rem;font-size:0.72rem;">Result may not be exact.</p>' : ''}
    </div>

    <div class="metrics">
      <div class="metric">
        <span class="metric-label">Net margin</span>
        <span class="metric-value positive">${result.breakdown.netMargin.toFixed(1)}%</span>
      </div>
      <div class="metric">
        <span class="metric-label">ROI</span>
        <span class="metric-value positive">${result.breakdown.roi.toFixed(1)}%</span>
      </div>
    </div>

    <p class="breakdown-section-title">Breakdown</p>
    ${buildBreakdownHTML(result.breakdown, excluded, config)}

    <p class="breakdown-section-title">As a formula</p>
    <p class="breakdown-formula">${buildFormulaText(result.breakdown, excluded, config)}</p>

    <button class="btn-workings" id="open-workings">Show workings</button>
  `;

  const heroEl = container.querySelector<HTMLElement>('#hero-amount');
  if (heroEl) animateCountUp(heroEl, result.requiredSellingPrice);

  container.querySelector('#open-workings')?.addEventListener('click', () => {
    const modal = document.getElementById('workings-modal');
    const backdrop = document.getElementById('workings-backdrop');
    modal?.classList.add('open');
    backdrop?.classList.add('open');
  });
}

export function renderError(container: HTMLElement, message: string): void {
  container.innerHTML = `<p class="error-message">${message}</p>`;
}

export function clearOutput(container: HTMLElement): void {
  container.innerHTML = '<p class="debug-empty">No result yet.</p>';
}

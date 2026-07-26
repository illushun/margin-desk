import { listMarketplaces, getMarketplace } from '../marketplaces';
import { calculateFeesWithTrace } from '../engine/fees';
import { solveForPrice } from '../engine/solver';
import { renderBreakdown, renderSolverResult, renderError } from './render';
import { renderDebugTrace, clearDebugTrace } from './debug';
import { poundsToPence, percentageToRate, penceToDecimal, formatGBP } from '../utils/currency';
import { buildEbayCost } from '../marketplaces/ebay-cost-builder';
import type {
  CustomFee, CalculationOptions, SolverOptions,
  SolverTargetMode, ExcludableFee, DebugTrace, EbayCostTrace,
} from '../types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let customFees: CustomFee[] = [];
let customFeeCounter = 0;
let currentStep = 1;
const visitedSteps = new Set<number>([1]);

// ---------------------------------------------------------------------------
// DOM helper
// ---------------------------------------------------------------------------

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

function getSteps(): number[] {
  const isEbay = el<HTMLSelectElement>('marketplace').value === 'ebay-uk';
  return isEbay ? [1, 2, 3, 4] : [1, 3, 4];
}

function totalSteps(): number { return getSteps().length; }
function stepIndex(): number  { return getSteps().indexOf(currentStep); }

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function goToStep(id: number): void {
  currentStep = id;
  visitedSteps.add(id);

  [1, 2, 3, 4].forEach((n) => {
    el(`step-panel-${n}`).classList.toggle('active', n === id);
  });

  // Top back button
  const topBack = el('topbar-back');
  const barBack = el('bar-back');
  const isFirst = stepIndex() === 0;
  topBack.classList.toggle('hidden', isFirst);
  barBack.classList.toggle('hidden', isFirst);

  // Bottom bar button label
  const isLast = stepIndex() === totalSteps() - 1;
  el('bar-next').textContent = isLast ? 'Calculate' : 'Continue';

  updateStepDots();
  updateStepEyebrows();
  updateSummarySheet();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function next(): void {
  const steps = getSteps();
  const idx = stepIndex();
  if (idx < steps.length - 1) {
    goToStep(steps[idx + 1]!);
  } else {
    // Last step -- run calculation
    runAndShowResult();
  }
}

function prev(): void {
  const steps = getSteps();
  const idx = stepIndex();
  if (idx > 0) goToStep(steps[idx - 1]!);
}

// ---------------------------------------------------------------------------
// Step dots in bottom bar
// ---------------------------------------------------------------------------

function updateStepDots(): void {
  const dots = el('step-dots');
  const steps = getSteps();
  dots.innerHTML = steps.map((id) => {
    let cls = 'step-dot';
    if (id === currentStep) cls += ' active';
    else if (visitedSteps.has(id) && id !== currentStep) cls += ' complete';
    return `<div class="${cls}"></div>`;
  }).join('');
}

// ---------------------------------------------------------------------------
// Step eyebrows
// ---------------------------------------------------------------------------

function updateStepEyebrows(): void {
  const steps = getSteps();
  const idx = steps.indexOf(currentStep) + 1;
  const total = steps.length;
  const isEbay = el<HTMLSelectElement>('marketplace').value === 'ebay-uk';

  const s2 = el('step-2-eyebrow');
  const s3 = el('step-3-eyebrow');
  const s4 = el('step-4-eyebrow');
  if (s2) s2.textContent = `Step ${idx} of ${total}`;
  if (s3) s3.textContent = `Step ${idx} of ${total}`;
  if (s4) s4.textContent = `Step ${idx} of ${total}`;

  const sub3 = el('step-3-sub');
  if (sub3) {
    sub3.textContent = isEbay
      ? 'Add eBay fees, VAT, and any items to exclude.'
      : 'Enter your cost, shipping, and any items to exclude.';
  }
}

// ---------------------------------------------------------------------------
// Marketplace / eBay context
// ---------------------------------------------------------------------------

function populateMarketplaceSelect(): void {
  const select = el<HTMLSelectElement>('marketplace');
  listMarketplaces().forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.name;
    select.appendChild(opt);
  });
}

function populateFulfilmentModes(id: string): void {
  const config = getMarketplace(id);
  const select = el<HTMLSelectElement>('fulfilment-mode');
  select.innerHTML = '';
  config?.fulfilmentModes.forEach((mode) => {
    const opt = document.createElement('option');
    opt.value = mode.id;
    opt.textContent = mode.label;
    select.appendChild(opt);
  });
  const hasWeightBands = config?.fulfilmentModes.some((m) => Array.isArray(m.fee)) ?? false;
  el('weight-group').style.display = hasWeightBands ? 'block' : 'none';
}

function applyMarketplaceContext(): void {
  const isEbay = el<HTMLSelectElement>('marketplace').value === 'ebay-uk';
  el('manual-cost-group').style.display = isEbay ? 'none' : 'block';
  el('ebay-fees-group').style.display   = isEbay ? 'block' : 'none';
}

// ---------------------------------------------------------------------------
// eBay cost builder
// ---------------------------------------------------------------------------

function applyEbayCostBuilder(): void {
  const ppIncluded = el<HTMLInputElement>('ebay-pp-included').checked;

  const result = buildEbayCost({
    costPerBatch:      poundsToPence(el<HTMLInputElement>('ebay-cost-per-batch').value),
    uom:               parseFloat(el<HTMLInputElement>('ebay-uom').value) || 1,
    qtyRequired:       parseFloat(el<HTMLInputElement>('ebay-qty-required').value) || 1,
    discountRate:      percentageToRate(el<HTMLInputElement>('ebay-discount').value),
    packingMaterials:  poundsToPence(el<HTMLInputElement>('ebay-packing-materials').value),
    ppCost:            poundsToPence(el<HTMLInputElement>('ebay-pp-cost').value),
    ppIncludedInPrice: ppIncluded,
    vatOnSellingPrice: poundsToPence(el<HTMLInputElement>('ebay-vat-amount').value),
    listingFee:        poundsToPence(el<HTMLInputElement>('ebay-listing-fee').value),
    adCost:            poundsToPence(el<HTMLInputElement>('ebay-ad-cost').value),
  });

  el<HTMLInputElement>('cost-price-ebay').value    = String(result.costPrice);
  el<HTMLInputElement>('shipping-cost-ebay').value = String(result.shippingCost);

  const excl = el<HTMLInputElement>('exclude-shippingCost');
  excl.checked  = ppIncluded || excl.checked;
  excl.disabled = ppIncluded;
}

function buildEbayCostTrace(): EbayCostTrace | undefined {
  if (el<HTMLSelectElement>('marketplace').value !== 'ebay-uk') return undefined;

  const ppIncluded   = el<HTMLInputElement>('ebay-pp-included').checked;
  const costPerBatch = poundsToPence(el<HTMLInputElement>('ebay-cost-per-batch').value);
  const uom          = parseFloat(el<HTMLInputElement>('ebay-uom').value) || 1;
  const qty          = parseFloat(el<HTMLInputElement>('ebay-qty-required').value) || 1;
  const disc         = percentageToRate(el<HTMLInputElement>('ebay-discount').value);
  const packing      = poundsToPence(el<HTMLInputElement>('ebay-packing-materials').value);
  const ppCost       = poundsToPence(el<HTMLInputElement>('ebay-pp-cost').value);
  const vatAmt       = poundsToPence(el<HTMLInputElement>('ebay-vat-amount').value);
  const listingFee   = poundsToPence(el<HTMLInputElement>('ebay-listing-fee').value);
  const adCost       = poundsToPence(el<HTMLInputElement>('ebay-ad-cost').value);

  const safeUom  = uom <= 0 ? 1 : uom;
  const unitCost = Math.round(((costPerBatch / safeUom) * qty) * (1 - disc));
  const costPrice = unitCost + packing + (ppIncluded ? ppCost : 0) + vatAmt + listingFee + adCost;

  return {
    costPerBatch, uom, qtyRequired: qty, discountRate: disc, unitCost,
    packingMaterials: packing, ppCost, ppIncludedInPrice: ppIncluded,
    vatOnSellingPrice: vatAmt, listingFee, adCost,
    costPrice, shippingCost: ppIncluded ? 0 : ppCost,
  };
}

// ---------------------------------------------------------------------------
// Custom fees
// ---------------------------------------------------------------------------

function renderCustomFeeList(): void {
  const list = el('custom-fee-list');
  list.innerHTML = '';
  customFees.forEach((fee) => {
    const item = document.createElement('div');
    item.className = 'custom-fee-item';

    const displayValue = fee.type === 'fixed_per_item'
      ? `£${penceToDecimal(fee.value)}`
      : `${(fee.value * 100).toFixed(2)}%`;

    const typeLabel: Record<string, string> = {
      fixed_per_item: 'Fixed', percentage_of_sale: '% sale', percentage_of_profit: '% profit',
    };

    item.innerHTML = `
      <span class="fee-label">${fee.label}</span>
      <span class="fee-meta">${typeLabel[fee.type]} · ${displayValue}</span>
      <button class="remove-fee" data-id="${fee.id}">Remove</button>
    `;
    list.appendChild(item);
  });

  list.querySelectorAll<HTMLButtonElement>('.remove-fee').forEach((btn) => {
    btn.addEventListener('click', () => {
      customFees = customFees.filter((f) => f.id !== btn.dataset.id);
      renderCustomFeeList();
    });
  });
}

function addCustomFee(): void {
  const labelInput = el<HTMLInputElement>('custom-fee-label');
  const typeSelect  = el<HTMLSelectElement>('custom-fee-type');
  const valueInput  = el<HTMLInputElement>('custom-fee-value');

  const label    = labelInput.value.trim();
  const type     = typeSelect.value as CustomFee['type'];
  const rawValue = parseFloat(valueInput.value);

  if (!label)                          { labelInput.focus(); return; }
  if (isNaN(rawValue) || rawValue < 0) { valueInput.focus(); return; }

  const value = type === 'fixed_per_item' ? poundsToPence(rawValue) : percentageToRate(rawValue);
  customFees.push({ id: `custom-${++customFeeCounter}`, label, type, value });
  labelInput.value = '';
  valueInput.value = '';
  renderCustomFeeList();
}

// ---------------------------------------------------------------------------
// Excluded fees
// ---------------------------------------------------------------------------

function readExcludedFees(): Set<ExcludableFee> {
  const excluded = new Set<ExcludableFee>();
  const ids: ExcludableFee[] = ['referralFee', 'paymentFee', 'fulfilmentFee', 'vatOnFees', 'shippingCost'];
  for (const id of ids) {
    const cb = document.getElementById(`exclude-${id}`) as HTMLInputElement | null;
    if (cb?.checked) excluded.add(id);
  }
  return excluded;
}

// ---------------------------------------------------------------------------
// Build options
// ---------------------------------------------------------------------------

function buildBaseOptions(): Omit<CalculationOptions, 'sellingPrice'> {
  const isEbay = el<HTMLSelectElement>('marketplace').value === 'ebay-uk';
  if (isEbay) applyEbayCostBuilder();

  const costPrice    = isEbay
    ? parseInt(el<HTMLInputElement>('cost-price-ebay').value || '0')
    : poundsToPence(el<HTMLInputElement>('cost-price').value);

  const shippingCost = isEbay
    ? parseInt(el<HTMLInputElement>('shipping-cost-ebay').value || '0')
    : poundsToPence(el<HTMLInputElement>('shipping-cost').value);

  const weightRaw = parseFloat(el<HTMLInputElement>('weight-grams').value);
  const opts: Omit<CalculationOptions, 'sellingPrice'> = {
    costPrice,
    vatRegistered: el<HTMLInputElement>('vat-registered').checked,
    vatRate: 0.20,
    fulfilmentModeId: el<HTMLSelectElement>('fulfilment-mode').value,
    shippingCost,
    customFees,
    excludedFees: readExcludedFees(),
  };
  if (!isNaN(weightRaw)) opts.weightGrams = weightRaw;
  return opts;
}

// ---------------------------------------------------------------------------
// Run and show result sheet
// ---------------------------------------------------------------------------

function openResultSheet(): void {
  el('result-backdrop').classList.add('open');
  el('result-sheet').classList.add('open');
}

function closeResultSheet(): void {
  el('result-backdrop').classList.remove('open');
  el('result-sheet').classList.remove('open');
}

function runAndShowResult(): void {
  const marketplaceId = el<HTMLSelectElement>('marketplace').value;
  const config = getMarketplace(marketplaceId);
  const resultBody = el('result-body');
  const debugContainer = el('debug-content');
  const mode = el<HTMLButtonElement>('bar-next').dataset.calcMode ?? 'calculate';

  if (!config) { renderError(resultBody, 'Please select a marketplace.'); openResultSheet(); return; }

  if (mode === 'solve') {
    const targetMode = el<HTMLSelectElement>('target-mode').value as SolverTargetMode;
    const rawValue   = parseFloat(el<HTMLInputElement>('target-profit').value);

    if (isNaN(rawValue) || rawValue < 0) {
      el('step-4-warning').textContent = 'Please enter a valid target.';
      el('step-4-warning').style.display = 'block';
      return;
    }

    el('step-4-warning').style.display = 'none';

    const solverOpts: SolverOptions = {
      ...buildBaseOptions(),
      targetMode,
      targetNetProfit: targetMode === 'fixed' ? poundsToPence(rawValue) : 0,
      targetMargin:    targetMode === 'margin' ? percentageToRate(rawValue) : 0,
    };

    const result = solveForPrice(config, solverOpts);
    renderSolverResult(resultBody, result);

    const ebayCostTrace = buildEbayCostTrace();
    const debugTrace: DebugTrace = ebayCostTrace
      ? { fees: result.trace.feeTrace, solver: result.trace, ebayCost: ebayCostTrace }
      : { fees: result.trace.feeTrace, solver: result.trace };
    renderDebugTrace(debugContainer, debugTrace);

  } else {
    const sellingPrice = poundsToPence(el<HTMLInputElement>('selling-price').value);

    if (sellingPrice <= 0) {
      el('step-4-warning').textContent = 'Please enter a valid selling price.';
      el('step-4-warning').style.display = 'block';
      return;
    }

    el('step-4-warning').style.display = 'none';

    const { breakdown, trace: feeTrace } = calculateFeesWithTrace(config, { ...buildBaseOptions(), sellingPrice });
    renderBreakdown(resultBody, breakdown);

    const ebayCostTrace = buildEbayCostTrace();
    const debugTrace: DebugTrace = ebayCostTrace
      ? { fees: feeTrace, ebayCost: ebayCostTrace }
      : { fees: feeTrace };
    renderDebugTrace(debugContainer, debugTrace);
  }

  openResultSheet();
}

// ---------------------------------------------------------------------------
// Mode toggle
// ---------------------------------------------------------------------------

function setMode(mode: 'calculate' | 'solve'): void {
  el('calculate-group').style.display = mode === 'calculate' ? 'block' : 'none';
  el('solve-group').style.display     = mode === 'solve'     ? 'block' : 'none';
  el('mode-calculate').classList.toggle('active', mode === 'calculate');
  el('mode-solve').classList.toggle('active', mode === 'solve');
  el<HTMLButtonElement>('bar-next').dataset.calcMode = mode;
}

function updateTargetInputLabel(): void {
  const mode = el<HTMLSelectElement>('target-mode').value as SolverTargetMode;
  const label = el('target-profit-label');
  const input = el<HTMLInputElement>('target-profit');
  if (mode === 'margin') {
    label.textContent = 'Target net margin (%)';
    input.placeholder = '20';
    input.step = '0.1';
  } else {
    label.textContent = 'Target net profit (£)';
    input.placeholder = '5.00';
    input.step = '0.01';
  }
}

// ---------------------------------------------------------------------------
// Summary (overview) sheet
// ---------------------------------------------------------------------------

function updateSummarySheet(): void {
  const isEbay = el<HTMLSelectElement>('marketplace').value === 'ebay-uk';
  const config = getMarketplace(el<HTMLSelectElement>('marketplace').value);
  const modeEl = el<HTMLSelectElement>('fulfilment-mode');
  const modeLabel = modeEl.options[modeEl.selectedIndex]?.text ?? '';

  const rows: { icon: string; key: string; val: string; step: number; visited: boolean }[] = [
    {
      icon: '🛒',
      key: 'Marketplace',
      val: config ? `${config.name} / ${modeLabel}` : 'Not set',
      step: 1,
      visited: true,
    },
    {
      icon: '💷',
      key: 'Cost',
      val: (() => {
        if (isEbay) {
          const cost = parseFloat(el<HTMLInputElement>('ebay-cost-per-batch').value);
          const uom  = parseFloat(el<HTMLInputElement>('ebay-uom').value) || 1;
          const qty  = parseFloat(el<HTMLInputElement>('ebay-qty-required').value) || 1;
          const disc = parseFloat(el<HTMLInputElement>('ebay-discount').value) || 0;
          if (cost > 0) return `${formatGBP(Math.round(((cost / uom) * qty) * (1 - disc / 100) * 100))} unit cost`;
          return 'Not set';
        }
        const cost = parseFloat(el<HTMLInputElement>('cost-price').value);
        return cost > 0 ? formatGBP(Math.round(cost * 100)) : 'Not set';
      })(),
      step: isEbay ? 2 : 3,
      visited: visitedSteps.has(isEbay ? 2 : 3),
    },
    {
      icon: '🏷',
      key: 'Fees',
      val: (() => {
        const vatReg = el<HTMLInputElement>('vat-registered').checked;
        const excl: string[] = [];
        (['referralFee', 'paymentFee', 'fulfilmentFee', 'shippingCost', 'vatOnFees'] as ExcludableFee[]).forEach((id) => {
          if ((document.getElementById(`exclude-${id}`) as HTMLInputElement | null)?.checked) excl.push(id.replace(/Fee|Cost/, ''));
        });
        const parts = [vatReg ? 'VAT reg' : null, excl.length ? `excl. ${excl.join(', ')}` : null].filter(Boolean);
        return parts.join(' · ') || 'Standard';
      })(),
      step: 3,
      visited: visitedSteps.has(3),
    },
    {
      icon: '🎯',
      key: 'Target',
      val: (() => {
        const calcMode = el<HTMLButtonElement>('bar-next').dataset.calcMode ?? 'calculate';
        if (calcMode === 'solve') {
          const tm  = el<HTMLSelectElement>('target-mode').value;
          const val = parseFloat(el<HTMLInputElement>('target-profit').value);
          return tm === 'margin'
            ? (val > 0 ? `${val}% margin` : 'Not set')
            : (val > 0 ? `${formatGBP(Math.round(val * 100))} profit` : 'Not set');
        }
        const sp = parseFloat(el<HTMLInputElement>('selling-price').value);
        return sp > 0 ? `Sell at ${formatGBP(Math.round(sp * 100))}` : 'Not set';
      })(),
      step: 4,
      visited: visitedSteps.has(4),
    },
  ];

  el('summary-body').innerHTML = rows.map((r) => `
    <div class="overview-row ${r.visited ? '' : 'dimmed'}">
      <div class="overview-icon">${r.icon}</div>
      <div class="overview-meta">
        <div class="overview-key">${r.key}</div>
        <div class="overview-val ${r.val === 'Not set' ? 'placeholder' : ''}">${r.val}</div>
      </div>
      <button class="edit-btn" data-step="${r.step}">Edit</button>
    </div>
  `).join('');

  el('summary-body').querySelectorAll<HTMLElement>('.edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeSummarySheet();
      goToStep(parseInt(btn.dataset.step ?? '1'));
    });
  });
}

function openSummarySheet(): void {
  updateSummarySheet();
  el('summary-backdrop').classList.add('open');
  el('summary-sheet').classList.add('open');
}

function closeSummarySheet(): void {
  el('summary-backdrop').classList.remove('open');
  el('summary-sheet').classList.remove('open');
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  populateMarketplaceSelect();
  const first = listMarketplaces()[0];
  if (first) populateFulfilmentModes(first.id);
  applyMarketplaceContext();

  el<HTMLSelectElement>('marketplace').addEventListener('change', (e) => {
    const id = (e.target as HTMLSelectElement).value;
    populateFulfilmentModes(id);
    applyMarketplaceContext();
  });

  // Bottom bar nav
  el('bar-next').dataset.calcMode = 'calculate';
  el('bar-next').addEventListener('click', () => {
    const isLast = stepIndex() === totalSteps() - 1;
    if (isLast) runAndShowResult();
    else next();
  });

  el('bar-back').addEventListener('click', prev);
  el('topbar-back').addEventListener('click', prev);

  // Mode toggle
  el('mode-calculate').addEventListener('click', () => setMode('calculate'));
  el('mode-solve').addEventListener('click', () => setMode('solve'));
  el('target-mode').addEventListener('change', updateTargetInputLabel);

  // Custom fees
  el('add-fee-btn').addEventListener('click', addCustomFee);

  // Summary sheet
  el('summary-btn').addEventListener('click', openSummarySheet);
  el('summary-close').addEventListener('click', closeSummarySheet);
  el('summary-backdrop').addEventListener('click', closeSummarySheet);

  // Result sheet
  el('result-close').addEventListener('click', closeResultSheet);
  el('result-backdrop').addEventListener('click', closeResultSheet);

  // Workings modal
  el('workings-close').addEventListener('click', () => {
    el('workings-modal').classList.remove('open');
    el('workings-backdrop').classList.remove('open');
  });
  el('workings-backdrop').addEventListener('click', () => {
    el('workings-modal').classList.remove('open');
    el('workings-backdrop').classList.remove('open');
  });

  clearDebugTrace(el('debug-content'));
  goToStep(1);
});

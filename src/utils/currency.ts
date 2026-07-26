// All internal values are stored in pence to avoid floating-point drift.

/** Format pence as a GBP string, e.g. 1999 -> "£19.99" */
export function formatGBP(pence: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
  }).format(pence / 100);
}

/** Format pence as a plain decimal string, e.g. 1999 -> "19.99" */
export function penceToDecimal(pence: number): string {
  return (pence / 100).toFixed(2);
}

/** Parse a user-entered pound value (e.g. "19.99") into pence (1999). */
export function poundsToPence(pounds: string | number): number {
  const value = typeof pounds === 'string' ? parseFloat(pounds) : pounds;
  if (isNaN(value)) return 0;
  return Math.round(value * 100);
}

/** Parse a user-entered percentage (e.g. "7.5") into a decimal rate (0.075). */
export function percentageToRate(percentage: string | number): number {
  const value = typeof percentage === 'string' ? parseFloat(percentage) : percentage;
  if (isNaN(value)) return 0;
  return value / 100;
}

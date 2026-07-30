# Margin Desk — eBay UK Cost & Fee Calculations

This document is a self-contained spec of every calculation Margin Desk performs for an
eBay UK listing: turning supplier pricing into a true unit cost, calculating fees and net
profit for a given selling price, and solving for the selling price needed to hit a target
profit or margin. It exists so an independent reviewer (human or AI) can check the algebra
without needing the TypeScript source.

**Units convention:** all money is an integer number of pence. Rounding happens with
`roundPence(x) = Math.round(x)` — standard round-half-away-from-zero to the nearest whole
pence — applied at each fee calculation, never accumulated as fractional pence. Percentage
rates are decimals (e.g. `0.129` for 12.9%), not integers.

Source files, for cross-reference: `src/marketplaces/ebay-cost-builder.ts` (Stage 1),
`src/engine/fees.ts` (Stage 2), `src/engine/solver.ts` (Stage 3).

---

## eBay UK marketplace constants

Referral fee and payment fee are **not hardcoded in the calculation engine** — they live in
`src/marketplaces/ebay.ts` as ordinary `MarketplaceConfig` data (the same generic fields
Amazon and B&Q use), and can be overridden per calculation by a caller.

| Constant | Default value | Source |
|---|---|---|
| Referral fee rate | 12.9% of selling price, flat (no tiers, no minimum) | `ebay.ts: referralFees[0].rate` |
| Payment processing fee | £0.36 flat, 0% — bundled into the referral rate above rather than charged separately | `ebay.ts: paymentFee` |
| Closing fee | £0.00 (flat, per item) | `ebay.ts: closingFee` |
| VAT on marketplace fees | charged at the seller's VAT rate (normally 20%), only if the seller is VAT-registered | `ebay.ts: vatOnFees` |
| Fulfilment | self-fulfilled, £0.00 | `ebay.ts: fulfilmentModes` |

**Per-request overrides:** `CalculationOptions.referralRateOverride` (a decimal rate) and
`.paymentFeeOverride` (`{ percentage, fixed }`) let a caller replace the configured
referral/payment fee for a single calculation — e.g. a seller on a different eBay fee
category or subscription tier. When present, Stage 2 (`calcReferralFee` in `fees.ts`) uses
the override directly instead of looking up `config.referralFees`, and Stage 3's algebraic
estimate (`solver.ts`) reads the same override values so the two stages never disagree
about which rate is in effect. Both are optional request fields on `/api/calculate` and
`/api/solve`; omitting them uses the marketplace's configured defaults above.

---

## Stage 1 — Cost Builder

**Purpose:** turn supplier pricing into `costPrice` and `shippingCost`, the two values fed
into Stage 2.

### Inputs

| Field | Meaning |
|---|---|
| `costPerBatch` | supplier price for a whole batch (pence) |
| `uom` | units per batch, e.g. 12 |
| `qtyRequired` | units needed per listing |
| `discountRate` | supplier discount, decimal |
| `packingMaterials` | packing cost per item (pence, fixed) |
| `ppCost` | postage + packing cost (pence) |
| `ppIncludedInPrice` | true = bundle P+P into the item price; false = charge as separate shipping |
| `vatOnSellingPrice` | **either** `{ mode: 'fixed', amount }` (pence) **or** `{ mode: 'rate', rate }` (decimal) |
| `listingFee` | eBay's flat per-listing fee (pence) — always fixed, never a rate |
| `adCost` | promoted listings cost — **either** `{ mode: 'fixed', amount }` **or** `{ mode: 'rate', rate }` |

### Why VAT and ad cost can be a rate instead of a fixed amount

VAT on the selling price (the output VAT a VAT-registered seller must remit) and
promoted-listings ad spend are often *percentages of whatever the final selling price turns
out to be* — e.g. "VAT is 1/6th of the price" (`1 − 1/1.2 ≈ 0.166667`, for 20%-inclusive
pricing) or "ads cost 5% of the sale." Turning a rate into a pence amount *before* the
selling price is known would require already knowing the selling price — a circular
dependency. So:

- **Fixed mode** (`{ mode: 'fixed', amount }`): the amount is a known pence value. It's
  added directly into `costPrice` (see formula below), same as any other fixed cost.
- **Rate mode** (`{ mode: 'rate', rate }`): the amount is *not* computed here at all. It is
  emitted separately as a `generatedCustomFee` of type `percentage_of_sale`, which the
  caller merges into the main calculation's `customFees` list (Stage 2). Stage 2 and the
  Stage 3 solver already handle `percentage_of_sale` fees algebraically (as a rate in the
  divisor), so no circularity is introduced.

### Formulas

```
safeUom  = uom > 0 ? uom : 1
unitCost = roundPence( (costPerBatch / safeUom) × qtyRequired × (1 − discountRate) )

vatFixedAmount = vatOnSellingPrice.mode === 'fixed' ? vatOnSellingPrice.amount : 0
adFixedAmount  = adCost.mode === 'fixed' ? adCost.amount : 0

costPrice = roundPence(
  unitCost
  + packingMaterials
  + (ppIncludedInPrice ? ppCost : 0)
  + vatFixedAmount
  + listingFee
  + adFixedAmount
)

shippingCost = ppIncludedInPrice ? 0 : ppCost

generatedCustomFees = [
  ...(vatOnSellingPrice.mode === 'rate'
    ? [{ label: 'VAT on selling price', type: 'percentage_of_sale', value: vatOnSellingPrice.rate }]
    : []),
  ...(adCost.mode === 'rate'
    ? [{ label: 'Ad / promoted listings', type: 'percentage_of_sale', value: adCost.rate }]
    : []),
]
```

`costPrice` and `shippingCost` feed into Stage 2 as `CalculationOptions.costPrice` /
`shippingCost`. `generatedCustomFees` gets appended to `CalculationOptions.customFees`.

**Note on referral fee base:** when `ppIncludedInPrice` is false, `ppCost` becomes
`shippingCost` rather than part of `costPrice`. eBay's referral fee is calculated on
`sellingPrice` only (see Stage 2) — this codebase does not add shipping into the referral
fee base. Worth an explicit check: is that correct for eBay UK's real fee policy, or should
referral fee be charged on `sellingPrice + shippingCost` when P+P is separate?

---

## Stage 2 — Fee Calculation (`calculateFees`, for a given selling price)

Given a selling price (already known — either user-entered or solved for in Stage 3), every
fee is computed in this order:

```
1. referralFee = roundPence(sellingPrice × referralRate)               # eBay UK default: flat 12.9%, no minimum
                 # referralRate = referralRateOverride if the caller supplied one, else config.referralFees[0].rate
2. closingFee  = 0                                                     # eBay UK: always 0
3. paymentFee  = roundPence(sellingPrice × paymentPercentage + paymentFixed)   # eBay UK default: 0% + £0.36
                 # (paymentPercentage, paymentFixed) = paymentFeeOverride if the caller supplied one, else config.paymentFee
4. fulfilmentFee = 0                                                   # self-fulfilled
5. marketplaceFeeSubtotal = referralFee + closingFee + paymentFee + fulfilmentFee
6. vatOnFees = (sellerIsVatRegistered) ? roundPence(marketplaceFeeSubtotal × vatRate) : 0
               # vatRate defaults to 0.20; this is VAT eBay charges ON ITS FEES,
               # NOT VAT on the item's own selling price (that's a separate customFee, see Stage 1)
7. shippingCost = (from Stage 1, or manually entered)
8. customFees:
     fixed_per_item        -> amount = value (pence, as-is)
     percentage_of_sale    -> amount = roundPence(sellingPrice × value)
     percentage_of_profit  -> deferred to step 9 (needs provisional profit first)
9. provisionalProfit = sellingPrice - marketplaceFeeSubtotal - vatOnFees - shippingCost
                        - costPrice - sum(fixed_per_item + percentage_of_sale fees)
   percentage_of_profit fee amount = roundPence(max(provisionalProfit, 0) × value)
10. totalFees = marketplaceFeeSubtotal + vatOnFees + shippingCost + sum(all customFees)
11. netProfit = sellingPrice - totalFees - costPrice
12. netMargin = round2dp( netProfit / sellingPrice × 100 )   # 0 if sellingPrice is 0
13. roi       = round2dp( netProfit / costPrice × 100 )      # 0 if costPrice is 0
```

Every step rounds to the nearest pence independently (no fractional pence carried between
steps).

---

## Stage 3 — Solver (`solveForPrice`, find the selling price for a target profit/margin)

**Goal:** find the minimum `sellingPrice` (integer pence) such that `netProfit` (Stage 2,
step 11) is **at least** the target — either a fixed net profit or a percentage margin —
without ever landing under it.

### Step A — Algebraic starting estimate

This gives a fast, close first guess. It is **not required to be exact** — it deliberately
omits two things that are nonlinear or awkward to fold into a single divisor
(`vatOnFees`, since it depends on `marketplaceFeeSubtotal` which is itself a sum of several
rates plus a flat amount, and `percentage_of_profit` custom fees, which depend on
provisional profit). Steps B and C below correct for anything the estimate misses, so the
final answer is still exact — but a reviewer should not expect this estimate's formula
alone to reproduce the final `netProfit` precisely.

```
referralRate = referralRateOverride ?? config.referralFees[0].rate    # eBay UK default: 0.129
paymentRate  = (paymentFeeOverride ?? config.paymentFee).percentage   # eBay UK default: 0
paymentFixed = (paymentFeeOverride ?? config.paymentFee).fixed        # eBay UK default: 36
percentageOfSaleCustomRates = sum of all customFees where type = 'percentage_of_sale'
fixedCustomFees             = sum of all customFees where type = 'fixed_per_item'

constants = costPrice + shippingCost + closingFee(0) + paymentFixed + fixedCustomFees

# Fixed-profit mode:
totalPercentageRate = referralRate + paymentRate + percentageOfSaleCustomRates
divisor  = 1 − totalPercentageRate
estimate = (constants + targetNetProfit) / divisor      # guard: if divisor <= 0, estimate = constants + targetNetProfit

# Margin mode (target is itself a % of the unknown selling price):
divisor  = 1 − referralRate − paymentRate − percentageOfSaleCustomRates − targetMargin
estimate = constants / divisor                           # guard: if divisor <= 0, estimate = constants × 10
```

This is the same algebraic principle as separating fixed costs from percentage-rate fees so
the divisor absorbs every percentage-of-selling-price term — the estimate is just allowed to
be approximate about *which* percentage terms it includes.

### Step B — Iterative refinement (up to 100 iterations)

```
price = estimate
repeat up to 100 times:
  breakdown = calculateFees(price)                 # full Stage 2 calculation, exact
  targetProfit = (mode == 'fixed') ? targetNetProfit
                                    : ceil(price × targetMargin)   # ceiling, not round — see note below
  error = targetProfit − breakdown.netProfit
  if |error| <= 1 penny: converged, go to Step C
  price = roundPence(price + error)
```

**Why `ceil` for the margin target, not round-to-nearest:** `netProfit` is always a whole
number of pence, so the bar for "at least X% margin" must round *up* — rounding to nearest
could set a target a fraction of a penny below the true X%, and let a `netProfit` through
that's technically under the requested percentage.

### Step C — Ratchet to guarantee the target is actually met

Floating-point convergence in Step B can land a penny or two short in edge cases (or the
target itself moves, in margin mode, as price moves). After convergence:

```
finalPrice = price
while finalPrice's netProfit < targetProfit(at finalPrice), up to 20 times:
  finalPrice += 1 penny
  recompute netProfit and targetProfit at the new finalPrice
```

Both `netProfit` and `targetProfit` are recomputed at every candidate price, specifically
because in margin mode the target rises right along with the price — a single unconditional
"+1 penny" bump is not guaranteed to close the gap.

If the loop never converges within 100 iterations, `converged: false` is returned along with
whatever price was reached, rather than throwing.

---

## Worked example (verified against the running app)

Inputs:
- Cost builder: `costPerBatch` = 1200p (£12.00), `uom` = 1, `qtyRequired` = 1,
  `discountRate` = 0, `packingMaterials` = 0, `ppCost` = 0, `ppIncludedInPrice` = false,
  `listingFee` = 0
- `vatOnSellingPrice` = `{ mode: 'rate', rate: 0.166667 }` (the "20% VAT-inclusive" preset,
  `1 − 1/1.2`)
- `adCost` = `{ mode: 'rate', rate: 0.05 }` (5%)
- Not VAT-registered (so `vatOnFees` = 0 throughout)
- Solve mode: fixed target net profit = 2000p (£20.00)

No `referralRateOverride` / `paymentFeeOverride` supplied, so eBay UK's configured defaults
apply: `referralRate = 0.129`, `paymentRate = 0`, `paymentFixed = 36`.

**Stage 1:**
```
unitCost  = roundPence(1200 / 1 × 1 × 1) = 1200
costPrice = roundPence(1200 + 0 + 0 + 0 + 0 + 0) = 1200      # both VAT and ad cost are rate-mode -> 0 here
shippingCost = 0
generatedCustomFees = [
  { label: 'VAT on selling price', type: 'percentage_of_sale', value: 0.166667 },
  { label: 'Ad / promoted listings', type: 'percentage_of_sale', value: 0.05 },
]
```

**Stage 3, Step A:**
```
constants = 1200 + 0 + 0 + 36 + 0 = 1236
totalPercentageRate = 0.129 + 0 + (0.166667 + 0.05) = 0.345667
divisor  = 1 − 0.345667 = 0.654333
estimate = (1236 + 2000) / 0.654333 = 3236 / 0.654333 ≈ 4945.49 -> 4945p (£49.45)
```

**Stage 3, Step B (converges immediately at £49.45) → Stage 2 at sellingPrice = 4945p:**
```
referralFee = roundPence(4945 × 0.129) = roundPence(637.905) = 638      (£6.38)
paymentFee  = roundPence(4945 × 0 + 36) = 36                            (£0.36)
marketplaceFeeSubtotal = 638 + 0 + 36 + 0 = 674
vatOnFees = 0                                                            (not VAT-registered)
VAT-on-selling-price fee = roundPence(4945 × 0.166667) = 824             (£8.24)
Ad cost fee               = roundPence(4945 × 0.05) = 247                (£2.47)
customFeeTotal = 824 + 247 = 1071
totalFees  = 674 + 0 + 0 + 1071 = 1745
netProfit  = 4945 − 1745 − 1200 = 2000                                   (£20.00 -- exactly the target)
netMargin  = round2dp(2000 / 4945 × 100) = 40.44 -> displayed "40.4%"
roi        = round2dp(2000 / 1200 × 100) = 166.67 -> displayed "166.7%"
```

**Result:** required selling price = **£49.45**, net profit = **£20.00** (target met exactly),
net margin **40.4%**, ROI **166.7%**. Total deductions = totalFees + costPrice = 1745 + 1200
= 2945p = **£29.45**.

These exact figures were reproduced via `/api/solve` before this document was written (see
the "Config update + generic overrides" implementation of the 12.9%/£0.36 fee correction).

---

## Questions for the reviewer

1. **No circularity:** does the Stage 1 → Stage 3 flow ever require knowing `sellingPrice`
   before it's solved for? (Rate-mode VAT/ad cost are deliberately kept out of `costPrice`
   and routed through `customFees` instead — confirm this is sufficient and nothing else in
   Stage 1 or Stage 2 has the same problem.)
2. **Divisor guards:** are the `divisor <= 0` fallbacks in Step A (Solver) reasonable, given
   they only affect the *starting estimate* and Steps B/C still run to find the true answer
   (or report `converged: false`)?
3. **Rounding order:** each fee is rounded to the nearest penny independently, rather than
   rounding a running total once at the end. Does that introduce any accumulation error
   worth worrying about, especially for `netMargin`/`roi` (computed from already-rounded
   pence values)?
4. **Referral fee base:** confirm whether eBay UK's real referral fee should include
   `shippingCost` in its base when P+P is charged separately (`ppIncludedInPrice = false`).
   This codebase currently charges referral fee on `sellingPrice` only.
5. **Ceiling vs rounding for margin targets** (Step B): confirm `ceil(price × targetMargin)`
   is the right way to avoid ever landing a fraction of a penny under a requested margin.
6. **Ratchet step correctness** (Step C): confirm recomputing both `netProfit` and
   `targetProfit` at each +1p candidate (rather than a single unconditional nudge) is
   necessary and sufficient in margin mode, where the target itself moves with price.
7. **Override isolation:** `referralRateOverride`/`paymentFeeOverride` apply only to the
   single `CalculationOptions` object they're set on, and are read fresh from `options` in
   both Stage 2 (`calcReferralFee`, `paymentFeeConfig`) and Stage 3 (`estimateSellingPrice`)
   rather than mutating the shared `MarketplaceConfig`. Confirm this can't leak an override
   from one request/marketplace into another (e.g. concurrent API requests, or the UI's
   shared `config` object across calculations).

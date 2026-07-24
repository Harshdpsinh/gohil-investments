// src/utils/commissionTiers.js
// ─────────────────────────────────────────────────────────────
// Tiered commission calculation for the Commission Agent.
//
// This module is COMPLETELY INDEPENDENT of the existing flat-rate
// commission engine in CommissionPage.jsx. It only powers the new
// /commission-agent route. Nothing here touches the `policies`
// collection or the per-policy fyCommission/ryCommission fields.
//
// A "tier" is shaped: { id, label, min, max, rate }
//   min, max  → numeric INR brackets (max may be null/Infinity for open-ended top tier)
//   rate      → fraction (0.04 = 4%), NOT a percent
// ─────────────────────────────────────────────────────────────

const FIN = (n) => Number.isFinite(n)

/**
 * validateTiers(tiers)
 * Returns { ok: boolean, errors: string[], clean: Tier[] }
 * - rejects non-array
 * - normalises max: null/undefined/<0 → Infinity
 * - drops tiers with non-finite min/rate (collects an error each)
 * - sorts by min ascending
 */
export function validateTiers(input) {
  const errors = []
  if (!Array.isArray(input)) return { ok: false, errors: ['Tiers must be an array'], clean: [] }

  const clean = []
  input.forEach((t, i) => {
    if (!t || typeof t !== 'object') { errors.push(`Tier #${i + 1} is not an object`); return }
    const min  = Number(t.min)
    const rate = Number(t.rate)
    if (!FIN(min))  { errors.push(`Tier #${i + 1}: "min" is not a number`); return }
    if (!FIN(rate)) { errors.push(`Tier #${i + 1}: "rate" is not a number`); return }
    let max = t.max
    if (max === null || max === undefined || max === '' || Number(max) < 0) max = Infinity
    if (!FIN(Number(max))) max = Infinity
    clean.push({
      id:    t.id || `tier_${i + 1}`,
      label: t.label || `${min}–${max === Infinity ? '∞' : max}`,
      min,
      max:   Number(max),
      rate,
    })
  })

  clean.sort((a, b) => a.min - b.min)
  return { ok: errors.length === 0, errors, clean }
}

/**
 * calcTieredCommission(amount, tiers)
 * Splits `amount` across all tiers whose band it overlaps.
 *
 * Returns:
 * {
 *   steps:    [{ tierId, label, bandStart, bandEnd, bandAmount, rate, commission }],
 *   total:    number,
 *   tiersHit: number,
 * }
 *
 * Edge cases (handled, never throws):
 *   - amount <= 0            → empty steps, total 0
 *   - amount below first tier→ empty steps, total 0 (nothing sits in any band)
 *   - open-ended top tier    → max = Infinity, band = amount - tier.min
 *   - empty/invalid tiers    → empty steps, total 0
 */
export function calcTieredCommission(amount, tiers) {
  const amt = Number(amount)
  if (!FIN(amt) || amt <= 0) return { steps: [], total: 0, tiersHit: 0 }

  const { clean } = validateTiers(tiers)
  if (clean.length === 0) return { steps: [], total: 0, tiersHit: 0 }

  const steps = []
  let total = 0

  for (const t of clean) {
    if (amt <= t.min) break           // no overlap with this or any higher band
    const bandStart = t.min
    const bandEnd   = Math.min(amt, t.max)
    const bandAmount = bandEnd - bandStart
    if (!(bandAmount > 0)) continue   // skip zero/negative bands (e.g. adjacent tiers)
    const commission = bandAmount * t.rate
    total += commission
    steps.push({
      tierId:      t.id,
      label:       t.label,
      bandStart,
      bandEnd:     t.max === Infinity ? Infinity : bandEnd,
      bandAmount,
      rate:        t.rate,
      commission,
    })
  }

  return { steps, total, tiersHit: steps.length }
}

/**
 * formatCalculationNote(result)
 * Human-readable trace of how the split was done, for the JSON output field
 * `commission_breakdown.calculation_steps`.
 */
export function formatCalculationNote(result) {
  if (!result || !result.steps.length) return 'No commission — amount falls outside all tiers.'
  const lines = result.steps.map(s =>
    `${s.label}: ₹${s.bandAmount.toLocaleString('en-IN')} × ${(s.rate * 100).toFixed(2)}% = ₹${s.commission.toLocaleString('en-IN')}`
  )
  if (result.steps.length === 1) {
    return `Single tier applied — ${lines[0]}.`
  }
  return `Split across ${result.steps.length} tiers:\n  - ${lines.join('\n  - ')}`
}

/**
 * describeTierApplied(result)
 * Compact string for the `tier_applied` field, e.g. "Tier 2 (single)" or "Tiers 1–3 (split)".
 */
export function describeTierApplied(result) {
  if (!result || !result.steps.length) return 'none'
  if (result.steps.length === 1) return `${result.steps[0].label} (single)`
  return `${result.steps[0].label} → ${result.steps[result.steps.length - 1].label} (split)`
}

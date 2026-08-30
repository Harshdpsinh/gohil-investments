// Display-only helpers for the commission 60+ filter. Does not change
// expected / received / tolerance math.
export function agedOutstanding(rows = [], minDays = 60) {
  return rows.filter(row => row.chaseable && (Number(row.ageingDays) || 0) >= minDays)
}

export function agedOutstandingTotals(rows = [], minDays = 60) {
  const list = agedOutstanding(rows, minDays)
  return {
    count: list.length,
    amount: list.reduce((sum, row) => sum + (Number(row.expected) || 0), 0),
  }
}

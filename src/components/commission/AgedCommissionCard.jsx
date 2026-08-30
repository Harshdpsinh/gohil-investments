// Presentation-only 60+ day unpaid strip. Does not change reconcile math.
import { fmtCurrency } from '../../utils/dateUtils'
import { agedOutstanding } from '../../utils/commissionAge'

export default function AgedCommissionCard({ rows = [], minDays = 60, onFilter }) {
  const list = agedOutstanding(rows, minDays)
  const amount = list.reduce((sum, row) => sum + (Number(row.expected) || 0), 0)
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-300 bg-red-50 p-3 text-xs dark:border-red-800 dark:bg-red-950/30 dark:text-red-100">
      <div>
        <p className="font-extrabold text-red-800 dark:text-red-200">{minDays}+ days unpaid</p>
        <p className="text-lg font-extrabold">{fmtCurrency(amount)}</p>
        <p className="text-red-700 dark:text-red-300">{list.length} policies still unpaid after {minDays} days</p>
      </div>
      {onFilter && (
        <button type="button" className="btn-secondary text-xs" onClick={onFilter}>
          Show {minDays}+ only
        </button>
      )}
    </div>
  )
}

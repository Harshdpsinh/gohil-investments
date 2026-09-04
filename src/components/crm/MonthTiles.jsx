import { fmtCurrency } from '../../utils/dateUtils'

export default function MonthTiles({ tiles, maxPremium, selectedKey, onSelect }) {
  return (
    <div className="space-y-3">
      <div className="flex h-24 items-end gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2 pb-2 pt-3 dark:border-slate-700 dark:bg-slate-900/40">
        {tiles.map(tile => (
          <button
            key={tile.key}
            type="button"
            title={`${tile.label} ${tile.yearShort}: ${fmtCurrency(tile.premium)}`}
            onClick={() => onSelect?.(tile)}
            className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"
          >
            <span
              className={`w-full rounded-t ${selectedKey === tile.key ? 'bg-teal-700' : 'bg-teal-500'}`}
              style={{ height: `${Math.max(6, Math.round((tile.premium / maxPremium) * 100))}%` }}
            />
            <span className="truncate text-[9px] font-bold text-slate-500">{tile.label}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        {tiles.map(tile => (
          <button
            key={tile.key}
            type="button"
            title={`${tile.label} '${tile.yearShort}: ${fmtCurrency(tile.premium)}`}
            onClick={() => onSelect?.(tile)}
            className={`gi-bento-tile min-h-0 gap-1 px-3 py-3 ${selectedKey === tile.key ? 'is-active' : ''}`}
          >
            <p className="gi-kpi-label">
              {tile.label} '{tile.yearShort}
            </p>
            <p className="text-sm font-extrabold tabular-nums text-slate-950 dark:text-white">{fmtCurrency(tile.premium)}</p>
            <p className="text-[10px] text-slate-500">{tile.count} polic{tile.count === 1 ? 'y' : 'ies'}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
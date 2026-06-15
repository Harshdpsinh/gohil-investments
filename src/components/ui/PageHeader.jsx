// UI MODERNIZATION - layout shell only; buttons/links passed in keep their original events.
export default function PageHeader({
  icon = null,
  title,
  subtitle,
  actions = null,
  meta = null,
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 rounded-2xl border border-slate-200/80 bg-white/80 p-5 shadow-sm backdrop-blur-md dark:border-slate-700/70 dark:bg-slate-900/70 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-3">
          {icon && (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/10 text-xl text-blue-600 dark:text-blue-300">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-black tracking-tight text-slate-950 dark:text-slate-50">{title}</h1>
            {subtitle && <p className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-300">{subtitle}</p>}
          </div>
        </div>
        {meta && <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

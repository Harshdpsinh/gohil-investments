// UI MODERNIZATION - visual-only helper; callers keep their own actions and handlers.
export default function EmptyState({
  icon = '□',
  title = 'No records found',
  description = 'Try adjusting the filters or add a new record.',
  action = null,
}) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300/80 bg-white/70 px-6 py-10 text-center shadow-sm backdrop-blur-sm dark:border-slate-700/80 dark:bg-slate-900/55">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-blue-500/20 bg-blue-500/10 text-2xl text-blue-600 shadow-inner dark:text-blue-300">
        {icon}
      </div>
      <h3 className="text-base font-extrabold tracking-tight text-slate-950 dark:text-slate-100">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

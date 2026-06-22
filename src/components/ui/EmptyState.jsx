import AppIcon from './AppIcon'

// UI MODERNIZATION - visual-only helper; callers keep their own actions and handlers.
export default function EmptyState({
  icon = 'file',
  title = 'No records found',
  description = 'Try adjusting the filters or add a new record.',
  action = null,
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">
        {typeof icon === 'string' ? <AppIcon name={icon} size={24} /> : icon}
      </div>
      <h3 className="text-base font-extrabold tracking-tight text-slate-950 dark:text-slate-100">{title}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

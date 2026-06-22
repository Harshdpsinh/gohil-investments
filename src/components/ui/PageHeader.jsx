import AppIcon from './AppIcon'

// UI MODERNIZATION - layout shell only; buttons/links passed in keep their original events.
export default function PageHeader({
  icon = null,
  title,
  subtitle,
  actions = null,
  meta = null,
}) {
  return (
    <header className="page-header">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-3">
          {icon && (
            <div className="page-header-icon">
              {typeof icon === 'string' ? <AppIcon name={icon} size={21} /> : icon}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="page-header-title">{title}</h1>
            {subtitle && <p className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-300">{subtitle}</p>}
          </div>
        </div>
        {meta && <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">{meta}</div>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  )
}

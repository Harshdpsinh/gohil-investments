// UI MODERNIZATION - logic unchanged
import AppIcon from './AppIcon'
export default function SearchBar({ value, onChange, placeholder = 'Search...' }) {
  return (
    <div className="gi-search relative w-full sm:w-auto">
      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-500 dark:text-slate-400">
        <AppIcon name="search" size={17} />
      </span>
      <input
        type="search"
        value={value}
        /* UI-only verification: search still returns e.target.value to the existing onChange handler. */
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="form-input w-full pl-10 pr-10 shadow-sm sm:w-80"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search"
          className="absolute inset-y-0 right-2 my-auto flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
          <AppIcon name="x" size={15} />
        </button>
      )}
    </div>
  )
}

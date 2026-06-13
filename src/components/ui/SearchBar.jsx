// src/components/ui/SearchBar.jsx
export default function SearchBar({ value, onChange, placeholder = 'Search...' }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m21 21-4.35-4.35M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z" />
        </svg>
      </span>
      <input
        type="search"
        value={value}
        /* UI-only verification: search still returns e.target.value to the existing onChange handler. */
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="form-input w-full pl-10 sm:w-80"
      />
    </div>
  )
}

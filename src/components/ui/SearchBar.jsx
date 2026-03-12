// src/components/ui/SearchBar.jsx
export default function SearchBar({ value, onChange, placeholder = 'Search…' }) {
  return (
    <div className="relative">
      <span className="absolute inset-y-0 left-0 pl-3 flex items-center
                       text-gray-400 pointer-events-none">
        🔍
      </span>
      <input
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="form-input pl-10 w-full sm:w-72"
      />
    </div>
  )
}

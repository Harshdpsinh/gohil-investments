// UI MODERNIZATION - skeleton-only placeholder; no data logic lives here.
export default function PageSkeleton({ type = 'table' }) {
  if (type === 'dashboard') {
    return (
      <div className="space-y-6 animate-fadeIn">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <div key={index} className="skeleton h-28" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => <div key={index} className="skeleton h-52" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="card animate-fadeIn space-y-4">
      <div className="skeleton h-8 w-44" />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="grid grid-cols-12 gap-3">
            <div className="skeleton col-span-3 h-8" />
            <div className="skeleton col-span-4 h-8" />
            <div className="skeleton col-span-2 h-8" />
            <div className="skeleton col-span-3 h-8" />
          </div>
        ))}
      </div>
    </div>
  )
}

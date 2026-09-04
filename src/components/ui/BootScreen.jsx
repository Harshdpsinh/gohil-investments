export default function BootScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <div className="w-80 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-teal-800">Gohil Investments</p>
        <div className="skeleton-shimmer mt-4 h-5 rounded-full" />
        <div className="skeleton-shimmer mt-4 h-20 rounded-xl" />
        <p className="mt-4 text-center text-sm font-semibold text-slate-500">Opening your book…</p>
        <button
          type="button"
          className="btn-secondary mt-4 w-full"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    </div>
  )
}

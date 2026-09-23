import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-4 py-16 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">404</p>
      <h1 className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">This page is not in the book</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        That address does not match a screen. Nothing was changed in your records.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link to="/dashboard" className="btn-primary">Go to dashboard</Link>
        <Link to="/clients" className="btn-secondary">Clients</Link>
      </div>
    </div>
  )
}

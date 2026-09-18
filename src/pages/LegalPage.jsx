import { Link } from 'react-router-dom'
import { BUSINESS } from '../utils/legal'

const SECTIONS = [
  { id: 'privacy', label: 'Privacy' },
  { id: 'terms', label: 'Terms' },
  { id: 'dmca', label: 'DMCA' },
]

export default function LegalPage({ section = 'privacy' }) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
          <Link to="/login" className="text-sm font-bold text-teal-800">Gohil Investments</Link>
          <nav className="flex gap-4 text-sm font-semibold text-slate-600">
            {SECTIONS.map(s => (
              <Link key={s.id} to={`/${s.id}`} className={section === s.id ? 'text-teal-800' : ''}>{s.label}</Link>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-10 text-sm leading-7">
        {section === 'privacy' && <Privacy />}
        {section === 'terms' && <Terms />}
        {section === 'dmca' && <Dmca />}
      </main>
    </div>
  )
}

function Privacy() {
  return (
    <article className="space-y-4">
      <h1 className="text-2xl font-semibold">Privacy</h1>
      <p>
        {BUSINESS.name} runs a private insurance workspace for staff. Client records, policies,
        documents, and WhatsApp threads stay in this workspace. We do not sell that data.
      </p>
      <p>
        Staff sign in with an email an admin created. There is no public self-signup.
        Anyone using this workspace must be 18 or older.
      </p>
      <p>
        Fonts are loaded from files we host with the app, not from Google Fonts.
        We do not run session-replay products (Hotjar, FullStory, LogRocket, Clarity).
        Password fields are not mirrored to third parties.
      </p>
      <p>
        Birthday and anniversary greetings are optional. On the client record, tick
        “No greeting messages”. In a greeting, reply <strong>STOP</strong>. Policy renewal
        reminders are transactional and may still go out for cover that is in force.
      </p>
      <Address />
    </article>
  )
}

function Terms() {
  return (
    <article className="space-y-4">
      <h1 className="text-2xl font-semibold">Terms</h1>
      <p>
        This product is a staff workspace for {BUSINESS.name}. It is not a paid consumer
        subscription. There is no checkout button and no auto-renewing Stripe plan.
        Admin provisions each login; an admin can revoke it from Manage Staff.
      </p>
      <p>
        Use is limited to authorised staff handling insurance clients in India.
        Do not upload records you are not allowed to hold. Policy numbers and KYC
        documents remain the client’s data, stored so the agency can service the book.
      </p>
      <Address />
    </article>
  )
}

function Dmca() {
  return (
    <article className="space-y-4">
      <h1 className="text-2xl font-semibold">DMCA designated agent</h1>
      <p>
        Copyright complaints about material stored in this workspace (client scans,
        proposal PDFs, uploaded images) go to the designated agent. We will review
        and remove infringing copies that we host.
      </p>
      <p>
        <strong>Designated agent:</strong> {BUSINESS.dmcaAgent}<br />
        <strong>Email:</strong> {BUSINESS.email}<br />
        <strong>Post:</strong> {BUSINESS.name}, {BUSINESS.city}
      </p>
      <p>
        Send the work you claim, the URL or file name if you have it, your contact
        details, and a statement that you have a good-faith belief the use is not
        authorised. This page is the public designation for the workspace.
      </p>
      <Address />
    </article>
  )
}

function Address() {
  return (
    <address className="not-italic text-slate-600">
      {BUSINESS.name}<br />
      {BUSINESS.line}<br />
      {BUSINESS.city}<br />
      {BUSINESS.phones.map(p => <span key={p}>{p}<br /></span>)}
      {BUSINESS.email}
    </address>
  )
}

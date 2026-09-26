import { useMemo, useState } from 'react'
import { auditCommission } from '../../utils/commissionAudit'
import { fmtCurrency } from '../../utils/dateUtils'
import TableHScroll from '../ui/TableHScroll'

const EMPTY = 'None identified from the supplied data.'

function money(value) {
  if (value == null || value === '') return '—'
  return fmtCurrency(value)
}

function Section({ title, children }) {
  return (
    <section className="fintech-panel p-4 sm:p-5">
      <h2 className="text-sm font-extrabold text-gray-950 dark:text-white">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Note({ children }) {
  return <p className="text-sm text-gray-500">{children}</p>
}

function Grid({ headers, rows, render }) {
  if (!rows.length) return <Note>{EMPTY}</Note>
  return (
    <TableHScroll>
      <table className="min-w-full text-xs">
        <thead><tr>{headers.map(header => <th key={header} className="table-header">{header}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => render(row, index))}</tbody>
      </table>
    </TableHScroll>
  )
}

export default function CommissionAudit({ policies = [], transactions = [], clients = [] }) {
  const [insurer, setInsurer] = useState('All')
  const report = useMemo(
    () => auditCommission({ policies, payouts: transactions, clients }),
    [policies, transactions, clients],
  )
  const insurers = useMemo(
    () => ['All', ...new Set(report.rows.map(row => row.insurer).filter(Boolean))].sort(),
    [report.rows],
  )
  const keep = row => insurer === 'All' || row.insurer === insurer
  const rows = report.rows.filter(keep)
  const { summary } = report

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-sm text-gray-500">Posted payouts against the CRM book. Nothing here is posted or changed.</p>
        <label className="text-xs font-bold text-gray-600">
          Insurer
          <select className="form-input mt-1" value={insurer} onChange={event => setInsurer(event.target.value)}>
            {insurers.map(name => <option key={name}>{name}</option>)}
          </select>
        </label>
      </div>

      <Section title="1. Executive summary">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[
            ['CRM commission booked', money(summary.expected)],
            ['Insurer commission received', money(summary.received)],
            ['Variance (expected − paid)', money(summary.variance)],
            ['CRM policies', summary.policies],
            ['Insurer payout rows', summary.payouts],
            ['Matched', summary.matched],
            ['Missing insurer payments', summary.missing],
            ['Shortfalls', summary.shortfall],
            ['Overpayments', summary.overpayment],
            ['Unbooked payouts', summary.unbooked],
            ['Policy-number conflicts', summary.conflict],
            ['Duplicate payouts', summary.duplicate],
            ['Manual review', summary.review],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
              <p className="mt-1 text-lg font-extrabold text-slate-950 dark:text-white">{value}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="2. Main reconciliation">
        <Grid
          headers={['Status', 'CRM month', 'Payout date', 'Insurer', 'Client', 'Policy no.', 'Plan', 'Expected', 'Actual paid', 'Variance', 'Score', 'Method', 'Reason']}
          rows={rows}
          render={row => (
            <tr key={`${row.status}-${row.policyNumber}-${row.payoutDate}-${row.clientName}`} className="table-row">
              <td className="table-cell font-bold">{row.status}</td>
              <td className="table-cell">{row.crmMonth || '—'}</td>
              <td className="table-cell">{row.payoutDate || '—'}</td>
              <td className="table-cell">{row.insurer || '—'}</td>
              <td className="table-cell">{row.clientName || '—'}</td>
              <td className="table-cell font-mono">{row.policyNumber || '—'}</td>
              <td className="table-cell">{row.planName || '—'}</td>
              <td className="table-cell">{money(row.expected)}</td>
              <td className="table-cell">{money(row.actual)}</td>
              <td className="table-cell">{money(row.variance)}</td>
              <td className="table-cell">{row.score}</td>
              <td className="table-cell">{row.method || '—'}</td>
              <td className="table-cell">{row.reason || '—'}</td>
            </tr>
          )}
        />
      </Section>

      <Section title="3. Missing in statement">
        <Grid
          headers={['CRM month', 'Insurer', 'Client', 'Policy no.', 'Plan', 'Expected', 'Last known payment', 'Action']}
          rows={report.missingInStatement.filter(keep)}
          render={row => (
            <tr key={row.policyNumber + row.clientName} className="table-row">
              <td className="table-cell">{row.crmMonth || '—'}</td>
              <td className="table-cell">{row.insurer || '—'}</td>
              <td className="table-cell">{row.clientName || '—'}</td>
              <td className="table-cell font-mono">{row.policyNumber || '—'}</td>
              <td className="table-cell">{row.planName || '—'}</td>
              <td className="table-cell">{money(row.expected)}</td>
              <td className="table-cell">—</td>
              <td className="table-cell">Ask the insurer for this payout, or confirm it is not on the statement.</td>
            </tr>
          )}
        />
      </Section>

      <Section title="4. Commission shortfalls">
        <Grid
          headers={['Insurer', 'Client', 'Policy no.', 'Expected', 'Actual', 'Shortfall', '% difference', 'Reason']}
          rows={report.shortfalls.filter(keep)}
          render={row => (
            <tr key={row.policyNumber} className="table-row">
              <td className="table-cell">{row.insurer || '—'}</td>
              <td className="table-cell">{row.clientName || '—'}</td>
              <td className="table-cell font-mono">{row.policyNumber || '—'}</td>
              <td className="table-cell">{money(row.expected)}</td>
              <td className="table-cell">{money(row.actual)}</td>
              <td className="table-cell">{money(row.variance)}</td>
              <td className="table-cell">{row.expected ? `${Math.round((row.variance / row.expected) * 100)}%` : '—'}</td>
              <td className="table-cell">{row.reason}</td>
            </tr>
          )}
        />
      </Section>

      <Section title="5. Unbooked payouts">
        <Grid
          headers={['Insurer', 'Payout date', 'Policy no.', 'Client', 'Plan', 'Actual paid', 'Possible CRM candidate', 'Score', 'Action']}
          rows={report.unbooked.filter(keep)}
          render={(row, index) => (
            <tr key={`${row.policyNumber}-${index}`} className="table-row">
              <td className="table-cell">{row.insurer || '—'}</td>
              <td className="table-cell">{row.payoutDate || '—'}</td>
              <td className="table-cell font-mono">{row.policyNumber || '—'}</td>
              <td className="table-cell">{row.clientName || '—'}</td>
              <td className="table-cell">{row.planName || '—'}</td>
              <td className="table-cell">{money(row.actual)}</td>
              <td className="table-cell">{row.candidates[0] || '—'}</td>
              <td className="table-cell">{row.score}</td>
              <td className="table-cell">Book the policy or confirm the payout is not yours. Not posted.</td>
            </tr>
          )}
        />
      </Section>

      <Section title="6. Policy number conflicts">
        <Grid
          headers={['Insurer', 'Client', 'Policy no.', 'Score', 'Conflict']}
          rows={report.conflicts.filter(keep)}
          render={row => (
            <tr key={row.policyNumber + row.clientName} className="table-row">
              <td className="table-cell">{row.insurer || '—'}</td>
              <td className="table-cell">{row.clientName || '—'}</td>
              <td className="table-cell font-mono">{row.policyNumber || '—'}</td>
              <td className="table-cell">{row.score}</td>
              <td className="table-cell">{row.reason}</td>
            </tr>
          )}
        />
      </Section>

      <Section title="7. Duplicate payouts">
        <Grid
          headers={['Insurer', 'Policy no.', 'Client', 'Actual paid', 'Reason']}
          rows={report.duplicates.filter(keep)}
          render={(row, index) => (
            <tr key={`${row.policyNumber}-${index}`} className="table-row">
              <td className="table-cell">{row.insurer || '—'}</td>
              <td className="table-cell font-mono">{row.policyNumber || '—'}</td>
              <td className="table-cell">{row.clientName || '—'}</td>
              <td className="table-cell">{money(row.actual)}</td>
              <td className="table-cell">{row.reason}</td>
            </tr>
          )}
        />
      </Section>

      <Section title="8. Insurer-wise summary">
        <Grid
          headers={['Insurer', 'CRM expected', 'Actual received', 'Variance', 'Matched', 'Missing', 'Shortfall', 'Unbooked', 'Review']}
          rows={summary.byInsurer.filter(row => insurer === 'All' || row.insurer === insurer)}
          render={row => (
            <tr key={row.insurer} className="table-row">
              <td className="table-cell">{row.insurer}</td>
              <td className="table-cell">{money(row.expected)}</td>
              <td className="table-cell">{money(row.actual)}</td>
              <td className="table-cell">{money(row.variance)}</td>
              <td className="table-cell">{row.matched}</td>
              <td className="table-cell">{row.missing}</td>
              <td className="table-cell">{row.shortfall}</td>
              <td className="table-cell">{row.unbooked}</td>
              <td className="table-cell">{row.review}</td>
            </tr>
          )}
        />
      </Section>

      <Section title="9. Month-wise summary">
        <Grid
          headers={['Month', 'Expected', 'Received', 'Variance', 'Matched', 'Missing', 'Shortfall']}
          rows={summary.byMonth}
          render={row => (
            <tr key={row.month} className="table-row">
              <td className="table-cell">{row.month}</td>
              <td className="table-cell">{money(row.expected)}</td>
              <td className="table-cell">{money(row.received)}</td>
              <td className="table-cell">{money(row.variance)}</td>
              <td className="table-cell">{row.matched}</td>
              <td className="table-cell">{row.missing}</td>
              <td className="table-cell">{row.shortfall}</td>
            </tr>
          )}
        />
      </Section>

      <Section title="10. Raise query immediately">
        <Grid
          headers={['Insurer', 'Policy no.', 'Client', 'Expected', 'Actual', 'Difference', 'Issue', 'Evidence', 'Query point']}
          rows={report.queries.filter(row => insurer === 'All' || row.insurer === insurer)}
          render={(row, index) => (
            <tr key={`${row.policyNumber}-${row.issue}-${index}`} className="table-row">
              <td className="table-cell">{row.insurer || '—'}</td>
              <td className="table-cell font-mono">{row.policyNumber || '—'}</td>
              <td className="table-cell">{row.clientName || '—'}</td>
              <td className="table-cell">{money(row.expected)}</td>
              <td className="table-cell">{money(row.actual)}</td>
              <td className="table-cell">{money(row.difference)}</td>
              <td className="table-cell">{row.issue}</td>
              <td className="table-cell">{row.evidence}</td>
              <td className="table-cell">{row.queryPoint}</td>
            </tr>
          )}
        />
      </Section>

      <Section title="11. Records requiring manual review">
        <Grid
          headers={['Insurer', 'Client', 'Policy no.', 'Score', 'Method', 'Reason']}
          rows={report.review.filter(keep)}
          render={(row, index) => (
            <tr key={`${row.policyNumber}-${index}`} className="table-row">
              <td className="table-cell">{row.insurer || '—'}</td>
              <td className="table-cell">{row.clientName || '—'}</td>
              <td className="table-cell font-mono">{row.policyNumber || '—'}</td>
              <td className="table-cell">{row.score}</td>
              <td className="table-cell">{row.method || '—'}</td>
              <td className="table-cell">{row.reason}</td>
            </tr>
          )}
        />
      </Section>

      <Section title="12. Data quality issues">
        {report.dataQuality.length === 0 ? <Note>{EMPTY}</Note> : (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-200">
            {report.dataQuality.map(issue => <li key={issue}>{issue}</li>)}
          </ul>
        )}
      </Section>
    </div>
  )
}

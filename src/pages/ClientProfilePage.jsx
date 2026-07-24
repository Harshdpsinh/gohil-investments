// src/pages/ClientProfilePage.jsx
// ✅ FIXED: CP1 (Edit button navigates with state to open edit modal),
//           CP2 (coverage gaps only from active policies),
//           CP3 (graceful handling of doc fetch errors)
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getClient, getAllClaims } from '../firebase/firestore'
import { usePolicies } from '../hooks/usePolicies'
import { useClients } from '../hooks/useClients'
import { fmtDate, fmtCurrency, daysUntil, getDueDate as getPolicyDueDate } from '../utils/dateUtils'
import { computeCoverageGaps } from '../utils/policySchemas'
import { getDocMeta } from '../firebase/firestore'
import { openDocumentPreview, downloadDocumentFile } from '../firebase/storage'
import { openWhatsAppLink } from '../services/whatsappService'
import AppIcon from '../components/ui/AppIcon'
import toast from 'react-hot-toast'

const CLAIM_STATUS_COLORS = {
  'Intimated':           'badge-gray',
  'Documents Submitted': 'badge-blue',
  'Under Review':        'badge-yellow',
  'Approved':            'badge-green',
  'Settled':             'badge-green',
  'Rejected':            'badge-red',
}

function policyHistoryStatus(policy) {
  const status = String(policy?.status || 'Active').trim()
  if (status === 'Renewed-Out' || policy?.is_renewed) {
    return { label: 'Renewed', cls: 'badge-blue' }
  }
  if (status === 'Cancelled' || status === 'Matured') {
    return { label: status, cls: 'badge-gray' }
  }
  const expiry = new Date(policy?.expiryDate || '')
  if (!Number.isNaN(expiry.getTime()) && expiry < new Date()) {
    return { label: 'Expired', cls: 'badge-red' }
  }
  return { label: 'Active', cls: 'badge-green' }
}

function Section({ title, icon, children, badge }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-200"><AppIcon name={icon} size={18} /></span>
        <h2 className="text-base font-bold text-gray-800 dark:text-white">{title}</h2>
        {badge > 0 && (
          <span className="ml-auto bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-xs font-bold px-2 py-0.5 rounded-full">{badge}</span>
        )}
      </div>
      {children}
    </div>
  )
}

export default function ClientProfilePage() {
  const { id }    = useParams()
  const navigate  = useNavigate()
  const { policies } = usePolicies()
  const { clients } = useClients()

  const [client,  setClient]  = useState(null)
  const [claims,  setClaims]  = useState([])
  const [docs,    setDocs]    = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    const load = async () => {
      try {
        const c = await getClient(id)
        if (!c) throw new Error('Client not found.')
        setClient(c)
        const [claimsResult, docsResult] = await Promise.allSettled([
          getAllClaims(),
          getDocMeta(id),
        ])
        setClaims(claimsResult.status === 'fulfilled' ? claimsResult.value.filter(cl => cl.clientId === id) : [])
        setDocs(docsResult.status === 'fulfilled' ? (docsResult.value || []) : [])
      } catch (err) {
        toast.error('Could not load profile: ' + err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  const clientPolicies = policies.filter(p => p.clientId === id)
  const policyDocuments = clientPolicies
    .filter(p => p.policyPdfUrl)
    .map(p => ({
      id: `policy-${p.id}`,
      url: p.policyPdfUrl,
      name: p.policyPdfName || `${p.policyNumber || 'policy'} document.pdf`,
      policyNumber: p.policyNumber || 'Policy',
      policyType: p.policyType || 'Policy',
      insurer: p.insurer || '',
      year: p.policyPdfYear || p.policyYear || '',
      status: policyHistoryStatus(p),
    }))
  const familyKey = client?.familyId || client?.familyName || ''
  const familyMembers = familyKey
    ? clients.filter(c => (client.familyId && c.familyId === client.familyId) || (!client.familyId && c.familyName && c.familyName === client.familyName))
    : []
  const familyMemberIds = new Set(familyMembers.map(c => c.id))
  const familyPolicies = familyKey
    ? policies.filter(p => familyMemberIds.has(p.clientId))
    : []
  const isActv = p => !['Renewed-Out', 'Cancelled', 'Matured'].includes((p.status || '').trim())
  const activePolicies = clientPolicies.filter(p => isActv(p))

  // ✅ FIX CP2: compute coverage gaps only from ACTIVE policies
  const gaps           = computeCoverageGaps(activePolicies)
  const totalPremium   = activePolicies.reduce((s, p) => s + (parseFloat(p.premium) || 0), 0)
  const totalCoverage  = activePolicies.reduce((s, p) => s + (parseFloat(p.sumInsured || p.sumAssured || p.idv) || 0), 0)

  const openWhatsApp = () => {
    const mobile = (client?.mobile || '').replace(/\D/g, '')
    if (!mobile) {
      toast.error('No mobile number found for this client. Add it in Clients page.')
      return
    }
    const safeMsg =
      `Dear ${client.name},\n\n` +
      `Greetings from Gohil Investments!\n\n` +
      `This is a courtesy message regarding your insurance portfolio. Please feel free to reach out for any queries.\n\n` +
      `Thank you for your continued trust.\n\n` +
      `Gohil Investments\nWealth Management & Insurance Advisory\n` +
      `Harshdipsinh Gohil - 7698997894\n` +
      `Pradipsinh Gohil - 9426204547\nBhavnagar, Gujarat`
    try {
      openWhatsAppLink({ mobile: client?.mobile, message: safeMsg })
    } catch (err) {
      toast.error(err.message || 'Could not open WhatsApp.')
    }
  }

  if (loading) return (
    <div className="p-8 text-gray-400 dark:text-gray-500 flex items-center gap-2">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />Loading profile…
    </div>
  )

  if (!client) return (
    <div className="p-8 text-center">
      <p className="text-gray-500 dark:text-gray-400 mb-4">Client not found.</p>
      <button onClick={() => navigate('/clients')} className="btn-secondary">← Back to Clients</button>
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      {/* Back + header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <button onClick={() => navigate('/clients')}
                  className="mt-1 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
            <AppIcon name="chevronLeft" size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{client.name}</h1>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-sm text-gray-500 dark:text-gray-400">{client.mobile}</span>
              {client.email && <span className="text-sm text-gray-500 dark:text-gray-400">{client.email}</span>}
              <span className={`text-xs px-2 py-0.5 rounded-full font-semibold
                ${client.kycStatus === 'Complete' ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' :
                  client.kycStatus === 'In Progress' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200' :
                  'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'}`}>
                KYC: {client.kycStatus || 'Pending'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={openWhatsApp} className="btn-whatsapp"><AppIcon name="message" size={17} /> WhatsApp</button>
          {/* ✅ FIX CP1: navigate to /clients with state to open edit modal for this client */}
          <button
            onClick={() => navigate('/clients', { state: { editClientId: id } })}
            className="btn-secondary"
          >
            <AppIcon name="pencil" size={17} /> Edit Client
          </button>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { icon: 'policies', label: 'Active Policies', val: activePolicies.length, valueClass: 'text-blue-700 dark:text-blue-300' },
          { icon: 'rupee', label: 'Total Premium', val: fmtCurrency(totalPremium), valueClass: 'text-emerald-700 dark:text-emerald-300' },
          { icon: 'shield', label: 'Total Coverage', val: fmtCurrency(totalCoverage), valueClass: 'text-violet-700 dark:text-violet-300' },
          { icon: 'claims', label: 'Claims', val: claims.length, valueClass: 'text-orange-700 dark:text-orange-300' },
        ].map(({ icon, label, val, valueClass }) => (
          <div key={label} className="stat-card">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200"><AppIcon name={icon} size={20} /></span>
            <div>
              <p className={`text-xl font-bold ${valueClass}`}>{val}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Coverage gaps — ✅ FIX CP2: only from active policies now */}
      {gaps.length > 0 && (
        <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-xl p-4">
          <p className="text-sm font-bold text-orange-700 dark:text-orange-300 mb-2">🎯 Coverage Gaps — Cross-sell Opportunities</p>
          <div className="flex gap-2 flex-wrap">
            {gaps.map(g => (
              <span key={g.id} className={`text-xs px-3 py-1 rounded-full font-semibold ${g.color}`}>{g.label}</span>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Personal details */}
        <Section title="Personal Details" icon="client">
          <div className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['PAN',         client.pan],
              ['Aadhar',      client.aadhar],
              ['Date of Birth', fmtDate(client.dob)],
              ['Gender',      client.gender],
              ['Occupation',  client.occupation],
              ['Annual Income', client.income ? fmtCurrency(client.income) : null],
              ['City',        client.city],
              ['State',       client.state],
              ['Family',      client.familyName || client.familyId],
              ['Family Role', client.familyRole],
              ['Address',     client.address],
              ['Notes',       client.notes],
            ].filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className={k === 'Address' || k === 'Notes' ? 'col-span-2' : ''}>
                <p className="text-xs text-gray-400 dark:text-gray-500 font-medium">{k}</p>
                <p className="text-gray-800 dark:text-gray-200 font-medium text-sm">{v}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Documents */}
        <Section title="Documents" icon="folder" badge={docs.length + policyDocuments.length}>
          {docs.length === 0 && policyDocuments.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">No documents uploaded</p>
          ) : (
            <div className="space-y-2">
              {policyDocuments.map(d => (
                <div key={d.id} className="flex items-center justify-between gap-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-xs font-bold text-blue-700 dark:text-blue-300 flex-shrink-0">PDF</span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate">{d.name}</p>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{d.policyNumber} - {d.policyType} - {d.insurer} {d.year ? `- Year ${d.year}` : ''} - {d.status.label}</p>
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await openDocumentPreview(d.url, d.name)
                        } catch (err) {
                          toast.error(err.message)
                        }
                      }}
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                      View
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await downloadDocumentFile(d.url, d.name)
                        } catch (err) {
                          toast.error(err.message)
                        }
                      }}
                      className="text-xs text-gray-600 dark:text-gray-300 hover:text-blue-600">
                      Download
                    </button>
                  </div>
                </div>
              ))}
              {docs.map(d => (
                <div key={d.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="flex-shrink-0 text-slate-500"><AppIcon name={d.type?.includes('pdf') ? 'file' : 'folder'} size={18} /></span>
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{d.name}</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await openDocumentPreview(d.storagePath || d.url, d.name)
                      } catch (err) {
                        toast.error(err.message)
                      }
                    }}
                    className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0 ml-2">
                    View
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await downloadDocumentFile(d.storagePath || d.url, d.name)
                      } catch (err) {
                        toast.error(err.message)
                      }
                    }}
                    className="text-xs text-gray-600 dark:text-gray-300 hover:text-blue-600 flex-shrink-0 ml-2">
                    Download
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Policies */}
      <Section title="Policy History" icon="history" badge={clientPolicies.length}>
        {clientPolicies.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">No policies found</p>
        ) : (
          <div className="table-container">
            <table className="min-w-full">
              <thead><tr>
                {['Policy No', 'Type', 'Insurer', 'Plan', 'Premium', 'Sum Insured/Assured', 'Start', 'Premium Due', 'Expiry', 'Days', 'Status'].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr></thead>
              <tbody className="bg-white dark:bg-gray-800">
                {clientPolicies.map(p => {
                  const dueDate = getPolicyDueDate(p)
                  const coverage = p.sumInsured || p.sumAssured || p.idv || '—'
                  const history = policyHistoryStatus(p)
                  return (
                    <tr key={p.id} className={`table-row ${history.label === 'Renewed' ? 'opacity-60' : ''}`}>
                      <td className="table-cell font-mono text-xs font-semibold">{p.policyNumber}</td>
                      <td className="table-cell"><span className="badge-blue">{p.policyType}</span></td>
                      <td className="table-cell text-xs">{p.insurer}</td>
                      <td className="table-cell text-xs">{p.planName || '—'}</td>
                      <td className="table-cell font-semibold">{fmtCurrency(p.premium)}</td>
                      <td className="table-cell">{coverage !== '—' ? fmtCurrency(coverage) : '—'}</td>
                      <td className="table-cell text-xs">{fmtDate(p.startDate)}</td>
                      <td className="table-cell text-xs font-semibold text-blue-700 dark:text-blue-400">{fmtDate(dueDate)}</td>
                      <td className="table-cell text-xs">{fmtDate(p.expiryDate)}</td>
                      <td className="table-cell text-xs">{daysUntil(dueDate || p.expiryDate) !== null ? `${daysUntil(dueDate || p.expiryDate)}d` : '—'}</td>
                      <td className="table-cell"><span className={history.cls}>{history.label}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {familyKey && (
        <Section title="Family Policies" icon="users" badge={familyPolicies.length}>
          <div className="mb-3 flex flex-wrap gap-2 text-xs">
            {familyMembers.map(member => (
              <span key={member.id} className={`px-2 py-1 rounded-full font-semibold ${member.id === id ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                {member.name}{member.familyRole ? ` - ${member.familyRole}` : ''}
              </span>
            ))}
          </div>
          {familyPolicies.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">No family policies found</p>
          ) : (
            <div className="space-y-2">
              {familyPolicies.map(p => {
                const owner = clients.find(c => c.id === p.clientId)
                const history = policyHistoryStatus(p)
                return (
                  <div key={p.id} className="flex items-center justify-between gap-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2 text-xs">
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-gray-200">{owner?.name || p.clientName || 'Family member'}</p>
                      <p className="font-mono text-gray-500 dark:text-gray-400">{p.policyNumber} - {p.policyType || 'Policy'} - {p.insurer || 'Insurer'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-blue-700 dark:text-blue-400">{fmtDate(getPolicyDueDate(p))}</p>
                      <span className={history.cls}>{history.label}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Section>
      )}

      {/* Claims */}
      <Section title="Claims" icon="claims" badge={claims.length}>
        {claims.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">No claims on record</p>
        ) : (
          <div className="space-y-2">
            {claims.map(c => (
              <div key={c.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2">
                <div>
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{c.claimNumber || '—'} · {c.claimType}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{c.insurer} · {fmtDate(c.intimationDate)}</p>
                </div>
                <div className="text-right">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${CLAIM_STATUS_COLORS[c.status] || 'badge-gray'}`}>{c.status}</span>
                  {c.claimedAmount && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">₹{Number(c.claimedAmount).toLocaleString('en-IN')}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

    </div>
  )
}



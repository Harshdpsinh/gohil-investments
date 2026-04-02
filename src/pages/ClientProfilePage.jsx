// src/pages/ClientProfilePage.jsx
// ✅ FIXED: CP1 (Edit button navigates with state to open edit modal),
//           CP2 (coverage gaps only from active policies),
//           CP3 (graceful handling of doc fetch errors)
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getClient, getAllClaims, getAllTasks } from '../firebase/firestore'
import { usePolicies } from '../hooks/usePolicies'
import { fmtDate, fmtCurrency, daysUntil, renewalStatus } from '../utils/dateUtils'
import { computeCoverageGaps } from '../utils/policySchemas'
import { getDocMeta } from '../firebase/firestore'
import toast from 'react-hot-toast'

const CLAIM_STATUS_COLORS = {
  'Intimated':           'badge-gray',
  'Documents Submitted': 'badge-blue',
  'Under Review':        'badge-yellow',
  'Approved':            'badge-green',
  'Settled':             'badge-green',
  'Rejected':            'badge-red',
}

function Section({ title, icon, children, badge }) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xl">{icon}</span>
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

  const [client,  setClient]  = useState(null)
  const [claims,  setClaims]  = useState([])
  const [tasks,   setTasks]   = useState([])
  const [docs,    setDocs]    = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    const load = async () => {
      try {
        // ✅ FIX CP3: split Promise.all so a doc fetch failure doesn't blank the whole profile
        const [c, allClaims, allTasks] = await Promise.all([
          getClient(id),
          getAllClaims(),
          getAllTasks(),
        ])
        setClient(c)
        setClaims(allClaims.filter(cl => cl.clientId === id))
        setTasks(allTasks.filter(t => t.clientId === id))

        // Load docs separately — failure doesn't crash the profile
        try {
          const clientDocs = await getDocMeta(id)
          setDocs(clientDocs || [])
        } catch (docErr) {
          console.warn('Could not load documents:', docErr.message)
          setDocs([])
        }
      } catch (err) {
        toast.error('Could not load profile: ' + err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [id])

  const clientPolicies = policies.filter(p => p.clientId === id)
  const isActv = p => !['Renewed-Out', 'Cancelled', 'Matured'].includes((p.status || '').trim())
  const activePolicies = clientPolicies.filter(p => isActv(p))

  // ✅ FIX CP2: compute coverage gaps only from ACTIVE policies
  const gaps           = computeCoverageGaps(activePolicies)
  const totalPremium   = activePolicies.reduce((s, p) => s + (parseFloat(p.premium) || 0), 0)
  const totalCoverage  = activePolicies.reduce((s, p) => s + (parseFloat(p.sumInsured || p.sumAssured || p.idv) || 0), 0)

  const openWhatsApp = () => {
    const mobile = (client?.mobile || '').replace(/\D/g, '')
    if (!mobile) { toast.error('No mobile number — add it in Clients page'); return }
    const msg = encodeURIComponent(`Dear ${client.name},\n\nGreetings from *Gohil Investments*!\n\nThis is a courtesy call regarding your insurance portfolio. Please feel free to reach out for any queries.\n\nThank you for your continued trust.\n\n*Gohil Investments*\nWealth Management & Insurance Advisory\n📞 *Harshdipsinh Gohil* — 7698997894\n📞 Pradipsinh Gohil — 9426204547\n📍 Bhavnagar, Gujarat`)
    window.open(`https://wa.me/91${mobile}?text=${msg}`, '_blank')
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
            ← 
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
          <button onClick={openWhatsApp} className="btn-whatsapp">📱 WhatsApp</button>
          {/* ✅ FIX CP1: navigate to /clients with state to open edit modal for this client */}
          <button
            onClick={() => navigate('/clients', { state: { editClientId: id } })}
            className="btn-secondary"
          >
            ✏️ Edit Client
          </button>
        </div>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: '📋', label: 'Active Policies', val: activePolicies.length, color: 'blue'   },
          { icon: '💰', label: 'Total Premium',   val: fmtCurrency(totalPremium), color: 'green'  },
          { icon: '🛡️', label: 'Total Coverage',  val: fmtCurrency(totalCoverage), color: 'purple' },
          { icon: '🔍', label: 'Claims',           val: claims.length,          color: 'orange' },
        ].map(({ icon, label, val, color }) => (
          <div key={label} className="stat-card">
            <span className="text-2xl">{icon}</span>
            <div>
              <p className={`text-xl font-bold text-${color}-600 dark:text-${color}-400`}>{val}</p>
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
        <Section title="Personal Details" icon="👤">
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
        <Section title="Documents" icon="📎" badge={docs.length}>
          {docs.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500">No documents uploaded</p>
          ) : (
            <div className="space-y-2">
              {docs.map(d => (
                <div key={d.id} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-lg flex-shrink-0">{d.type?.includes('pdf') ? '📄' : '🖼️'}</span>
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{d.name}</p>
                  </div>
                  <a href={d.url} target="_blank" rel="noreferrer"
                     className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0 ml-2">View</a>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* Policies */}
      <Section title="Policies" icon="📋" badge={clientPolicies.length}>
        {clientPolicies.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500">No policies found</p>
        ) : (
          <div className="table-container">
            <table className="min-w-full">
              <thead><tr>
                {['Policy No', 'Type', 'Insurer', 'Plan', 'Premium', 'Sum Insured/Assured', 'Start', 'Expiry', 'Days', 'Status'].map(h => (
                  <th key={h} className="table-header">{h}</th>
                ))}
              </tr></thead>
              <tbody className="bg-white dark:bg-gray-800">
                {clientPolicies.map(p => {
                  const st = renewalStatus(p.expiryDate)
                  const coverage = p.sumInsured || p.sumAssured || p.idv || '—'
                  const bm = { green: 'badge-green', yellow: 'badge-yellow', red: 'badge-red', blue: 'badge-blue', gray: 'badge-gray' }
                  return (
                    <tr key={p.id} className={`table-row ${(p.status || '') === 'Renewed-Out' ? 'opacity-50' : ''}`}>
                      <td className="table-cell font-mono text-xs font-semibold">{p.policyNumber}</td>
                      <td className="table-cell"><span className="badge-blue">{p.policyType}</span></td>
                      <td className="table-cell text-xs">{p.insurer}</td>
                      <td className="table-cell text-xs">{p.planName || '—'}</td>
                      <td className="table-cell font-semibold">{fmtCurrency(p.premium)}</td>
                      <td className="table-cell">{coverage !== '—' ? fmtCurrency(coverage) : '—'}</td>
                      <td className="table-cell text-xs">{fmtDate(p.startDate)}</td>
                      <td className="table-cell text-xs">{fmtDate(p.expiryDate)}</td>
                      <td className="table-cell text-xs">{daysUntil(p.expiryDate) !== null ? `${daysUntil(p.expiryDate)}d` : '—'}</td>
                      <td className="table-cell">
                        {(p.status || '') === 'Renewed-Out'
                          ? <span className="badge-gray">Renewed</span>
                          : <span className={bm[st.color] || 'badge-gray'}>{st.label}</span>
                        }
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Claims */}
      <Section title="Claims" icon="🔍" badge={claims.length}>
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

      {/* Tasks */}
      {tasks.length > 0 && (
        <Section title="Pending Tasks" icon="✅" badge={tasks.filter(t => !t.done).length}>
          <div className="space-y-2">
            {tasks.filter(t => !t.done).map(t => (
              <div key={t.id} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2">
                <span className="text-lg">{t.type === 'Call' ? '📞' : t.type === 'Email' ? '📧' : t.type === 'Meeting' ? '🤝' : '📌'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{t.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Due: {fmtDate(t.dueDate)}</p>
                </div>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0
                  ${t.priority === 'High' ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300' :
                    t.priority === 'Medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200' :
                    'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>
                  {t.priority}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

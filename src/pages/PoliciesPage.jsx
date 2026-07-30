// src/pages/PoliciesPage.jsx
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { useClients }  from '../hooks/useClients'
import { usePolicies } from '../hooks/usePolicies'
import { useAuth }     from '../hooks/useAuth'
import {
  addPolicy, updatePolicy, deletePolicy, bulkDeletePolicies,
  getDeletedPolicies, restorePolicy, permanentDeletePolicy,
  subscribeProposals, updateProposal, updateLead,
} from '../firebase/firestore'
import { deletePolicyPdfAsset } from '../firebase/storage'
import Modal        from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import SearchBar    from '../components/ui/SearchBar'
import AppIcon      from '../components/ui/AppIcon'
import { fmtDate, fmtCurrency, daysUntil, getDueDate as getPolicyDueDate, renewalStatus } from '../utils/dateUtils'
import { exportToCSV, exportToExcel, exportToPDF, POLICY_COLS } from '../utils/exportUtils'
import {
  TYPES, POLICY_PAGE_SIZE, policyDocumentYear,
  proposalToPolicyInitial, leadToPolicyInitial,
} from '../utils/policyImport'
import { openWhatsAppApiLink, openWhatsAppLink } from '../services/whatsappService'
import toast from 'react-hot-toast'
import ImportModal from '../components/policies/ImportModals'
import PolicyForm from '../components/policies/PolicyForm'
import PolicyPdfUpload from '../components/policies/PolicyPdfUpload'



// ── Recycle Bin Modal ─────────────────────────────────────────
function RecycleBinModal({ onClose, fmtDate, fmtCurrency }) {
  const [deleted,    setDeleted]    = useState([])
  const [loading,    setLoading]    = useState(true)
  const [restoring,  setRestoring]  = useState(null)   // id being restored
  const [permDel,    setPermDel]    = useState(null)   // id staged for permanent delete
  const [permDeling, setPermDeling] = useState(false)
  const [emptying,   setEmptying]   = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const rows = await getDeletedPolicies()
      // Sort most recently deleted first
      rows.sort((a, b) => {
        const da = a.deletedAt?.toDate?.() || new Date(a.deletedAt || 0)
        const db_ = b.deletedAt?.toDate?.() || new Date(b.deletedAt || 0)
        return db_ - da
      })
      setDeleted(rows)
    } catch(err) {
      toast.error('Could not load recycle bin: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const onRestore = async (id) => {
    setRestoring(id)
    try {
      await restorePolicy(id)
      toast.success('✅ Policy restored!')
      setDeleted(prev => prev.filter(p => p.id !== id))
    } catch(err) {
      toast.error('Restore failed: ' + err.message)
    } finally {
      setRestoring(null)
    }
  }

  const onPermanentDelete = async () => {
    if (!permDel) return
    setPermDeling(true)
    try {
      const policy = deleted.find(p => p.id === permDel)
      await deletePolicyPdfAsset({
        storagePath: policy?.policyPdfStoragePath,
        storageBucket: policy?.policyPdfStorageBucket,
        storageProvider: policy?.policyPdfStorageProvider,
        publicId: policy?.policyPdfPublicId,
        resourceType: policy?.policyPdfResourceType,
        deleteToken: policy?.policyPdfDeleteToken,
      })
      await permanentDeletePolicy(permDel)
      toast.success('Policy permanently deleted')
      setDeleted(prev => prev.filter(p => p.id !== permDel))
      setPermDel(null)
    } catch(err) {
      toast.error('Failed: ' + err.message)
    } finally {
      setPermDeling(false)
    }
  }

  const onEmptyRecycleBin = async () => {
    if (deleted.length === 0) return
    if (!window.confirm(`Permanently delete ${deleted.length} old deleted polic${deleted.length === 1 ? 'y' : 'ies'}? This cannot be undone.`)) return
    setEmptying(true)
    try {
      await Promise.all(deleted.map(async p => {
        await deletePolicyPdfAsset({
          storagePath: p.policyPdfStoragePath,
          storageBucket: p.policyPdfStorageBucket,
          storageProvider: p.policyPdfStorageProvider,
          publicId: p.policyPdfPublicId,
          resourceType: p.policyPdfResourceType,
          deleteToken: p.policyPdfDeleteToken,
        })
        await permanentDeletePolicy(p.id)
      }))
      toast.success('Recycle bin emptied')
      setDeleted([])
    } catch(err) {
      toast.error('Could not empty recycle bin: ' + (err.message || 'Unknown error'))
    } finally {
      setEmptying(false)
    }
  }

  const fmtDeletedAt = (ts) => {
    if (!ts) return '—'
    try {
      const d = ts.toDate ? ts.toDate() : new Date(ts)
      return `${fmtDate(d)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
    } catch { return '—' }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">🗑️ Recycle Bin — Deleted Policies</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Restore accidentally deleted policies or permanently remove them.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {deleted.length > 0 && (
              <button
                type="button"
                onClick={onEmptyRecycleBin}
                disabled={emptying}
                className="px-3 py-1.5 text-xs font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-60"
              >
                {emptying ? 'Deleting...' : 'Empty Recycle Bin'}
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">?</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center gap-2 text-gray-400 py-8 justify-center">
              <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              Loading deleted policies…
            </div>
          ) : deleted.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">✅</p>
              <p className="font-semibold text-gray-700 dark:text-gray-300">Recycle bin is empty</p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">No deleted policies found.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {deleted.map(p => (
                <div key={p.id}
                     className="flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
                  <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-5 gap-x-4 gap-y-0.5 text-sm">
                    <div className="sm:col-span-2">
                      <p className="font-semibold text-gray-800 dark:text-gray-200 truncate">{p.clientName || '—'}</p>
                      <p className="text-xs font-mono text-gray-500 dark:text-gray-400">{p.policyNumber}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Insurer</p>
                      <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{p.insurer || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Premium</p>
                      <p className="text-xs font-medium text-blue-600 dark:text-blue-400">{fmtCurrency(p.premium)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Deleted on</p>
                      <p className="text-xs font-medium text-red-600 dark:text-red-400">{fmtDeletedAt(p.deletedAt)}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => onRestore(p.id)}
                      disabled={restoring === p.id}
                      className="px-3 py-1.5 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      {restoring === p.id ? '⏳' : '♻️ Restore'}
                    </button>
                    <button
                      onClick={() => setPermDel(p.id)}
                      className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-lg transition-colors"
                    >
                      🗑️ Delete Forever
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Permanent delete confirmation */}
        {permDel && (
          <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/40" onClick={() => setPermDel(null)} />
            <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
              <h4 className="text-base font-bold text-gray-900 dark:text-white">⚠️ Permanent Delete</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                This will <strong>permanently delete</strong> the policy from Firestore. This <strong>cannot be undone</strong>.
              </p>
              <div className="flex gap-3">
                <button type="button" onClick={onPermanentDelete} disabled={permDeling}
                        className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg">
                  {permDeling ? '⏳ Deleting…' : '🗑️ Yes, Delete Forever'}
                </button>
                <button type="button" onClick={() => setPermDel(null)} className="btn-secondary">Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function PoliciesPage() {
  const { clients }           = useClients()
  const { policies, loading } = usePolicies()
  const { isAdmin }           = useAuth()
  const location              = useLocation()
  const [search,      setSearch]      = useState('')
  const [typeFilter,  setTypeFilter]  = useState('All')
  const [modal,       setModal]       = useState(null)
  const [selected,    setSelected]    = useState(null)
  const [delOpen,     setDelOpen]     = useState(false)
  // Bulk delete
  const [selectedIds,  setSelectedIds]  = useState(new Set())
  const [bulkDelOpen,  setBulkDelOpen]  = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showRecycleBin, setShowRecycleBin] = useState(false)
  const [showRenewed,    setShowRenewed]    = useState(false)
  const [whatsAppMenu,   setWhatsAppMenu]   = useState(null)
  const [proposals,      setProposals]      = useState([])
  const [proposalPrefill,setProposalPrefill]= useState(null)
  const [page,           setPage]           = useState(1)
  const consumedProposalRef = useRef(null)
  const tableScrollRef = useRef(null)
  const topScrollRef   = useRef(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return policies.filter(p => {
      if (!showRenewed && (p.status || '').trim() === 'Renewed-Out') return false
      const mQ = !q||p.policyNumber?.toLowerCase().includes(q)||p.clientName?.toLowerCase().includes(q)||p.insurer?.toLowerCase().includes(q)||p.planName?.toLowerCase().includes(q)||p.registrationNo?.toLowerCase().includes(q)
      const mT = typeFilter==='All'||p.policyType===typeFilter
      return mQ && mT
    })
  }, [policies, search, typeFilter, showRenewed])

  // ── Duplicate detector ───────────────────────────────────────
  // Detects true duplicates across ALL policies (not just filtered).
  // Same client can legitimately hold multiple policies with the same insurer/type,
  // so we only flag exact policy-number duplicates and exact motor registration duplicates.
  const [showDupsOnly, setShowDupsOnly] = useState(false)

  const duplicatePolicyIds = useMemo(() => {
    const dupIds = new Set()

    // 1. Group by normalised policy number
    const byPolicyNo = {}
    policies.forEach(p => {
      const key = (p.policyNumber || '').trim().toLowerCase()
      if (!key) return
      if (!byPolicyNo[key]) byPolicyNo[key] = []
      byPolicyNo[key].push(p.id)
    })
    Object.values(byPolicyNo).forEach(ids => {
      if (ids.length > 1) ids.forEach(id => dupIds.add(id))
    })

    // 2. Group by motor registration number
    const byRegistration = {}
    policies.forEach(p => {
      const key = (p.registrationNo || '').trim().toLowerCase()
      if (!key) return
      if (!byRegistration[key]) byRegistration[key] = []
      byRegistration[key].push(p.id)
    })
    Object.values(byRegistration).forEach(ids => {
      if (ids.length > 1) ids.forEach(id => dupIds.add(id))
    })

    return dupIds
  }, [policies])

  const dupCount = useMemo(
    () => filtered.filter(p => duplicatePolicyIds.has(p.id)).length,
    [filtered, duplicatePolicyIds]
  )

  const displayPolicies = useMemo(
    () => showDupsOnly ? filtered.filter(p => duplicatePolicyIds.has(p.id)) : filtered,
    [filtered, showDupsOnly, duplicatePolicyIds]
  )

  useEffect(() => { setPage(1) }, [search, typeFilter, showRenewed, showDupsOnly])

  const totalPages = Math.max(1, Math.ceil(displayPolicies.length / POLICY_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedPolicies = useMemo(
    () => displayPolicies.slice((safePage - 1) * POLICY_PAGE_SIZE, safePage * POLICY_PAGE_SIZE),
    [displayPolicies, safePage]
  )
  useEffect(() => {
    if (page !== safePage) setPage(safePage)
  }, [page, safePage])

  useEffect(() => {
    const visibleIds = new Set(displayPolicies.map(p => p.id))
    setSelectedIds(prev => {
      const next = new Set([...prev].filter(id => visibleIds.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [displayPolicies])

  // ── Duplicate detector ───────────────────────────────────
  const [dupWarning, setDupWarning] = useState('')

  useEffect(() => {
    const unsub = subscribeProposals(
      data => setProposals(data),
      err => toast.error('Could not load proposals for policy auto-fill: ' + (err.message || 'Unknown error'))
    )
    return () => unsub()
  }, [])

  useEffect(() => {
    const proposal = location.state?.proposalToPolicy
    if (!proposal?.id || consumedProposalRef.current === proposal.id) return
    consumedProposalRef.current = proposal.id
    setProposalPrefill(proposalToPolicyInitial(proposal, clients))
    setDupWarning('')
    resetDeleteState()
    setModal('add')
  }, [location.state, clients])

  useEffect(() => {
    const lead = location.state?.leadToPolicy
    const consumeKey = lead?.id ? `lead:${lead.id}` : ''
    if (!consumeKey || consumedProposalRef.current === consumeKey) return
    if (lead.clientId && !clients.some(client => client.id === lead.clientId)) return
    consumedProposalRef.current = consumeKey
    setProposalPrefill(leadToPolicyInitial(lead, clients))
    setDupWarning('')
    resetDeleteState()
    setModal('add')
  }, [location.state, clients])
  const checkDup = useCallback(async (policyNumber) => {
    setDupWarning('')
  }, [])

  // ── WhatsApp helper ──────────────────────────────────────
  const renewalAlertStyle = (policy) => {
    const dueIn = daysUntil(getPolicyDueDate(policy))
    if (dueIn === null) return undefined
    if (dueIn < 0) return { backgroundColor: '#fff1f2' }
    if (dueIn <= 7) return { backgroundColor: '#fefce8' }
    return undefined
  }

  const getPolicyClient = (policy) => {
    let client = clients.find(c => c.id === policy.clientId)
    if (!client?.mobile && policy.clientName) {
      client = clients.find(c => c.name.toLowerCase().trim() === (policy.clientName||'').toLowerCase().trim())
    }
    return client
  }

  const openWhatsApp = (policy) => {
    const client = getPolicyClient(policy)
    const mobile = client?.mobile?.replace(/\D/g,'')
    if (!mobile) {
      toast.error('No mobile number on file for this client')
      return
    }
    const dueDate = fmtDate(getPolicyDueDate(policy))
    const expiry  = fmtDate(policy.expiryDate)
    const premium = policy.premium ? fmtCurrency(policy.premium) : ''
    const safeMsg =
      `Dear ${policy.clientName},\n\n` +
      `Your ${policy.policyType || 'Insurance'} policy (${policy.insurer || 'Insurer'} - ${policy.planName || ''}) is due for renewal.\n\n` +
      `Policy No: ${policy.policyNumber}\n` +
      `Premium Due / Renewal Date: ${dueDate}\n` +
      `Policy End / Expiry Date: ${expiry}\n` +
      `Premium: ${premium}\n\n` +
      `Kindly arrange for renewal at the earliest to avoid any lapse in coverage.\n\n` +
      `For any query, please call or WhatsApp us.\n\n` +
      `Gohil Investments\nWealth Management & Insurance Advisory\n` +
      `Harshdipsinh Gohil - 7698997894\n` +
      `Pradipsinh Gohil - 9426204547\nBhavnagar, Gujarat`
    try {
      openWhatsAppLink({ mobile: client?.mobile, message: safeMsg })
    } catch (err) {
      toast.error(err.message || 'Could not open WhatsApp.')
    }
  }

  const openWhatsAppTemplate = (policy, template) => {
    const client = getPolicyClient(policy)
    const dueDate = fmtDate(getPolicyDueDate(policy))
    const templates = {
      renewal: `Dear Client, your premium for policy ${policy.policyNumber || ''} is due on ${dueDate}. Kindly process to ensure continuous coverage.`,
      welcome: `Dear Client, thank you for choosing us. Your policy document for ${policy.policyNumber || ''} has been successfully registered in our CRM.`,
    }
    try {
      openWhatsAppApiLink({ mobile: client?.mobile, message: templates[template] || templates.renewal })
      setWhatsAppMenu(null)
    } catch (err) {
      toast.error(err.message || 'Could not open WhatsApp.')
    }
  }

  // ── Bulk select ──────────────────────────────────────────
  const allVisibleIds  = pagedPolicies.map(p => p.id)
  const allSelected    = allVisibleIds.length > 0 && allVisibleIds.every(id => selectedIds.has(id))
  const someSelected   = allVisibleIds.some(id => selectedIds.has(id))
  const toggleOne  = id => setSelectedIds(prev => { const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n })
  const toggleAll  = () => {
    if (allSelected) setSelectedIds(prev => { const n=new Set(prev); allVisibleIds.forEach(id=>n.delete(id)); return n })
    else             setSelectedIds(prev => { const n=new Set(prev); allVisibleIds.forEach(id=>n.add(id)); return n })
  }
  const clearSel = () => setSelectedIds(new Set())

  const toggleRenewedVisibility = () => {
    setDelOpen(false)
    setBulkDelOpen(false)
    setSelected(null)
    clearSel()
    setShowRenewed(v => !v)
  }

  const resetDeleteState = () => {
    setDelOpen(false)
    setBulkDelOpen(false)
    setSelected(null)
    clearSel()
  }

  const onBulkDelete = async () => {
    if (selectedIds.size === 0) return
    const ids = [...selectedIds]
    setBulkDeleting(true)
    try {
      const count = ids.length
      await bulkDeletePolicies(ids)
      toast.success(`${count} policies moved to Recycle Bin`)
      clearSel()
      setBulkDelOpen(false)
    }
    catch(err) { toast.error('Failed to delete selected policies: ' + (err.message || 'Unknown error')) }
    finally { setBulkDeleting(false) }
  }

  const onAdd    = async form => {
    try {
      await addPolicy(form)
      if (form.proposalId) {
        await updateProposal(form.proposalId, {
          status: 'Converted',
          convertedPolicyNumber: form.policyNumber || '',
          convertedAt: new Date().toISOString(),
        })
      }
      if (form.leadId) {
        await updateLead(form.leadId, {
          status: 'converted',
          convertedPolicyNumber: form.policyNumber || '',
          convertedAt: new Date().toISOString(),
        })
      }
      toast.success('Policy added!')
      setModal(null)
      setProposalPrefill(null)
    } catch(err) {
      toast.error('Failed to add policy: ' + (err.message || 'Unknown error'))
    }
  }
  const onEdit   = async form => {
    try {
      await updatePolicy(selected.id, form)
      toast.success('Policy updated!')
      setModal(null)
    } catch(err) {
      toast.error('Failed to update policy: ' + (err.message || 'Unknown error'))
    }
  }
  const onDelete = async () => {
    if (!selected?.id) {
      toast.error('Please select a policy to delete.')
      setDelOpen(false)
      return
    }
    try {
      await deletePolicy(selected.id)
      toast.success('Policy moved to Recycle Bin')
      setDelOpen(false)
      setSelected(null)
      clearSel()
    } catch(err) {
      toast.error('Failed to delete: ' + (err.message || 'Unknown error'))
    }
  }

  if (loading) return (
    <div className="p-8 text-gray-400 dark:text-gray-500 flex items-center gap-2">
      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />Loading policies…
    </div>
  )

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><AppIcon name="policies" size={24} /> Policies</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{policies.length} total</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button type="button" className="btn-secondary" onClick={()=>{resetDeleteState();setModal('import')}}><AppIcon name="upload" size={17} /> Import</button>
          {isAdmin && <button type="button" className="btn-secondary text-red-600 dark:text-red-400" onClick={()=>{resetDeleteState();setShowRecycleBin(true)}}><AppIcon name="trash" size={17} /> Recycle Bin</button>}
          <button
            type="button"
            onClick={toggleRenewedVisibility}
            className={`btn-secondary text-xs ${showRenewed ? 'ring-2 ring-blue-400 text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}
            title="Renewed-Out policies are hidden by default"
          ><AppIcon name="renewals" size={17} /> {showRenewed ? 'Hide Renewed' : 'Show Renewed'}</button>
          <button type="button" className="btn-primary" onClick={()=>{resetDeleteState();setDupWarning('');setProposalPrefill(null);setModal('add')}}><AppIcon name="plus" size={17} /> Add Policy</button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 flex-wrap items-start sm:items-center">
        <SearchBar value={search} onChange={setSearch} placeholder="Policy No, client, insurer…" />
        <div className="flex gap-1 flex-wrap">
          {['All',...TYPES].map(t=>(
            <button key={t} onClick={()=>setTypeFilter(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${typeFilter===t?'bg-blue-600 text-white':'bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}`}>{t}</button>
          ))}
          {dupCount > 0 && (
            <button
              onClick={() => setShowDupsOnly(v => !v)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors border ${
                showDupsOnly
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-orange-50 dark:bg-orange-900/30 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300 hover:bg-orange-100'
              }`}
            >
              🔁 Duplicates ({dupCount})
            </button>
          )}
        </div>
        <div className="flex gap-2 ml-auto flex-wrap">
          <button onClick={()=>exportToCSV(filtered,POLICY_COLS,'policies')} className="btn-secondary text-xs"><AppIcon name="download" size={15} /> CSV</button>
          <button onClick={()=>exportToExcel(filtered,POLICY_COLS,'Policies','policies')} className="btn-secondary text-xs"><AppIcon name="spreadsheet" size={15} /> Excel</button>
          <button onClick={async()=>await exportToPDF(filtered,POLICY_COLS,'Policy List','policies')} className="btn-secondary text-xs"><AppIcon name="file" size={15} /> PDF</button>
        </div>
      </div>
      {/* Duplicate warning */}
      {dupWarning && (
        <div className="bg-orange-50 dark:bg-orange-900/30 border border-orange-300 rounded-xl px-4 py-3 text-sm text-orange-700 dark:text-orange-300 font-semibold">
          {dupWarning}
        </div>
      )}
      {/* Bulk delete bar */}
      {isAdmin && someSelected && (
        <div className="flex items-center gap-3 bg-red-50 dark:bg-red-900/30 border border-red-200 rounded-xl px-4 py-3">
          <span className="text-sm font-semibold text-red-700 dark:text-red-300">{selectedIds.size} policies selected</span>
          <button type="button" onClick={() => setBulkDelOpen(true)} disabled={bulkDeleting}
                  className="px-4 py-1.5 bg-red-600 text-white text-xs font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
            {bulkDeleting ? 'Deleting...' : 'Delete Selected'}
          </button>
          <button type="button" onClick={clearSel} className="px-3 py-1.5 bg-white dark:bg-gray-700 border border-red-200 text-red-600 text-xs font-semibold rounded-lg">✕ Clear</button>
        </div>
      )}
      {displayPolicies.length > POLICY_PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-xs">
          <span className="text-gray-500 dark:text-gray-400">
            Showing {(safePage - 1) * POLICY_PAGE_SIZE + 1}-{Math.min(safePage * POLICY_PAGE_SIZE, displayPolicies.length)} of {displayPolicies.length} policies
          </span>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary text-xs" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</button>
            <span className="text-gray-600 dark:text-gray-300 font-semibold">Page {safePage} / {totalPages}</span>
            <button type="button" className="btn-secondary text-xs" disabled={safePage >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>Next</button>
          </div>
        </div>
      )}
      <div className="space-y-3 md:hidden">
        {pagedPolicies.length === 0 ? (
          <div className="gi-empty-state">No policies found</div>
        ) : pagedPolicies.map(p => {
          const isRenewedOut = (p.status || '').trim() === 'Renewed-Out'
          const isDup = duplicatePolicyIds.has(p.id)
          const dueDate = getPolicyDueDate(p)
          const linkedClient = getPolicyClient(p)
          const phone = p.clientMobile || linkedClient?.mobile || ''
          const st = isRenewedOut ? { label: 'Renewed', color: 'blue' } : renewalStatus(dueDate)
          const bm = { green:'badge-green', yellow:'badge-yellow', red:'badge-red', blue:'badge-blue', gray:'badge-gray' }
          return (
            <article key={p.id} className="gi-policy-card" style={renewalAlertStyle(p)}>
              <div className="gi-policy-card-header">
                <div className="flex min-w-0 items-center gap-2">
                  <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleOne(p.id)} className="h-5 w-5" />
                  <span className="badge-blue">{p.policyType}</span>
                </div>
                <span className={bm[st.color] || 'badge-gray'}>{st.label}</span>
              </div>
              <button type="button" onClick={() => { setSelected(p); setDupWarning(''); setModal('edit') }} className="gi-policy-card-name text-left">
                {p.clientName || 'Unnamed client'}
              </button>
              <p className="gi-policy-card-number">{p.policyNumber || 'No policy number'}</p>
              <div className="gi-policy-card-meta">
                <span>{p.insurer || 'No insurer'}</span>
                <strong>{fmtCurrency(p.premium)}</strong>
                <span>Due {fmtDate(dueDate)}</span>
                {phone && <span>{phone}</span>}
              </div>
              {isDup && <span className="badge-orange">Possible duplicate</span>}
              <div className="gi-policy-card-actions">
                <button type="button" onClick={() => { setSelected(p); setDupWarning(''); setModal('edit') }} className="btn-secondary">Edit</button>
                <button type="button" onClick={() => openWhatsApp(p)} className="btn-whatsapp">WhatsApp</button>
                <PolicyPdfUpload
                  compact policyId={p.id} policyType={p.policyType} documentYear={policyDocumentYear(p)}
                  existingUrl={p.policyPdfUrl} existingName={p.policyPdfName}
                  existingStoragePath={p.policyPdfStoragePath} existingStorageBucket={p.policyPdfStorageBucket}
                  existingStorageProvider={p.policyPdfStorageProvider} existingPublicId={p.policyPdfPublicId}
                  existingResourceType={p.policyPdfResourceType} existingDeleteToken={p.policyPdfDeleteToken}
                />
                {isAdmin && <button type="button" onClick={() => { setSelected(p); setDelOpen(true) }} className="btn-danger">Delete</button>}
              </div>
            </article>
          )
        })}
      </div>

      {/* Top scrollbar — mirrors the table's horizontal scroll so user
          doesn't have to scroll all the way to the bottom to see right columns */}
      <div
        ref={topScrollRef}
        style={{ overflowX: 'auto', overflowY: 'hidden', height: 14 }}
        onScroll={e => { if (tableScrollRef.current) tableScrollRef.current.scrollLeft = e.currentTarget.scrollLeft }}
        className="hidden rounded md:block"
      >
        <div style={{ height: 1, minWidth: 2200 }} />
      </div>
      <div
        ref={tableScrollRef}
        className="table-container hidden md:block"
        onScroll={e => { if (topScrollRef.current) topScrollRef.current.scrollLeft = e.currentTarget.scrollLeft }}
      >
        <table className="min-w-full" style={{ minWidth: 2200 }}>
          <thead><tr>
            <th className="table-header w-10">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4 cursor-pointer" />
            </th>
            {['Policy No','Client','Phone','Type','Insurer','Premium','Next Due','Expiry','Days','Yr','Status','FY%','RY%','Dup','WhatsApp','PDF'].map(h=>(
              <th key={h} className="table-header">{h}</th>
            ))}
          </tr></thead>
          <tbody className="bg-white dark:bg-gray-800">
            {displayPolicies.length===0
              ?<tr><td colSpan={17} className="text-center text-gray-400 dark:text-gray-500 py-10">No policies found</td></tr>
              :pagedPolicies.map(p=>{
                const isRenewedOut = (p.status||'').trim() === 'Renewed-Out'
                const isDup = duplicatePolicyIds.has(p.id)
                const dueDate = getPolicyDueDate(p)
                const linkedClient = getPolicyClient(p)
                const phone = p.clientMobile || linkedClient?.mobile || ''
                const st = isRenewedOut ? { label: 'Renewed', color: 'blue' } : renewalStatus(dueDate)
                const bm={green:'badge-green',yellow:'badge-yellow',red:'badge-red',blue:'badge-blue',gray:'badge-gray'}
                return(
                  <tr
                    key={p.id}
                    style={!selectedIds.has(p.id) && !isDup ? renewalAlertStyle(p) : undefined}
                    className={`table-row ${selectedIds.has(p.id)?'bg-blue-50 dark:bg-blue-900/20':''} ${isDup?'bg-orange-50 dark:bg-orange-900/10':''}`}>
                    <td className="table-cell">
                      <input type="checkbox" checked={selectedIds.has(p.id)} onChange={()=>toggleOne(p.id)} className="w-4 h-4 cursor-pointer" />
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold">{p.policyNumber}</span>
                        <button type="button" onClick={()=>{setSelected(p);setDupWarning('');setModal('edit')}} className="px-2 py-1 text-xs bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded hover:bg-blue-100">Edit</button>
                        {isAdmin&&<button type="button" onClick={()=>{setSelected(p);setDelOpen(true)}} className="px-2 py-1 text-xs bg-red-50 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded hover:bg-red-100">Del</button>}
                      </div>
                    </td>
                    <td className="table-cell font-medium">{p.clientName||'—'}</td>
                    <td className="table-cell text-xs text-gray-500 dark:text-gray-400">
                      {phone || <span className="text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="table-cell"><span className="badge-blue">{p.policyType}</span></td>
                    <td className="table-cell text-xs">{p.insurer}</td>
                    <td className="table-cell">{fmtCurrency(p.premium)}</td>
                    <td className="table-cell font-semibold text-blue-700 dark:text-blue-400 text-xs">
                      {fmtDate(dueDate)}
                    </td>
                    <td className="table-cell text-xs">{fmtDate(p.expiryDate)}</td>
                    <td className="table-cell">{daysUntil(dueDate)!==null?`${daysUntil(dueDate)}d`:'—'}</td>
                    <td className="table-cell text-xs text-center text-gray-500 dark:text-gray-400">{p.policyYear?`Y${p.policyYear}`:'Y1'}</td>
                    <td className="table-cell"><span className={bm[st.color]||'badge-gray'}>{st.label}</span></td>
                    <td className="table-cell text-xs text-center text-blue-600 dark:text-blue-400 font-semibold">{p.fyCommission?`${p.fyCommission}%`:'—'}</td>
                    <td className="table-cell text-xs text-center text-green-600 dark:text-green-400 font-semibold">{p.ryCommission?`${p.ryCommission}%`:'—'}</td>
                    <td className="table-cell text-center">
                      {p.clientReviewRequired ? <span className="px-2 py-0.5 text-xs font-bold bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300 rounded-full" title={p.clientReviewReason || 'Imported client details need manual review'}>Review</span> : isDup ? <span className="px-2 py-0.5 text-xs font-bold bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300 rounded-full" title="Possible duplicate policy">Dup</span>
                        : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                      }
                    </td>
                    <td className="table-cell text-center">
                      <div className="relative inline-flex items-center gap-1">
                        <button onClick={()=>openWhatsApp(p)} className="btn-whatsapp">📱 WA</button>
                        <button
                          type="button"
                          onClick={() => setWhatsAppMenu(whatsAppMenu === p.id ? null : p.id)}
                          className="px-2 py-1 text-xs rounded bg-green-50 text-green-700 hover:bg-green-100"
                          title="WhatsApp templates"
                        >
                          ▾
                        </button>
                        {whatsAppMenu === p.id && (
                          <div className="absolute right-0 top-full z-30 mt-1 w-44 rounded-lg border border-gray-200 bg-white shadow-lg">
                            <button type="button" onClick={() => openWhatsAppTemplate(p, 'renewal')} className="block w-full px-3 py-2 text-left text-xs hover:bg-gray-50">
                              Renewal Due
                            </button>
                            <button type="button" onClick={() => openWhatsAppTemplate(p, 'welcome')} className="block w-full px-3 py-2 text-left text-xs hover:bg-gray-50">
                              Welcome
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="table-cell text-center">
                      <PolicyPdfUpload
                        compact
                        policyId={p.id}
                        policyType={p.policyType}
                        documentYear={policyDocumentYear(p)}
                        existingUrl={p.policyPdfUrl}
                        existingName={p.policyPdfName}
                        existingStoragePath={p.policyPdfStoragePath}
                        existingStorageBucket={p.policyPdfStorageBucket}
                        existingStorageProvider={p.policyPdfStorageProvider}
                        existingPublicId={p.policyPdfPublicId}
                        existingResourceType={p.policyPdfResourceType}
                        existingDeleteToken={p.policyPdfDeleteToken}
                      />
                    </td>

                  </tr>
                )
              })
            }
          </tbody>
        </table>
      </div>
      <button type="button" className="gi-fab md:hidden" onClick={() => { resetDeleteState(); setDupWarning(''); setProposalPrefill(null); setModal('add') }} aria-label="Add policy">
        <span aria-hidden="true">+</span>
      </button>
      <Modal open={modal==='add'} onClose={()=>{setModal(null);setProposalPrefill(null)}} title="Add New Policy" size="xl">
        {proposals.length > 0 && (
          <div className="mb-4 p-3 rounded-lg border border-blue-100 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30">
            <label className="form-label">Auto-fill from proposal</label>
            <select
              className="form-select mt-1"
              value={proposalPrefill?.proposalId || ''}
              onChange={e => {
                const proposal = proposals.find(p => p.id === e.target.value)
                setProposalPrefill(proposal ? proposalToPolicyInitial(proposal, clients) : null)
                setDupWarning('')
              }}
            >
              <option value="">Manual policy entry</option>
              {proposals.map(p => (
                <option key={p.id} value={p.id}>
                  {(p.status === 'Converted' ? '[Converted] ' : '')}{p.proposerName || p.clientName || 'Proposal'} - {p.policyType || 'Policy'} - {p.insurer || 'No insurer'}
                </option>
              ))}
            </select>
          </div>
        )}
        <PolicyForm
          key={proposalPrefill?.proposalId || 'manual-policy'}
          initial={proposalPrefill || undefined}
          clients={clients}
          onSave={onAdd}
          onCancel={()=>{setModal(null);setProposalPrefill(null)}}
          onPolicyNumberChange={checkDup}
          dupWarning={dupWarning}
        />
      </Modal>
      <Modal open={modal==='edit'} onClose={()=>setModal(null)} title="Edit Policy" size="xl">
        {selected&&<PolicyForm initial={selected} clients={clients} onSave={onEdit} onCancel={()=>setModal(null)} onPolicyNumberChange={()=>{}} dupWarning="" />}
      </Modal>
      <Modal open={modal==='import'} onClose={()=>setModal(null)} title="📥 Import Policies — Choose Type" size="lg">
        <ImportModal clients={clients} onClose={()=>setModal(null)} onImported={()=>{}} />
      </Modal>
      <ConfirmDialog open={delOpen && !!selected?.id} onClose={()=>setDelOpen(false)} onConfirm={onDelete}
                     title="Delete Policy?" message={`Move "${selected?.policyNumber}" to the Recycle Bin? You can restore it later.`} danger />
      <ConfirmDialog open={bulkDelOpen && selectedIds.size > 0} onClose={()=>setBulkDelOpen(false)} onConfirm={onBulkDelete}
                     title={`Delete ${selectedIds.size} Policies?`}
                     message={`Move ${selectedIds.size} selected policies to the Recycle Bin? You can restore them later.`} danger />
      {showRecycleBin && (
        <RecycleBinModal
          onClose={() => setShowRecycleBin(false)}
          fmtDate={fmtDate}
          fmtCurrency={fmtCurrency}
        />
      )}
    </div>
  )
}



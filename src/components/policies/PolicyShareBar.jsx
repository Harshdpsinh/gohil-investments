import toast from 'react-hot-toast'
import { fmtCurrency } from '../../utils/dateUtils'
import { openDocumentPreview } from '../../firebase/storage'
import { displayPremiums } from '../../utils/opsSnapshot'

export default function PolicyShareBar({ policy, mobile, onWhatsApp }) {
  const phone = String(mobile || policy?.clientMobile || '').replace(/\D/g, '')
  const shown = displayPremiums(policy)
  const isMotor = String(policy?.policyType || '').toLowerCase() === 'motor'

  const call = () => {
    if (!phone) {
      toast.error('No mobile number on this client.')
      return
    }
    window.location.href = `tel:${phone}`
  }

  const openPdf = async () => {
    if (!policy?.policyPdfUrl) {
      toast.error('No policy PDF uploaded yet.')
      return
    }
    try {
      await openDocumentPreview(policy.policyPdfUrl, policy.policyPdfName || 'policy.pdf')
    } catch (err) {
      toast.error(err.message || 'Could not open PDF.')
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
        {shown.hasGross ? (
          <>
            <span><span className="font-semibold text-slate-500">Net</span> {fmtCurrency(shown.net)}</span>
            <span><span className="font-semibold text-slate-500">Gross</span> {fmtCurrency(shown.gross)}</span>
          </>
        ) : (
          <span className="font-bold text-slate-800 dark:text-slate-100">{fmtCurrency(shown.net)}</span>
        )}
        {shown.hasOd && <span className="text-slate-500">OD {fmtCurrency(shown.od)}</span>}
        {isMotor && shown.hasNcb && <span className="text-slate-500">NCB {shown.ncbPct}%</span>}
        {isMotor && shown.hasDiscount && <span className="text-slate-500">Disc {shown.discountPct}%</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary text-xs" onClick={call} disabled={!phone}>Call</button>
        <button type="button" className="btn-whatsapp text-xs" onClick={onWhatsApp}>WhatsApp</button>
        <button type="button" className="btn-secondary text-xs" onClick={openPdf} disabled={!policy?.policyPdfUrl}>PDF</button>
      </div>
    </div>
  )
}

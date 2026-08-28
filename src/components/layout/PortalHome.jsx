import { useNavigate } from 'react-router-dom'
import AppIcon from '../ui/AppIcon'
import GlobalSearch from '../layout/GlobalSearch'
import { useAuth } from '../../hooks/useAuth'
import { fmtCurrency } from '../../utils/dateUtils'

export default function PortalHome({ stats }) {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()

  return (
    <>
      <section className="portal-hero">
        <h1 className="portal-title">Welcome to Gohil Investments</h1>
        <p className="portal-subtitle">What do you want to do today?</p>
        <GlobalSearch />
        <div className="portal-shortcuts">
          <button type="button" className="portal-shortcut" onClick={() => navigate('/policies')}>
            <span className="portal-shortcut-icon"><AppIcon name="policies" size={22} /></span>
            <span>Update Policies</span>
          </button>
          <button type="button" className="portal-shortcut" onClick={() => navigate(isAdmin ? '/commission' : '/business')}>
            <span className="portal-shortcut-icon"><AppIcon name="commission" size={22} /></span>
            <span>Get Commission</span>
          </button>
          <button type="button" className="portal-shortcut" onClick={() => navigate('/claims')}>
            <span className="portal-shortcut-icon"><AppIcon name="claims" size={22} /></span>
            <span>Keep Claims</span>
          </button>
          <button type="button" className="portal-shortcut" onClick={() => navigate('/proposals')}>
            <span className="portal-shortcut-icon"><AppIcon name="proposals" size={22} /></span>
            <span>Plan Enrolment</span>
          </button>
        </div>
        <div className="portal-cta">
          <p>Check renewals, commission and clients in one place</p>
          <button type="button" className="btn-primary portal-cta-btn" onClick={() => navigate('/renewals')}>
            Open renewals
          </button>
        </div>
      </section>

      <div className="portal-section">
        <h3 className="portal-section-title">You can do more with this desk</h3>
        <div className="portal-service-grid">
          <button type="button" className="portal-service-card" onClick={() => navigate('/clients')}>
            <strong>Clients</strong>
            <span>{stats?.clients ?? 0} on book</span>
          </button>
          <button type="button" className="portal-service-card" onClick={() => navigate('/policies')}>
            <strong>Active policies</strong>
            <span>{stats?.active ?? 0} live</span>
          </button>
          <button type="button" className="portal-service-card" onClick={() => navigate('/renewals')}>
            <strong>Renewals</strong>
            <span>{stats?.expiring30 ?? 0} in 30 days</span>
          </button>
          <button type="button" className="portal-service-card" onClick={() => navigate('/business')}>
            <strong>Business done</strong>
            <span>{fmtCurrency(stats?.totalPremium || 0)}</span>
          </button>
        </div>
      </div>
    </>
  )
}

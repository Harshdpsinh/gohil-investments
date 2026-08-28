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

      {stats?.expiring30 > 0 && (
        <div className="portal-announce">
          <div>
            <strong>Keep policy details up to date.</strong>
            <span> {stats.expiring30} policies need renewal in 30 days.</span>
          </div>
          <button type="button" className="btn-secondary" onClick={() => navigate('/renewals')}>Visit now</button>
        </div>
      )}

      <div className="portal-panel-stack">
        <section className="portal-panel">
          <h3>Update book</h3>
          <p className="portal-panel-kicker">Keep client and policy details current</p>
          <p>Add a client, attach a policy PDF, or work the renewal list without leaving this desk.</p>
          <div className="portal-panel-links">
            <button type="button" onClick={() => navigate('/clients')}>Add client</button>
            <button type="button" onClick={() => navigate('/policies')}>Add policy from PDF</button>
            <button type="button" onClick={() => navigate('/renewals')}>Check renewal status</button>
            <button type="button" onClick={() => navigate('/installments')}>Installments</button>
          </div>
        </section>
        <section className="portal-panel">
          <h3>Desk services</h3>
          <p className="portal-panel-kicker">An array of services for this book</p>
          <p>Commission, claims, proposals and coverage gaps sit one click away.</p>
          <div className="portal-panel-links">
            <button type="button" onClick={() => navigate(isAdmin ? '/commission' : '/business')}>Commission / business</button>
            <button type="button" onClick={() => navigate('/claims')}>Claims</button>
            <button type="button" onClick={() => navigate('/proposals')}>Proposals</button>
            <button type="button" onClick={() => navigate('/cross-sell')}>Coverage gaps</button>
            <button type="button" onClick={() => navigate('/inbox')}>WhatsApp inbox</button>
          </div>
        </section>
      </div>

      <div className="portal-section">
        <h3 className="portal-section-title">Access services</h3>
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

      <div className="portal-helpband">
        <p>
          <strong>Need help with the desk?</strong>
          Harshdipsinh Gohil · 7698997894 · Pradipsinh Gohil · 9426204547
        </p>
        <button type="button" onClick={() => navigate('/inbox')}>Open inbox</button>
      </div>
    </>
  )
}

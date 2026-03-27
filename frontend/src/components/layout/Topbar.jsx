import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

export const Topbar = () => {
  const { logout, profile, role } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const titleMap = {
    '/dashboard': 'Overview',
    '/inbox': 'Inbox',
    '/contacts': 'Contacts',
    '/campaigns': 'Campaigns',
    '/followups': 'Followups',
    '/ai': 'AI Agent',
    '/analytics': 'Analytics',
    '/calendar': 'Calendar',
    '/billing': 'Billing',
    '/whatsapp': 'WhatsApp Numbers',
    '/status': 'Status',
    '/channels': 'Channels',
    '/groups': 'Groups',
    '/superadmin': 'Superadmin',
    '/affiliate': 'Affiliate',
  }

  const activeTitle =
    Object.entries(titleMap).find(([path]) => location.pathname.startsWith(path))?.[1] ||
    'Dashboard'

  return (
    <header id="topbar">
      <div>
        <div className="tb-title">{activeTitle}</div>
        <div className="tb-sub">Connected as {profile?.email || 'user'} · {role || 'tenant'}</div>
      </div>
      <div className="tb-spacer" />
      <div className="tb-search">
        <span role="img" aria-label="search">
          🔍
        </span>
        <input placeholder="Search anything..." />
      </div>
      <button className="tb-btn ghost" onClick={() => navigate('/inbox')}>
        Inbox
      </button>
      <button className="tb-btn primary" onClick={logout}>
        Logout
      </button>
      <div className="tb-avatar">{profile?.name?.[0]?.toUpperCase() || 'U'}</div>
    </header>
  )
}

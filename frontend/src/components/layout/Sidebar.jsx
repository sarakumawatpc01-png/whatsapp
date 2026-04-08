import { NavLink, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { useAuth } from '../../context/AuthContext'

const navItems = [
  { path: '/dashboard', label: 'Overview', icon: '📊' },
  { path: '/walkthrough', label: 'Walkthrough', icon: '🧭' },
  { path: '/inbox', label: 'Inbox', icon: '💬' },
  { path: '/contacts', label: 'Contacts', icon: '👥' },
  { path: '/campaigns', label: 'Campaigns', icon: '📣' },
  { path: '/followups', label: 'Followups', icon: '⏱️' },
  { path: '/ai', label: 'AI Agent', icon: '🤖' },
  { path: '/analytics', label: 'Analytics', icon: '📈' },
  { path: '/calendar', label: 'Calendar', icon: '📅' },
  { path: '/billing', label: 'Billing', icon: '💳' },
  { path: '/whatsapp', label: 'WA Numbers', icon: '📱' },
  { path: '/status', label: 'Status Posts', icon: '📰' },
  { path: '/channels', label: 'Channels', icon: '📢' },
  { path: '/groups', label: 'Groups', icon: '👪' },
  { path: '/harmonium', label: 'Harmonium', icon: '🎹' },
]

export const Sidebar = ({ onNavigate }) => {
  const { profile, role } = useAuth()
  const location = useLocation()

  const filteredNav =
    role === 'tenant' || !role
      ? navItems
      : role === 'superadmin'
        ? [{ path: '/superadmin', label: 'Superadmin', icon: '🛡️' }]
        : [{ path: '/affiliate', label: 'Affiliate', icon: '🤝' }]

  return (
    <aside id="sidebar">
      <div className="logo-wrap">
        <div className="logo-mark">WZ</div>
        <div>
          <div className="logo-name">
            WaizAI <span className="logo-tag">Beta</span>
          </div>
          <div className="biz-plan">Automation Cloud</div>
        </div>
      </div>

      <div className="nav-section">
        <div className="nav-group-label">Navigation</div>
        {filteredNav.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              clsx('nav-item', isActive && 'active')
            }
            onClick={onNavigate}
          >
            <span className="nav-ic">{item.icon}</span>
            <span>{item.label}</span>
            {location.pathname.startsWith(item.path) && (
              <span className="nav-badge green">•</span>
            )}
          </NavLink>
        ))}
      </div>

      <div className="sidebar-foot">
        <div className="sf-user">
          <div className="sf-av">{profile?.name?.[0]?.toUpperCase() || 'U'}</div>
          <div>
            <div className="sf-name">{profile?.name || 'User'}</div>
            <div className="sf-role">{role || 'tenant'}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}

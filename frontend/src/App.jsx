import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { AppLayout } from './components/layout/AppLayout'
import { useAuth } from './context/AuthContext'
import { AuthPage } from './pages/AuthPage'
import { DashboardPage } from './pages/Dashboard'
import { InboxPage } from './pages/Inbox'
import { ContactsPage } from './pages/Contacts'
import { CampaignsPage } from './pages/Campaigns'
import { FollowupsPage } from './pages/Followups'
import { AiPage } from './pages/Ai'
import { AnalyticsPage } from './pages/Analytics'
import { CalendarPage } from './pages/Calendar'
import { BillingPage } from './pages/Billing'
import { StatusPage } from './pages/Status'
import { ChannelsPage } from './pages/Channels'
import { GroupsPage } from './pages/Groups'
import { WhatsAppPage } from './pages/WhatsApp'
import { SuperadminPage } from './pages/Superadmin'
import { AffiliatePage } from './pages/Affiliate'
import { WalkthroughPage } from './pages/Walkthrough'
import { HarmoniumPage } from './pages/Harmonium'

const Protected = ({ roles, children }) => {
  const { tokens, role } = useAuth()
  if (!tokens) return <Navigate to="/login" replace />
  if (roles && !roles.includes(role)) return <Navigate to="/login" replace />
  return children
}

const Shell = () => (
  <AppLayout>
    <Outlet />
  </AppLayout>
)

function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />

      <Route
        element={
          <Protected roles={['tenant']}>
            <Shell />
          </Protected>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/walkthrough" element={<WalkthroughPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/contacts" element={<ContactsPage />} />
        <Route path="/campaigns" element={<CampaignsPage />} />
        <Route path="/followups" element={<FollowupsPage />} />
        <Route path="/ai" element={<AiPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/status" element={<StatusPage />} />
        <Route path="/channels" element={<ChannelsPage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/whatsapp" element={<WhatsAppPage />} />
        <Route path="/harmonium" element={<HarmoniumPage />} />
      </Route>

      <Route
        path="/superadmin"
        element={
          <Protected roles={['superadmin']}>
            <Shell />
          </Protected>
        }
      >
        <Route index element={<SuperadminPage />} />
      </Route>

      <Route
        path="/affiliate"
        element={
          <Protected roles={['affiliate']}>
            <Shell />
          </Protected>
        }
      >
        <Route index element={<AffiliatePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

export default App

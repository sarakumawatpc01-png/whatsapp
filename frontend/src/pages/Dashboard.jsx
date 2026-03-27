import { useEffect, useState } from 'react'
import { Card } from '../components/common/Card'
import { useAuth } from '../context/AuthContext'

export const DashboardPage = () => {
  const { api } = useAuth()
  const [stats, setStats] = useState(null)
  const [messagesByDay, setMessagesByDay] = useState([])
  const [topContacts, setTopContacts] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [followups, setFollowups] = useState([])
  const [apiUsage, setApiUsage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [
          dashboardRes,
          msgRes,
          topRes,
          campRes,
          fuRes,
          apiUsageRes,
        ] = await Promise.all([
          api.get('/analytics/dashboard'),
          api.get('/analytics/messages-by-day?days=14'),
          api.get('/analytics/top-contacts?limit=5'),
          api.get('/analytics/campaigns'),
          api.get('/analytics/followups'),
          api.get('/analytics/api-usage'),
        ])
        setStats(dashboardRes.data?.data || dashboardRes.data)
        setMessagesByDay(msgRes.data?.data?.data || msgRes.data?.data || [])
        setTopContacts(topRes.data?.data?.contacts || topRes.data?.contacts || [])
        setCampaigns(campRes.data?.data?.campaigns || campRes.data?.campaigns || [])
        setFollowups(fuRes.data?.data?.sequences || fuRes.data?.sequences || [])
        setApiUsage(apiUsageRes.data?.data || apiUsageRes.data)
      } catch (err) {
        setError(err.response?.data?.error || 'Failed to load dashboard')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [api])

  const kpi = [
    { label: 'Total Messages', value: stats?.messages?.total ?? 0 },
    { label: 'Today Messages', value: stats?.messages?.today ?? 0 },
    { label: 'AI handled %', value: `${stats?.messages?.aiHandleRate ?? 0}%` },
    { label: 'Contacts', value: stats?.contacts?.total ?? 0 },
    { label: 'Active (7d)', value: stats?.contacts?.active7Days ?? 0 },
    { label: 'Appointments today', value: stats?.appointments?.today ?? 0 },
    { label: 'Connected numbers', value: stats?.connectedNumbers ?? 0 },
    { label: 'AI calls this month', value: stats?.aiCalls?.thisMonth ?? 0 },
  ]

  return (
    <div className="page active">
      <div className="overview-welcome">
        <div className="ow-text">
          <h2>Welcome back</h2>
          <p>All your WhatsApp automation, AI, campaigns, billing and analytics in one place.</p>
        </div>
        <div className="ai-master-toggle">
          <div className="amt-label">System status</div>
          <div className="amt-status">{loading ? 'Loading...' : 'Online'}</div>
        </div>
      </div>

      {error && <div className="badge red">{error}</div>}

      <div className="kpi-grid">
        {kpi.map((item) => (
          <div key={item.label} className="kpi">
            <div className="kpi-val">{item.value}</div>
            <div className="kpi-label">{item.label}</div>
          </div>
        ))}
      </div>

      <div className="overview-mid">
        <Card title="Message Volume (14d)">
          <div className="chart-bars">
            {messagesByDay.map((d) => (
              <div
                key={d.date}
                className={`bar ${d.total > 0 ? 'hi' : ''}`}
                style={{ height: Math.max(4, d.total * 2) }}
                title={`${d.total} messages on ${d.date}`}
              />
            ))}
          </div>
          <div className="chart-labels">
            {messagesByDay.map((d) => (
              <div key={d.date} className="chart-label">
                {d.date.slice(5)}
              </div>
            ))}
          </div>
        </Card>
        <Card title="Top contacts">
          <div>
            {topContacts.map((c, idx) => (
              <div className="activity-item" key={c.id}>
                <div className="act-dot" style={{ background: '#00E676' }} />
                <div className="act-text">
                  {idx + 1}. {c.name || c.phoneNumber} — {c.messageCount} msgs
                  <div className="act-time">{c.label || 'unlabeled'}</div>
                </div>
              </div>
            ))}
            {!topContacts.length && <div className="act-time">No contacts yet</div>}
          </div>
        </Card>
      </div>

      <div className="overview-mid">
        <Card title="Campaigns">
          <div className="camp-grid">
            {campaigns.map((c) => (
              <div key={c.id} className="camp-card">
                <div className="cc-status-row">
                  <span className="badge blue">{c.status}</span>
                  <span className="cc-date">{c.startedAt || ''}</span>
                </div>
                <div className="cc-name">{c.name}</div>
                <div className="cc-desc">Sent: {c.sentCount} · Read: {c.readCount}</div>
                <div className="cc-stats">
                  <div>
                    <div className="cc-stat-val">{c.deliveredCount}</div>
                    <div className="cc-stat-label">Delivered</div>
                  </div>
                  <div>
                    <div className="cc-stat-val">{c.replyCount}</div>
                    <div className="cc-stat-label">Replies</div>
                  </div>
                </div>
              </div>
            ))}
            {!campaigns.length && <div className="cc-desc">No campaigns yet</div>}
          </div>
        </Card>

        <Card title="Followups">
          <div className="fu-table">
            <div className="fu-col-head">
              <span>Name</span>
              <span>Active</span>
              <span>Sent</span>
              <span>Replies</span>
              <span>Enrollments</span>
              <span>Status</span>
            </div>
            {followups.map((f) => (
              <div className="fu-row" key={f.id}>
                <span className="fu-name">{f.name}</span>
                <span>{f.isActive ? 'Yes' : 'No'}</span>
                <span className="fu-sent">{f.sentCount}</span>
                <span>{f.replyCount}</span>
                <span>{f._count?.enrollments ?? 0}</span>
                <span className="badge green">OK</span>
              </div>
            ))}
            {!followups.length && <div className="act-time" style={{ padding: 12 }}>No sequences</div>}
          </div>
        </Card>
      </div>

      <div className="overview-mid">
        <Card title="API Usage">
          <div className="resp-time-row">
            <span className="resp-time-label">Calls (30d)</span>
            <span className="resp-time-val">{apiUsage?.totalCallsThisMonth ?? 0}</span>
          </div>
          <div className="resp-time-row">
            <span className="resp-time-label">Estimated Cost (USD)</span>
            <span className="resp-time-val">${apiUsage?.estimatedCostUsd ?? 0}</span>
          </div>
        </Card>
        <Card title="System health">
          <div className="quick-grid">
            <div className="quick-btn">
              <div className="qb-title">WhatsApp</div>
              <div className="qb-desc">Connected numbers: {stats?.connectedNumbers ?? 0}</div>
            </div>
            <div className="quick-btn">
              <div className="qb-title">AI</div>
              <div className="qb-desc">AI handled: {stats?.messages?.aiHandleRate ?? 0}%</div>
            </div>
            <div className="quick-btn">
              <div className="qb-title">Contacts</div>
              <div className="qb-desc">Total: {stats?.contacts?.total ?? 0}</div>
            </div>
            <div className="quick-btn">
              <div className="qb-title">Appointments</div>
              <div className="qb-desc">Today: {stats?.appointments?.today ?? 0}</div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

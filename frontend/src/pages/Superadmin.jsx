import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/common/Card'

const safeData = (res) => res?.data?.data || res?.data || {}
const safeList = (res) => {
  const data = safeData(res)
  if (Array.isArray(data)) return data
  if (Array.isArray(data.data)) return data.data
  return []
}

export const SuperadminPage = () => {
  const { api, role } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [stats, setStats] = useState({})
  const [users, setUsers] = useState([])
  const [tickets, setTickets] = useState([])
  const [actions, setActions] = useState([])
  const [sessions, setSessions] = useState([])
  const [subs, setSubs] = useState([])
  const [payments, setPayments] = useState([])
  const [tokenUsage, setTokenUsage] = useState([])
  const [tokenUsageSummary, setTokenUsageSummary] = useState([])
  const [activityMonitor, setActivityMonitor] = useState({})
  const [apiKeys, setApiKeys] = useState({})
  const [emailSettings, setEmailSettings] = useState({
    smtp_host: '',
    smtp_port: '587',
    smtp_user: '',
    smtp_pass: '',
    smtp_secure: 'false',
    email_from: '',
    email_from_name: '',
  })
  const [apiKeyForm, setApiKeyForm] = useState({
    anthropic_api_key: '',
    openai_api_key: '',
    deepseek_api_key: '',
    sarvam_api_key: '',
    openrouter_api_key: '',
    sendgrid_api_key: '',
    razorpay_key_id: '',
    razorpay_key_secret: '',
    razorpay_webhook_secret: '',
  })
  const [testEmailTo, setTestEmailTo] = useState('')
  const [customEmail, setCustomEmail] = useState({ to: '', subject: '', html: '' })

  const load = useCallback(async () => {
    if (role !== 'superadmin') return
    setLoading(true)
    setError('')
    try {
      const [
        statsRes,
        usersRes,
        apiKeysRes,
        ticketsRes,
        actionsRes,
        sessionsRes,
        subsRes,
        paymentsRes,
        tokenUsageRes,
        monitorRes,
        emailSettingsRes,
      ] = await Promise.all([
        api.get('/superadmin/stats'),
        api.get('/superadmin/users?limit=20'),
        api.get('/superadmin/api-keys'),
        api.get('/superadmin/support-tickets?limit=20'),
        api.get('/superadmin/activity-logs?limit=20'),
        api.get('/superadmin/user-sessions?limit=20'),
        api.get('/superadmin/subscriptions?limit=20'),
        api.get('/superadmin/payments?limit=20'),
        api.get('/superadmin/token-usage?limit=20'),
        api.get('/superadmin/activity-monitor'),
        api.get('/superadmin/email-settings'),
      ])

      setStats(safeData(statsRes))
      setUsers(safeList(usersRes))
      setApiKeys(safeData(apiKeysRes).keys || {})
      setTickets(safeList(ticketsRes))
      setActions(safeList(actionsRes))
      setSessions(safeList(sessionsRes))
      setSubs(safeList(subsRes))
      setPayments(safeList(paymentsRes))

      const tu = safeData(tokenUsageRes)
      if (Array.isArray(tu)) {
        setTokenUsage(tu)
        setTokenUsageSummary([])
      } else {
        setTokenUsage(tu.data || [])
        setTokenUsageSummary(tu.summaryByProvider || [])
      }

      setActivityMonitor(safeData(monitorRes))
      setEmailSettings((prev) => ({ ...prev, ...(safeData(emailSettingsRes).settings || {}) }))
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load superadmin data')
    } finally {
      setLoading(false)
    }
  }, [api, role])

  useEffect(() => {
    load()
  }, [load])

  const suspend = async (id) => {
    await api.post(`/superadmin/users/${id}/suspend`)
    load()
  }

  const unsuspend = async (id) => {
    await api.post(`/superadmin/users/${id}/unsuspend`)
    load()
  }

  const resolveTicket = async (id) => {
    await api.post(`/superadmin/support-tickets/${id}/resolve`)
    load()
  }

  const saveApiKey = async (key) => {
    setError('')
    const value = apiKeyForm[key]?.trim()
    if (!value) {
      setError(`Please provide value for ${key}`)
      return
    }
    try {
      await api.patch('/superadmin/api-keys', { key, value })
      setApiKeyForm((prev) => ({ ...prev, [key]: '' }))
      const res = await api.get('/superadmin/api-keys')
      setApiKeys(safeData(res).keys || {})
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update API key')
    }
  }

  const saveEmailSettings = async () => {
    setError('')
    try {
      await api.patch('/superadmin/email-settings', emailSettings)
      await load()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update email settings')
    }
  }

  const sendTestEmail = async () => {
    setError('')
    try {
      await api.post('/superadmin/email-settings/test', { to: testEmailTo })
      setTestEmailTo('')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send test email')
    }
  }

  const sendCustomEmail = async () => {
    setError('')
    try {
      await api.post('/superadmin/email/send-custom', customEmail)
      setCustomEmail({ to: '', subject: '', html: '' })
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send custom email')
    }
  }

  if (role !== 'superadmin') {
    return (
      <div className="page active">
        <div className="section-title">Superadmin</div>
        <div className="section-sub">Login as superadmin from the auth page.</div>
      </div>
    )
  }

  return (
    <div className="page active">
      <div className="section-title">Superadmin Control</div>
      <div className="section-sub">
        Platform activity, users, billing, token usage, API access, logs, support tickets, and email operations.
      </div>
      {loading && <div className="badge blue">Loading...</div>}
      {error && <div className="badge red">{error}</div>}

      <Card title="Platform Overview">
        <div className="grid-4">
          <div className="kpi">
            <div className="kpi-val">{stats?.users?.total ?? 0}</div>
            <div className="kpi-label">Total users</div>
          </div>
          <div className="kpi">
            <div className="kpi-val">{stats?.users?.active ?? 0}</div>
            <div className="kpi-label">Active users</div>
          </div>
          <div className="kpi">
            <div className="kpi-val">{stats?.whatsapp?.activeSessions ?? 0}</div>
            <div className="kpi-label">Active WA sessions</div>
          </div>
          <div className="kpi">
            <div className="kpi-val">₹{stats?.revenue?.mrrRupees ?? 0}</div>
            <div className="kpi-label">MRR</div>
          </div>
        </div>
      </Card>

      <div className="overview-mid">
        <Card title="Activity Monitor">
          <div className="resp-time-row">
            <span className="resp-time-label">Messages (last hour)</span>
            <span className="resp-time-val">{activityMonitor?.realtime?.messagesLastHour ?? 0}</span>
          </div>
          <div className="resp-time-row">
            <span className="resp-time-label">AI calls (last hour)</span>
            <span className="resp-time-val">{activityMonitor?.realtime?.aiCallsLastHour ?? 0}</span>
          </div>
          <div className="resp-time-row">
            <span className="resp-time-label">Disconnected sessions (24h)</span>
            <span className="resp-time-val">{activityMonitor?.daily?.disconnectedSessions ?? 0}</span>
          </div>
          <div className="resp-time-row">
            <span className="resp-time-label">Inactive users (30d)</span>
            <span className="resp-time-val">{activityMonitor?.churnRisk?.usersInactive30Days ?? 0}</span>
          </div>
        </Card>

        <Card title="AI Token Usage Summary">
          {tokenUsageSummary.map((row) => (
            <div className="resp-time-row" key={row.provider}>
              <span className="resp-time-label">{row.provider}</span>
              <span className="resp-time-val">
                {row._count?.id ?? 0} calls · ${(row._sum?.costUsd ?? 0).toFixed(4)}
              </span>
            </div>
          ))}
          {!tokenUsageSummary.length && <div className="act-time">No token usage data</div>}
        </Card>
      </div>

      <Card title="API Keys & Providers (includes OpenRouter)">
        <div className="form-grid-2">
          {Object.keys(apiKeyForm).map((key) => (
            <div className="form-group" key={key}>
              <label className="form-label">{key}</label>
              <div className="act-time">Current: {apiKeys[key] || '—'}</div>
              <input
                className="form-input"
                value={apiKeyForm[key]}
                onChange={(e) => setApiKeyForm((prev) => ({ ...prev, [key]: e.target.value }))}
                type="password"
                placeholder={`Set ${key}`}
              />
              <button className="btn btn-primary" onClick={() => saveApiKey(key)}>
                Save
              </button>
            </div>
          ))}
        </div>
      </Card>

      <div className="overview-mid">
        <Card title="Email Setup & Access">
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">SMTP Host</label>
              <input
                className="form-input"
                value={emailSettings.smtp_host}
                onChange={(e) => setEmailSettings((p) => ({ ...p, smtp_host: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">SMTP Port</label>
              <input
                className="form-input"
                value={emailSettings.smtp_port}
                onChange={(e) => setEmailSettings((p) => ({ ...p, smtp_port: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">SMTP User</label>
              <input
                className="form-input"
                value={emailSettings.smtp_user}
                onChange={(e) => setEmailSettings((p) => ({ ...p, smtp_user: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">SMTP Password</label>
              <input
                className="form-input"
                value={emailSettings.smtp_pass}
                type="password"
                onChange={(e) => setEmailSettings((p) => ({ ...p, smtp_pass: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Email From</label>
              <input
                className="form-input"
                value={emailSettings.email_from}
                onChange={(e) => setEmailSettings((p) => ({ ...p, email_from: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Email From Name</label>
              <input
                className="form-input"
                value={emailSettings.email_from_name}
                onChange={(e) => setEmailSettings((p) => ({ ...p, email_from_name: e.target.value }))}
              />
            </div>
          </div>
          <button className="btn btn-primary" onClick={saveEmailSettings}>
            Save Email Settings
          </button>
        </Card>

        <Card title="Custom Email Sending">
          <div className="form-group">
            <label className="form-label">Test Email Address</label>
            <input
              className="form-input"
              value={testEmailTo}
              onChange={(e) => setTestEmailTo(e.target.value)}
              placeholder="test@example.com"
            />
            <button className="btn btn-primary" onClick={sendTestEmail}>
              Send Test Email
            </button>
          </div>
          <div className="form-group">
            <label className="form-label">To</label>
            <input
              className="form-input"
              value={customEmail.to}
              onChange={(e) => setCustomEmail((p) => ({ ...p, to: e.target.value }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Subject</label>
            <input
              className="form-input"
              value={customEmail.subject}
              onChange={(e) => setCustomEmail((p) => ({ ...p, subject: e.target.value }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">HTML Body</label>
            <textarea
              className="form-input"
              value={customEmail.html}
              onChange={(e) => setCustomEmail((p) => ({ ...p, html: e.target.value }))}
              placeholder="<p>Your custom email</p>"
            />
          </div>
          <button className="btn btn-primary" onClick={sendCustomEmail}>
            Send Custom Email
          </button>
        </Card>
      </div>

      <div className="overview-mid">
        <Card title="Users">
          <div className="contacts-table">
            <div className="ct-head">
              <span />
              <span>Name</span>
              <span>Email</span>
              <span>Status</span>
              <span>Plan</span>
              <span>Actions</span>
            </div>
            {users.map((u) => (
              <div className="ct-row" key={u.id}>
                <input type="checkbox" className="ct-checkbox" />
                <div className="ct-name-cell">
                  <div className="ct-av">{u.businessName?.[0] || 'U'}</div>
                  <div>
                    <div className="ct-name">{u.businessName || u.ownerName}</div>
                    <div className="ct-phone">{u.id}</div>
                  </div>
                </div>
                <div className="ct-label">{u.email}</div>
                <div className="ct-label">{u.status}</div>
                <div className="ct-label">{u.plan?.displayName || '—'}</div>
                <div className="ct-row-acts">
                  <button className="ct-act" onClick={() => suspend(u.id)}>
                    Suspend
                  </button>
                  <button className="ct-act" onClick={() => unsuspend(u.id)}>
                    Unsuspend
                  </button>
                </div>
              </div>
            ))}
            {!users.length && <div className="ct-row">No users</div>}
          </div>
        </Card>

        <Card title="Support Tickets">
          {tickets.map((t) => (
            <div className="activity-item" key={t.id}>
              <div className="act-dot" style={{ background: t.status === 'resolved' ? '#00E676' : '#FF8F00' }} />
              <div className="act-text">
                {t.subject} · {t.tenant?.businessName || 'Unknown user'}
                <div className="act-time">{t.status}</div>
              </div>
              {t.status !== 'resolved' && (
                <button className="ct-act" onClick={() => resolveTicket(t.id)}>
                  Resolve
                </button>
              )}
            </div>
          ))}
          {!tickets.length && <div className="act-time">No support tickets</div>}
        </Card>
      </div>

      <div className="overview-mid">
        <Card title="Recent Admin Activity Logs">
          {actions.map((a) => (
            <div className="activity-item" key={a.id}>
              <div className="act-dot" style={{ background: '#00BCD4' }} />
              <div className="act-text">
                {a.actionType} · {a.admin?.email || 'admin'}
                <div className="act-time">{a.createdAt}</div>
              </div>
            </div>
          ))}
          {!actions.length && <div className="act-time">No activity logs</div>}
        </Card>

        <Card title="Recent User Sessions / Login Logs">
          {sessions.map((s) => (
            <div className="activity-item" key={s.id}>
              <div className="act-dot" style={{ background: '#9C6FFF' }} />
              <div className="act-text">
                {s.tenant?.businessName || 'User'} · {s.tenant?.email || '—'}
                <div className="act-time">{s.createdAt}</div>
              </div>
            </div>
          ))}
          {!sessions.length && <div className="act-time">No session logs</div>}
        </Card>
      </div>

      <div className="overview-mid">
        <Card title="Subscriptions / Billing">
          {subs.map((s) => (
            <div className="activity-item" key={s.id}>
              <div className="act-dot" style={{ background: '#00E676' }} />
              <div className="act-text">
                {s.tenant?.businessName || 'User'} · {s.plan?.displayName || 'Plan'}
                <div className="act-time">{s.status} · Amount: ₹{(s.amount || 0) / 100}</div>
              </div>
            </div>
          ))}
          {!subs.length && <div className="act-time">No subscriptions</div>}
        </Card>

        <Card title="Payments">
          {payments.map((p) => (
            <div className="activity-item" key={p.id}>
              <div className="act-dot" style={{ background: '#00BCD4' }} />
              <div className="act-text">
                {p.tenant?.businessName || 'User'} · {p.plan?.displayName || 'Plan'}
                <div className="act-time">{p.razorpayPaymentId || 'Manual'} · ₹{(p.amount || 0) / 100}</div>
              </div>
            </div>
          ))}
          {!payments.length && <div className="act-time">No payment logs</div>}
        </Card>
      </div>

      <Card title="Recent API / Token Usage Logs">
        {tokenUsage.map((u) => (
          <div className="activity-item" key={u.id}>
            <div className="act-dot" style={{ background: '#FF8F00' }} />
            <div className="act-text">
              {u.tenant?.businessName || 'User'} · {u.provider} / {u.model}
              <div className="act-time">
                in:{u.inputTokens} out:{u.outputTokens} cost:${(u.costUsd || 0).toFixed(6)}
              </div>
            </div>
          </div>
        ))}
        {!tokenUsage.length && <div className="act-time">No API usage logs</div>}
      </Card>
    </div>
  )
}

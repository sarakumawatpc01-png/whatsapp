import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/common/Card'

const safeData = (res) => res?.data?.data || res?.data || {}
const safeList = (res) => {
  const data = safeData(res)
  if (Array.isArray(data)) return data
  if (Array.isArray(data.data)) return data.data
  if (Array.isArray(data.plans)) return data.plans
  return []
}

const parseError = (err, fallback) => err?.response?.data?.error || err?.response?.data?.message || fallback

const apiKeyDefs = [
  { key: 'anthropic_api_key', label: 'Anthropic API Key' },
  { key: 'openai_api_key', label: 'OpenAI API Key' },
  { key: 'deepseek_api_key', label: 'DeepSeek API Key' },
  { key: 'sarvam_api_key', label: 'Sarvam API Key' },
  { key: 'openrouter_api_key', label: 'OpenRouter API Key' },
  { key: 'sendgrid_api_key', label: 'SendGrid API Key' },
  { key: 'razorpay_key_id', label: 'Razorpay Key ID' },
  { key: 'razorpay_key_secret', label: 'Razorpay Key Secret' },
  { key: 'razorpay_webhook_secret', label: 'Razorpay Webhook Secret' },
]

const defaultPlanForm = {
  name: '',
  displayName: '',
  price: 0,
  maxNumbers: 1,
  maxMessages: 500,
  maxAiCalls: 100,
  maxContacts: 100,
  storageGb: 0.05,
  maxCampaigns: 1,
  maxFollowups: 1,
  calendarEnabled: false,
  analyticsLevel: 'basic',
  minMsgGapSeconds: 10,
  supportLevel: 'ai',
}

export const SuperadminPage = () => {
  const { api, role, assumeTenantSession } = useAuth()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [stats, setStats] = useState({})
  const [users, setUsers] = useState([])
  const [plans, setPlans] = useState([])
  const [tickets, setTickets] = useState([])
  const [actions, setActions] = useState([])
  const [sessions, setSessions] = useState([])
  const [subs, setSubs] = useState([])
  const [payments, setPayments] = useState([])
  const [tokenUsage, setTokenUsage] = useState([])
  const [tokenUsageSummary, setTokenUsageSummary] = useState([])
  const [activityMonitor, setActivityMonitor] = useState({})
  const [apiKeys, setApiKeys] = useState({})

  const [search, setSearch] = useState('')
  const [newPasswordByUser, setNewPasswordByUser] = useState({})
  const [userPlanSelection, setUserPlanSelection] = useState({})
  const [userPkgConfig, setUserPkgConfig] = useState({})

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

  const [otpSettings, setOtpSettings] = useState({
    otp_provider: '',
    otp_sms_template: '',
    otp_expiry_minutes: '10',
    otp_resend_limit: '3',
    otp_whitelist_phones: '',
  })
  const [supportAiConfig, setSupportAiConfig] = useState({
    support_ai_enabled: 'false',
    support_ai_model: '',
    support_ai_prompt: '',
  })

  const [newPlan, setNewPlan] = useState(defaultPlanForm)
  const [editingPlanId, setEditingPlanId] = useState(null)
  const [editingPlanForm, setEditingPlanForm] = useState({})

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users
    const q = search.toLowerCase()
    return users.filter(
      (u) =>
        String(u.businessName || '').toLowerCase().includes(q) ||
        String(u.ownerName || '').toLowerCase().includes(q) ||
        String(u.email || '').toLowerCase().includes(q) ||
        String(u.id || '').toLowerCase().includes(q),
    )
  }, [search, users])

  const hydrateUserEditors = useCallback((userList) => {
    setUserPlanSelection((prev) => {
      const next = { ...prev }
      userList.forEach((u) => {
        if (!next[u.id]) next[u.id] = u.planId || ''
      })
      return next
    })
    setUserPkgConfig((prev) => {
      const next = { ...prev }
      userList.forEach((u) => {
        if (!next[u.id]) {
          next[u.id] = {
            buttonsEnabled: Boolean(u.buttonsEnabled),
            listsEnabled: Boolean(u.listsEnabled),
          }
        }
      })
      return next
    })
  }, [])

  const load = useCallback(async () => {
    if (role !== 'superadmin') return
    setLoading(true)
    setError('')
    try {
      const [
        statsRes,
        usersRes,
        plansRes,
        apiKeysRes,
        ticketsRes,
        actionsRes,
        sessionsRes,
        subsRes,
        paymentsRes,
        tokenUsageRes,
        monitorRes,
        emailSettingsRes,
        otpRes,
        supportAiRes,
      ] = await Promise.all([
        api.get('/superadmin/stats'),
        api.get('/superadmin/users?limit=50'),
        api.get('/superadmin/plans'),
        api.get('/superadmin/api-keys'),
        api.get('/superadmin/support-tickets?limit=20'),
        api.get('/superadmin/activity-logs?limit=20'),
        api.get('/superadmin/user-sessions?limit=20'),
        api.get('/superadmin/subscriptions?limit=20'),
        api.get('/superadmin/payments?limit=20'),
        api.get('/superadmin/token-usage?limit=20'),
        api.get('/superadmin/activity-monitor'),
        api.get('/superadmin/email-settings'),
        api.get('/superadmin/otp-settings'),
        api.get('/superadmin/support-ai'),
      ])

      setStats(safeData(statsRes))

      const usersList = safeList(usersRes)
      setUsers(usersList)
      hydrateUserEditors(usersList)

      setPlans(safeData(plansRes).plans || safeList(plansRes))
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
      setOtpSettings((prev) => ({ ...prev, ...(safeData(otpRes).settings || {}) }))
      setSupportAiConfig((prev) => ({ ...prev, ...(safeData(supportAiRes).config || {}) }))
    } catch (err) {
      setError(parseError(err, 'Failed to load superadmin data'))
    } finally {
      setLoading(false)
    }
  }, [api, role, hydrateUserEditors])

  useEffect(() => {
    load()
  }, [load])

  const withAction = async (fn) => {
    setError('')
    setNotice('')
    try {
      await fn()
    } catch (err) {
      setError(parseError(err, 'Action failed'))
      throw err
    }
  }

  const suspend = async (id) =>
    withAction(async () => {
      await api.post(`/superadmin/users/${id}/suspend`)
      setNotice('User suspended')
      await load()
    })

  const unsuspend = async (id) =>
    withAction(async () => {
      await api.post(`/superadmin/users/${id}/unsuspend`)
      setNotice('User unsuspended')
      await load()
    })

  const resolveTicket = async (id) =>
    withAction(async () => {
      await api.post(`/superadmin/support-tickets/${id}/resolve`)
      setNotice('Ticket resolved')
      await load()
    })

  const saveApiKey = async (key) =>
    withAction(async () => {
      const value = String(apiKeyForm[key] || '').trim()
      if (!value) {
        setError(`Please provide value for ${key}`)
        return
      }
      await api.patch('/superadmin/api-keys', { key, value })
      setApiKeyForm((prev) => ({ ...prev, [key]: '' }))
      const res = await api.get('/superadmin/api-keys')
      setApiKeys(safeData(res).keys || {})
      setNotice(`Saved ${key}`)
    })

  const saveEmailSettings = async () =>
    withAction(async () => {
      await api.patch('/superadmin/email-settings', emailSettings)
      setNotice('Email settings updated')
      await load()
    })

  const sendTestEmail = async () =>
    withAction(async () => {
      await api.post('/superadmin/email-settings/test', { to: testEmailTo })
      setTestEmailTo('')
      setNotice('Test email sent')
    })

  const sendCustomEmail = async () =>
    withAction(async () => {
      await api.post('/superadmin/email/send-custom', customEmail)
      setCustomEmail({ to: '', subject: '', html: '' })
      setNotice('Custom email sent')
    })

  const saveOtpSettings = async () =>
    withAction(async () => {
      await api.patch('/superadmin/otp-settings', otpSettings)
      setNotice('OTP settings updated')
      await load()
    })

  const saveSupportAiConfig = async () =>
    withAction(async () => {
      await api.patch('/superadmin/support-ai', supportAiConfig)
      setNotice('Support AI config updated')
      await load()
    })

  const resetUserPassword = async (userId) =>
    withAction(async () => {
      const newPassword = String(newPasswordByUser[userId] || '')
      if (!newPassword || newPassword.length < 8) {
        setError('New password must be at least 8 characters')
        return
      }
      await api.post(`/superadmin/users/${userId}/reset-password`, { newPassword })
      setNewPasswordByUser((prev) => ({ ...prev, [userId]: '' }))
      setNotice('User password reset successfully')
    })

  const impersonateUser = async (userId) =>
    withAction(async () => {
      const res = await api.post(`/superadmin/users/${userId}/login-as`)
      const payload = safeData(res)
      if (!payload.accessToken || !payload.user) {
        setError('Impersonation response invalid')
        return
      }
      assumeTenantSession({
        accessToken: payload.accessToken,
        refreshToken: null,
        tenant: payload.user,
      })
      navigate('/dashboard')
    })

  const assignPlanToUser = async (userId) =>
    withAction(async () => {
      const planId = userPlanSelection[userId]
      if (!planId) {
        setError('Select a plan first')
        return
      }
      await api.post(`/superadmin/users/${userId}/plan`, { planId })
      setNotice('Plan assigned to user')
      await load()
    })

  const saveUserCustomPackage = async (userId) =>
    withAction(async () => {
      const current = userPkgConfig[userId] || {}
      await api.post(`/superadmin/users/${userId}/buttons-lists`, {
        buttonsEnabled: Boolean(current.buttonsEnabled),
        listsEnabled: Boolean(current.listsEnabled),
      })
      setNotice('Custom package toggles updated')
      await load()
    })

  const createPlanRecord = async () =>
    withAction(async () => {
      if (!newPlan.name || !newPlan.displayName) {
        setError('Plan name and display name are required')
        return
      }
      await api.post('/superadmin/plans', {
        ...newPlan,
        price: Number(newPlan.price),
        maxNumbers: Number(newPlan.maxNumbers),
        maxMessages: Number(newPlan.maxMessages),
        maxAiCalls: Number(newPlan.maxAiCalls),
        maxContacts: Number(newPlan.maxContacts),
        storageGb: Number(newPlan.storageGb),
        maxCampaigns: Number(newPlan.maxCampaigns),
        maxFollowups: Number(newPlan.maxFollowups),
        minMsgGapSeconds: Number(newPlan.minMsgGapSeconds),
      })
      setNewPlan(defaultPlanForm)
      setNotice('Plan created')
      await load()
    })

  const startEditingPlan = (plan) => {
    setEditingPlanId(plan.id)
    setEditingPlanForm({
      displayName: plan.displayName,
      price: plan.price,
      maxNumbers: plan.maxNumbers,
      maxMessages: plan.maxMessages,
      maxAiCalls: plan.maxAiCalls,
      maxContacts: plan.maxContacts,
      storageGb: plan.storageGb,
      maxCampaigns: plan.maxCampaigns,
      maxFollowups: plan.maxFollowups,
      calendarEnabled: plan.calendarEnabled,
      analyticsLevel: plan.analyticsLevel,
      minMsgGapSeconds: plan.minMsgGapSeconds,
      supportLevel: plan.supportLevel,
      buttonsEnabled: plan.buttonsEnabled,
      listsEnabled: plan.listsEnabled,
      isActive: plan.isActive,
    })
  }

  const savePlanUpdate = async (planId) =>
    withAction(async () => {
      await api.patch(`/superadmin/plans/${planId}`, {
        ...editingPlanForm,
        price: Number(editingPlanForm.price),
        maxNumbers: Number(editingPlanForm.maxNumbers),
        maxMessages: Number(editingPlanForm.maxMessages),
        maxAiCalls: Number(editingPlanForm.maxAiCalls),
        maxContacts: Number(editingPlanForm.maxContacts),
        storageGb: Number(editingPlanForm.storageGb),
        maxCampaigns: Number(editingPlanForm.maxCampaigns),
        maxFollowups: Number(editingPlanForm.maxFollowups),
        minMsgGapSeconds: Number(editingPlanForm.minMsgGapSeconds),
      })
      setEditingPlanId(null)
      setEditingPlanForm({})
      setNotice('Plan updated')
      await load()
    })

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
        Full control panel for settings, users, password reset, plan/package management, impersonation, and API providers.
      </div>
      {loading && <div className="badge blue">Loading...</div>}
      {error && <div className="badge red">{error}</div>}
      {notice && <div className="badge green">{notice}</div>}

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

      <Card title="API Keys & Providers (OpenAI / Anthropic / DeepSeek / Sarvam / OpenRouter)">
        <div className="form-grid-2">
          {apiKeyDefs.map(({ key, label }) => (
            <div className="form-group" key={key}>
              <label className="form-label">{label}</label>
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
        <Card title="OTP Settings">
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Provider</label>
              <input
                className="form-input"
                value={otpSettings.otp_provider}
                onChange={(e) => setOtpSettings((p) => ({ ...p, otp_provider: e.target.value }))}
                placeholder="twilio | msg91 | custom"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Expiry Minutes</label>
              <input
                className="form-input"
                value={otpSettings.otp_expiry_minutes}
                onChange={(e) => setOtpSettings((p) => ({ ...p, otp_expiry_minutes: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Resend Limit</label>
              <input
                className="form-input"
                value={otpSettings.otp_resend_limit}
                onChange={(e) => setOtpSettings((p) => ({ ...p, otp_resend_limit: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Whitelist Phones</label>
              <input
                className="form-input"
                value={otpSettings.otp_whitelist_phones}
                onChange={(e) => setOtpSettings((p) => ({ ...p, otp_whitelist_phones: e.target.value }))}
                placeholder="+911234567890,+919876543210"
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">SMS Template</label>
            <textarea
              className="form-input"
              value={otpSettings.otp_sms_template}
              onChange={(e) => setOtpSettings((p) => ({ ...p, otp_sms_template: e.target.value }))}
            />
          </div>
          <button className="btn btn-primary" onClick={saveOtpSettings}>
            Save OTP Settings
          </button>
        </Card>

        <Card title="Support AI Settings">
          <div className="form-group">
            <label className="form-label">Enabled</label>
            <select
              className="form-input"
              value={supportAiConfig.support_ai_enabled}
              onChange={(e) => setSupportAiConfig((p) => ({ ...p, support_ai_enabled: e.target.value }))}
            >
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Model</label>
            <input
              className="form-input"
              value={supportAiConfig.support_ai_model}
              onChange={(e) => setSupportAiConfig((p) => ({ ...p, support_ai_model: e.target.value }))}
              placeholder="gpt-4o-mini / deepseek-chat / sarvam-2b"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Prompt</label>
            <textarea
              className="form-input"
              value={supportAiConfig.support_ai_prompt}
              onChange={(e) => setSupportAiConfig((p) => ({ ...p, support_ai_prompt: e.target.value }))}
            />
          </div>
          <button className="btn btn-primary" onClick={saveSupportAiConfig}>
            Save Support AI
          </button>
        </Card>
      </div>

      <Card title="Plans & Packages">
        <div className="overview-mid">
          <div>
            <div className="section-sub" style={{ marginBottom: 10 }}>
              Existing packages
            </div>
            {plans.map((plan) => {
              const isEditing = editingPlanId === plan.id
              return (
                <div className="activity-item" key={plan.id}>
                  <div className="act-dot" style={{ background: plan.isActive ? '#00E676' : '#FF8F00' }} />
                  <div className="act-text">
                    {plan.displayName} ({plan.name}) · ₹{(plan.price || 0) / 100}
                    <div className="act-time">
                      AI calls: {plan.maxAiCalls} · Msg gap: {plan.minMsgGapSeconds}s · Buttons:{' '}
                      {String(plan.buttonsEnabled)}
                    </div>
                    {isEditing ? (
                      <div className="form-grid-2" style={{ marginTop: 10 }}>
                        <input
                          className="form-input"
                          value={editingPlanForm.displayName || ''}
                          onChange={(e) => setEditingPlanForm((p) => ({ ...p, displayName: e.target.value }))}
                          placeholder="Display name"
                        />
                        <input
                          className="form-input"
                          type="number"
                          value={editingPlanForm.price ?? 0}
                          onChange={(e) => setEditingPlanForm((p) => ({ ...p, price: e.target.value }))}
                          placeholder="Price in paise"
                        />
                        <input
                          className="form-input"
                          type="number"
                          value={editingPlanForm.maxAiCalls ?? 0}
                          onChange={(e) => setEditingPlanForm((p) => ({ ...p, maxAiCalls: e.target.value }))}
                          placeholder="Max AI calls"
                        />
                        <input
                          className="form-input"
                          type="number"
                          value={editingPlanForm.minMsgGapSeconds ?? 10}
                          onChange={(e) => setEditingPlanForm((p) => ({ ...p, minMsgGapSeconds: e.target.value }))}
                          placeholder="Min msg gap sec"
                        />
                        <select
                          className="form-input"
                          value={String(Boolean(editingPlanForm.buttonsEnabled))}
                          onChange={(e) =>
                            setEditingPlanForm((p) => ({ ...p, buttonsEnabled: e.target.value === 'true' }))
                          }
                        >
                          <option value="false">Buttons disabled</option>
                          <option value="true">Buttons enabled</option>
                        </select>
                        <select
                          className="form-input"
                          value={String(Boolean(editingPlanForm.listsEnabled))}
                          onChange={(e) =>
                            setEditingPlanForm((p) => ({ ...p, listsEnabled: e.target.value === 'true' }))
                          }
                        >
                          <option value="false">Lists disabled</option>
                          <option value="true">Lists enabled</option>
                        </select>
                        <button className="btn btn-primary" onClick={() => savePlanUpdate(plan.id)}>
                          Save Plan
                        </button>
                        <button className="btn btn-ghost" onClick={() => setEditingPlanId(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {!isEditing && (
                    <button className="ct-act" onClick={() => startEditingPlan(plan)}>
                      Edit
                    </button>
                  )}
                </div>
              )
            })}
            {!plans.length && <div className="act-time">No plans found</div>}
          </div>

          <div>
            <div className="section-sub" style={{ marginBottom: 10 }}>
              Create custom package
            </div>
            <div className="form-grid-2">
              <input
                className="form-input"
                value={newPlan.name}
                onChange={(e) => setNewPlan((p) => ({ ...p, name: e.target.value }))}
                placeholder="plan_name"
              />
              <input
                className="form-input"
                value={newPlan.displayName}
                onChange={(e) => setNewPlan((p) => ({ ...p, displayName: e.target.value }))}
                placeholder="Display Name"
              />
              <input
                className="form-input"
                type="number"
                value={newPlan.price}
                onChange={(e) => setNewPlan((p) => ({ ...p, price: e.target.value }))}
                placeholder="Price (paise)"
              />
              <input
                className="form-input"
                type="number"
                value={newPlan.maxAiCalls}
                onChange={(e) => setNewPlan((p) => ({ ...p, maxAiCalls: e.target.value }))}
                placeholder="Max AI calls"
              />
              <input
                className="form-input"
                type="number"
                value={newPlan.maxMessages}
                onChange={(e) => setNewPlan((p) => ({ ...p, maxMessages: e.target.value }))}
                placeholder="Max messages"
              />
              <input
                className="form-input"
                type="number"
                value={newPlan.minMsgGapSeconds}
                onChange={(e) => setNewPlan((p) => ({ ...p, minMsgGapSeconds: e.target.value }))}
                placeholder="Min msg gap seconds"
              />
            </div>
            <button className="btn btn-primary" onClick={createPlanRecord} style={{ marginTop: 10 }}>
              Create Plan
            </button>
          </div>
        </div>
      </Card>

      <Card title="Users (search, suspend, reset password, login-as-user, package controls)">
        <div className="form-group">
          <input
            className="form-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users by name, email or id"
          />
        </div>
        <div className="contacts-table">
          <div className="ct-head superadmin-users-head">
            <span />
            <span>User</span>
            <span>Email</span>
            <span>Status</span>
            <span>Plan</span>
            <span>Actions</span>
          </div>
          {filteredUsers.map((u) => (
            <div className="ct-row superadmin-users-row" key={u.id}>
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
              <div className="ct-label">
                <select
                  className="form-input"
                  value={userPlanSelection[u.id] || ''}
                  onChange={(e) => setUserPlanSelection((p) => ({ ...p, [u.id]: e.target.value }))}
                >
                  <option value="">Select plan</option>
                  {plans.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.displayName}
                    </option>
                  ))}
                </select>
                <button className="ct-act" onClick={() => assignPlanToUser(u.id)} style={{ marginTop: 6 }}>
                  Assign plan
                </button>
              </div>
              <div className="ct-row-acts superadmin-user-actions">
                <button className="ct-act" onClick={() => suspend(u.id)}>
                  Suspend
                </button>
                <button className="ct-act" onClick={() => unsuspend(u.id)}>
                  Unsuspend
                </button>
                <button className="ct-act" onClick={() => impersonateUser(u.id)}>
                  Login as user
                </button>
                <input
                  className="form-input"
                  type="password"
                  value={newPasswordByUser[u.id] || ''}
                  onChange={(e) => setNewPasswordByUser((p) => ({ ...p, [u.id]: e.target.value }))}
                  placeholder="New password"
                />
                <button className="ct-act" onClick={() => resetUserPassword(u.id)}>
                  Reset password
                </button>
                <div className="superadmin-inline-toggles">
                  <label className="act-time">
                    <input
                      type="checkbox"
                      checked={Boolean(userPkgConfig[u.id]?.buttonsEnabled)}
                      onChange={(e) =>
                        setUserPkgConfig((p) => ({
                          ...p,
                          [u.id]: { ...(p[u.id] || {}), buttonsEnabled: e.target.checked },
                        }))
                      }
                    />{' '}
                    Buttons
                  </label>
                  <label className="act-time">
                    <input
                      type="checkbox"
                      checked={Boolean(userPkgConfig[u.id]?.listsEnabled)}
                      onChange={(e) =>
                        setUserPkgConfig((p) => ({
                          ...p,
                          [u.id]: { ...(p[u.id] || {}), listsEnabled: e.target.checked },
                        }))
                      }
                    />{' '}
                    Lists
                  </label>
                  <button className="ct-act" onClick={() => saveUserCustomPackage(u.id)}>
                    Save package
                  </button>
                </div>
              </div>
            </div>
          ))}
          {!filteredUsers.length && <div className="ct-row">No users found</div>}
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
      </div>

      <div className="overview-mid">
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

        <Card title="Subscriptions / Payments">
          {subs.map((s) => (
            <div className="activity-item" key={s.id}>
              <div className="act-dot" style={{ background: '#00E676' }} />
              <div className="act-text">
                {s.tenant?.businessName || 'User'} · {s.plan?.displayName || 'Plan'}
                <div className="act-time">{s.status} · ₹{(s.amount || 0) / 100}</div>
              </div>
            </div>
          ))}
          {payments.map((p) => (
            <div className="activity-item" key={p.id}>
              <div className="act-dot" style={{ background: '#00BCD4' }} />
              <div className="act-text">
                {p.tenant?.businessName || 'User'} · {p.plan?.displayName || 'Plan'}
                <div className="act-time">{p.razorpayPaymentId || 'Manual'} · ₹{(p.amount || 0) / 100}</div>
              </div>
            </div>
          ))}
          {!subs.length && !payments.length && <div className="act-time">No billing logs</div>}
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

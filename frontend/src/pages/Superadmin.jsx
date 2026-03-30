import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/common/Card'

export const SuperadminPage = () => {
  const { api, role } = useAuth()
  const [stats, setStats] = useState(null)
  const [users, setUsers] = useState([])
  const [apiKeys, setApiKeys] = useState({})
  const [apiKeyInputs, setApiKeyInputs] = useState({
    razorpay_key_id: '',
    razorpay_key_secret: '',
    razorpay_webhook_secret: '',
  })
  const [error, setError] = useState('')
  const keyLabels = {
    razorpay_key_id: 'Razorpay key ID',
    razorpay_key_secret: 'Razorpay key secret',
    razorpay_webhook_secret: 'Razorpay webhook secret',
  }

  const extractKeys = (res) => {
    const keysData = res.data?.data || res.data || {}
    return keysData.keys || {}
  }

  const load = async () => {
    if (role !== 'superadmin') return
    try {
      const [s, u, k] = await Promise.all([
        api.get('/superadmin/stats'),
        api.get('/superadmin/users'),
        api.get('/superadmin/api-keys'),
      ])
      setStats(s.data?.data || s.data)
      const usersData = u.data?.data || u.data || {}
      setUsers(usersData.data || usersData)
      setApiKeys(extractKeys(k))
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load superadmin data')
    }
  }

  useEffect(() => {
    load()
  }, [role])

  const suspend = async (id) => {
    await api.post(`/superadmin/users/${id}/suspend`)
    load()
  }

  const unsuspend = async (id) => {
    await api.post(`/superadmin/users/${id}/unsuspend`)
    load()
  }

  const updateApiKey = async (key) => {
    const value = apiKeyInputs[key]?.trim()
    if (!value) {
      setError(`Please enter a value for ${keyLabels[key] || key.replace(/_/g, ' ')}`)
      return
    }
    try {
      await api.patch('/superadmin/api-keys', { key, value })
      setApiKeyInputs((prev) => ({ ...prev, [key]: '' }))
      setError('')
      const res = await api.get('/superadmin/api-keys')
      setApiKeys(extractKeys(res))
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update API key')
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
      <div className="section-sub">Platform-level stats, users and plans.</div>
      {error && <div className="badge red">{error}</div>}

      <Card title="Stats">
        <div className="grid-3">
          <div className="kpi">
            <div className="kpi-val">{stats?.totalUsers ?? 0}</div>
            <div className="kpi-label">Total users</div>
          </div>
          <div className="kpi">
            <div className="kpi-val">{stats?.activeUsers ?? 0}</div>
            <div className="kpi-label">Active</div>
          </div>
          <div className="kpi">
            <div className="kpi-val">{stats?.totalRevenuePaise ? stats.totalRevenuePaise / 100 : 0}</div>
            <div className="kpi-label">Revenue</div>
          </div>
        </div>
      </Card>

      <Card title="Payment Gateway (Razorpay)">
        <div className="form-group">
          <label className="form-label">Key ID</label>
          <div className="act-time">Current: {apiKeys.razorpay_key_id || '—'}</div>
          <input
            className="form-input"
            placeholder="rzp_live_..."
            value={apiKeyInputs.razorpay_key_id}
            onChange={(e) =>
              setApiKeyInputs((prev) => ({ ...prev, razorpay_key_id: e.target.value }))
            }
          />
          <button className="btn btn-primary" onClick={() => updateApiKey('razorpay_key_id')}>
            Save Key ID
          </button>
        </div>
        <div className="form-group">
          <label className="form-label">Key Secret</label>
          <div className="act-time">
            Current: {apiKeys.razorpay_key_secret ? 'Configured' : '—'}
          </div>
          <input
            className="form-input"
            placeholder="Razorpay key secret"
            type="password"
            value={apiKeyInputs.razorpay_key_secret}
            onChange={(e) =>
              setApiKeyInputs((prev) => ({ ...prev, razorpay_key_secret: e.target.value }))
            }
          />
          <button className="btn btn-primary" onClick={() => updateApiKey('razorpay_key_secret')}>
            Save Key Secret
          </button>
        </div>
        <div className="form-group">
          <label className="form-label">Webhook Secret</label>
          <div className="act-time">
            Current: {apiKeys.razorpay_webhook_secret ? 'Configured' : '—'}
          </div>
          <input
            className="form-input"
            placeholder="Razorpay webhook secret"
            type="password"
            value={apiKeyInputs.razorpay_webhook_secret}
            onChange={(e) =>
              setApiKeyInputs((prev) => ({ ...prev, razorpay_webhook_secret: e.target.value }))
            }
          />
          <button
            className="btn btn-primary"
            onClick={() => updateApiKey('razorpay_webhook_secret')}
          >
            Save Webhook Secret
          </button>
        </div>
      </Card>

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
                  <div className="ct-name">{u.businessName || u.name}</div>
                  <div className="ct-phone">{u.id}</div>
                </div>
              </div>
              <div className="ct-label">{u.email}</div>
              <div className="ct-label">{u.status}</div>
              <div className="ct-label">{u.planId || '—'}</div>
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
    </div>
  )
}

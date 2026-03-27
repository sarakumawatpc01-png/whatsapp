import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/common/Card'

export const CampaignsPage = () => {
  const { api } = useAuth()
  const [campaigns, setCampaigns] = useState([])
  const [form, setForm] = useState({
    name: '',
    message: '',
    targetType: 'all',
    labels: '',
  })
  const [error, setError] = useState('')

  const loadCampaigns = async () => {
    try {
      const res = await api.get('/campaigns')
      const data = res.data?.data || res.data
      setCampaigns(data?.campaigns || data || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load campaigns')
    }
  }

  useEffect(() => {
    loadCampaigns()
  }, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.post('/campaigns', {
        name: form.name,
        message: form.message,
        targetType: form.targetType,
        labels: form.labels ? form.labels.split(',').map((l) => l.trim()) : [],
      })
      setForm({ name: '', message: '', targetType: 'all', labels: '' })
      loadCampaigns()
    } catch (err) {
      setError(err.response?.data?.error || 'Create failed')
    }
  }

  const changeStatus = async (id, action) => {
    try {
      await api.post(`/campaigns/${id}/${action}`)
      loadCampaigns()
    } catch (err) {
      setError(err.response?.data?.error || 'Update failed')
    }
  }

  const remove = async (id) => {
    try {
      await api.delete(`/campaigns/${id}`)
      setCampaigns((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      setError(err.response?.data?.error || 'Delete failed')
    }
  }

  return (
    <div className="page active">
      <div className="section-title">Campaigns</div>
      <div className="section-sub">Create, launch, pause and stop WhatsApp outreach campaigns.</div>
      {error && <div className="badge red">{error}</div>}

      <Card title="Create campaign">
        <form onSubmit={handleCreate}>
          <div className="grid-2">
            <div className="form-group">
              <label className="form-label">Name</label>
              <input
                className="form-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Target</label>
              <select
                className="form-input"
                value={form.targetType}
                onChange={(e) => setForm({ ...form, targetType: e.target.value })}
              >
                <option value="all">All contacts</option>
                <option value="label">By label</option>
                <option value="custom">Custom list</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Labels (comma separated, optional)</label>
            <input
              className="form-input"
              value={form.labels}
              onChange={(e) => setForm({ ...form, labels: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Message</label>
            <textarea
              className="form-input"
              rows={4}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              required
            />
          </div>
          <button className="btn btn-primary" type="submit">
            Create campaign
          </button>
        </form>
      </Card>

      <div className="camp-grid">
        {campaigns.map((c) => (
          <div key={c.id} className="camp-card">
            <div className="cc-status-row">
              <span className="badge green">{c.status}</span>
              <span className="cc-date">{c.createdAt}</span>
            </div>
            <div className="cc-name">{c.name}</div>
            <div className="cc-desc">{c.message || c.description}</div>
            <div className="cc-stats">
              <div>
                <div className="cc-stat-val">{c.sentCount}</div>
                <div className="cc-stat-label">Sent</div>
              </div>
              <div>
                <div className="cc-stat-val">{c.deliveredCount}</div>
                <div className="cc-stat-label">Delivered</div>
              </div>
              <div>
                <div className="cc-stat-val">{c.replyCount}</div>
                <div className="cc-stat-label">Replies</div>
              </div>
            </div>
            <div className="cc-footer">
              <div className="cc-actions">
                <button className="cc-btn" onClick={() => changeStatus(c.id, 'start')}>
                  Start
                </button>
                <button className="cc-btn" onClick={() => changeStatus(c.id, 'pause')}>
                  Pause
                </button>
                <button className="cc-btn" onClick={() => changeStatus(c.id, 'stop')}>
                  Stop
                </button>
              </div>
              <button className="cc-btn" onClick={() => remove(c.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
        {!campaigns.length && <div className="cc-desc">No campaigns yet</div>}
      </div>
    </div>
  )
}

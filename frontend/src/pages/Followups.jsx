import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/common/Card'

export const FollowupsPage = () => {
  const { api } = useAuth()
  const [sequences, setSequences] = useState([])
  const [form, setForm] = useState({
    name: '',
    triggerType: 'no_reply',
    delayValue: 4,
    delayUnit: 'hours',
    message: '',
    stopOnReply: true,
  })
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const res = await api.get('/followups')
      const data = res.data?.data || res.data
      setSequences(data?.data || data || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load followups')
    }
  }

  useEffect(() => {
    load()
  }, [load])

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.post('/followups', form)
      setForm({ ...form, name: '', message: '' })
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Create failed')
    }
  }

  const toggle = async (id, isActive) => {
    try {
      await api.post(`/followups/${id}/toggle`, { isActive })
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Toggle failed')
    }
  }

  const remove = async (id) => {
    try {
      await api.delete(`/followups/${id}`)
      setSequences((prev) => prev.filter((s) => s.id !== id))
    } catch (err) {
      setError(err.response?.data?.error || 'Delete failed')
    }
  }

  return (
    <div className="page active">
      <div className="section-title">Followup Sequences</div>
      <div className="section-sub">Automated followups for no-reply, keywords and onboarding.</div>
      {error && <div className="badge red">{error}</div>}

      <Card title="Create sequence">
        <form onSubmit={handleCreate}>
          <div className="grid-3">
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
              <label className="form-label">Trigger</label>
              <select
                className="form-input"
                value={form.triggerType}
                onChange={(e) => setForm({ ...form, triggerType: e.target.value })}
              >
                <option value="no_reply">No reply</option>
                <option value="keyword">Keyword</option>
                <option value="new_contact">New contact</option>
                <option value="label_change">Label change</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Delay (value)</label>
              <input
                type="number"
                className="form-input"
                value={form.delayValue}
                onChange={(e) => setForm({ ...form, delayValue: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Delay unit</label>
              <select
                className="form-input"
                value={form.delayUnit}
                onChange={(e) => setForm({ ...form, delayUnit: e.target.value })}
              >
                <option value="minutes">Minutes</option>
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Stop on reply</label>
              <select
                className="form-input"
                value={form.stopOnReply ? 'yes' : 'no'}
                onChange={(e) => setForm({ ...form, stopOnReply: e.target.value === 'yes' })}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Message</label>
            <textarea
              className="form-input"
              rows={3}
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
              required
            />
          </div>
          <button className="btn btn-primary" type="submit">
            Create sequence
          </button>
        </form>
      </Card>

      <div className="fu-table">
        <div className="fu-col-head">
          <span>Name</span>
          <span>Trigger</span>
          <span>Delay</span>
          <span>Sent</span>
          <span>Replies</span>
          <span>Actions</span>
        </div>
        {sequences.map((s) => (
          <div className="fu-row" key={s.id}>
            <span className="fu-name">{s.name}</span>
            <span className="fu-trigger-type">{s.triggerType}</span>
            <span className="fu-delay">
              {s.delayValue} {s.delayUnit}
            </span>
            <span className="fu-contacts">{s.sentCount || 0}</span>
            <span className="fu-sent">{s.replyCount || 0}</span>
            <div className="fu-row-actions">
              <button className="fu-act-btn" onClick={() => toggle(s.id, !s.isActive)}>
                {s.isActive ? 'Disable' : 'Enable'}
              </button>
              <button className="fu-act-btn" onClick={() => remove(s.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
        {!sequences.length && <div className="fu-row">No sequences yet</div>}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/common/Card'

export const ChannelsPage = () => {
  const { api } = useAuth()
  const [channels, setChannels] = useState([])
  const [form, setForm] = useState({ name: '', description: '' })
  const [postMessage, setPostMessage] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await api.get('/channels')
      const data = res.data?.data || res.data || []
      setChannels(data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load channels')
    }
  }, [api])

  useEffect(() => {
    load()
  }, [load])

  const createChannel = async (e) => {
    e.preventDefault()
    try {
      await api.post('/channels', form)
      setForm({ name: '', description: '' })
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Create failed')
    }
  }

  const postUpdate = async (channelId) => {
    try {
      await api.post(`/channels/${channelId}/post`, { message: postMessage })
      setPostMessage('')
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Post failed')
    }
  }

  return (
    <div className="page active">
      <div className="section-title">Broadcast Channels</div>
      <div className="section-sub">Create channels and post updates.</div>
      {error && <div className="badge red">{error}</div>}

      <Card title="Create channel">
        <form onSubmit={createChannel}>
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
            <label className="form-label">Description</label>
            <textarea
              className="form-input"
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <button className="btn btn-primary" type="submit">
            Create
          </button>
        </form>
      </Card>

      <Card title="Post update">
        <div className="form-group">
          <label className="form-label">Message</label>
          <textarea
            className="form-input"
            rows={2}
            value={postMessage}
            onChange={(e) => setPostMessage(e.target.value)}
          />
        </div>
        <div className="status-actions">
          {channels.map((c) => (
            <button key={c.id} className="btn btn-ghost" onClick={() => postUpdate(c.id)}>
              Post to {c.name}
            </button>
          ))}
          {!channels.length && <div className="act-time">No channels available</div>}
        </div>
      </Card>

      <div className="camp-grid">
        {channels.map((c) => (
          <div key={c.id} className="camp-card">
            <div className="cc-name">{c.name}</div>
            <div className="cc-desc">{c.description}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

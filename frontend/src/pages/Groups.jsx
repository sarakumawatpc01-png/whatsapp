import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/common/Card'

export const GroupsPage = () => {
  const { api } = useAuth()
  const [groups, setGroups] = useState([])
  const [form, setForm] = useState({ subject: '', description: '' })
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await api.get('/groups')
      const data = res.data?.data || res.data || []
      setGroups(data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load groups')
    }
  }, [api])

  useEffect(() => {
    load()
  }, [load])

  const create = async (e) => {
    e.preventDefault()
    try {
      await api.post('/groups', form)
      setForm({ subject: '', description: '' })
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Create failed')
    }
  }

  const sync = async () => {
    await api.post('/groups/sync')
    load()
  }

  const join = async (inviteLink) => {
    await api.post('/groups/join', { inviteLink })
    load()
  }

  return (
    <div className="page active">
      <div className="section-title">Groups</div>
      <div className="section-sub">Sync, create and manage WhatsApp groups.</div>
      {error && <div className="badge red">{error}</div>}

      <div className="grid-2">
        <Card title="Create group">
          <form onSubmit={create}>
            <div className="form-group">
              <label className="form-label">Subject</label>
              <input
                className="form-input"
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
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

        <Card title="Sync / Join">
          <div className="status-actions">
            <button className="btn btn-ghost" onClick={sync}>
              Sync from WhatsApp
            </button>
            <button className="btn btn-ghost" onClick={() => join(prompt('Invite link') || '')}>
              Join via invite link
            </button>
          </div>
        </Card>
      </div>

      <div className="contacts-table" style={{ marginTop: 12 }}>
        <div className="ct-head">
          <span />
          <span>Name</span>
          <span>Participants</span>
          <span>Status</span>
          <span>Actions</span>
          <span />
        </div>
        {groups.map((g) => (
          <div className="ct-row" key={g.id}>
            <input type="checkbox" className="ct-checkbox" />
            <div className="ct-name-cell">
              <div className="ct-av" style={{ background: '#00BCD4' }}>
                {g.subject?.[0] || 'G'}
              </div>
              <div>
                <div className="ct-name">{g.subject}</div>
                <div className="ct-phone">{g.inviteCode || ''}</div>
              </div>
            </div>
            <div className="ct-label">{g.memberCount || g.members?.length || 0}</div>
            <div className="ct-label">{g.isAdmin ? 'Admin' : 'Member'}</div>
            <div className="ct-row-acts">
              <button className="ct-act" onClick={() => api.get(`/groups/${g.id}/invite-link`).then(load)}>
                Invite link
              </button>
              <button className="ct-act" onClick={() => api.post(`/groups/${g.id}/leave`).then(load)}>
                Leave
              </button>
            </div>
            <span />
          </div>
        ))}
        {!groups.length && <div className="ct-row">No groups</div>}
      </div>
    </div>
  )
}

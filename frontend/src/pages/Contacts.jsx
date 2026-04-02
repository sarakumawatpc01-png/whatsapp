import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/common/Card'

export const ContactsPage = () => {
  const { api } = useAuth()
  const [contacts, setContacts] = useState([])
  const [form, setForm] = useState({ name: '', phoneNumber: '', label: 'lead' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)

  const loadContacts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/contacts?limit=50')
      const data = res.data?.data || res.data?.results || res.data
      setContacts(data?.data || data || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load contacts')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    loadContacts()
  }, [loadContacts])

  const handleCreate = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.post('/contacts', {
        name: form.name,
        phoneNumber: form.phoneNumber,
        label: form.label,
      })
      setForm({ name: '', phoneNumber: '', label: 'lead' })
      loadContacts()
    } catch (err) {
      setError(err.response?.data?.error || 'Create failed')
    }
  }

  const handleDelete = async (id) => {
    try {
      await api.delete(`/contacts/${id}`)
      setContacts((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      setError(err.response?.data?.error || 'Delete failed')
    }
  }

  const handleImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    const formData = new FormData()
    formData.append('file', file)
    try {
      await api.post('/contacts/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      loadContacts()
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const handleExport = () => {
    window.open(`${api.defaults.baseURL}/contacts/export`, '_blank')
  }

  return (
    <div className="page active">
      <div className="section-title">Contacts</div>
      <div className="section-sub">CRM with labels, blocking, mute and quick actions.</div>
      {error && <div className="badge red">{error}</div>}

      <div className="grid-2">
        <Card title="Create contact">
          <form onSubmit={handleCreate}>
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
              <label className="form-label">Phone number (with country code)</label>
              <input
                className="form-input"
                value={form.phoneNumber}
                onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Label</label>
              <select
                className="form-input"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              >
                <option value="lead">Lead</option>
                <option value="customer">Customer</option>
                <option value="vip">VIP</option>
                <option value="prospect">Prospect</option>
              </select>
            </div>
            <button className="btn btn-primary" type="submit">
              Save contact
            </button>
          </form>
        </Card>

        <Card title="Import / Export">
          <div className="status-actions">
            <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
              Upload CSV/Excel
              <input
                type="file"
                accept=".csv, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                hidden
                onChange={handleImport}
              />
            </label>
            <button className="btn btn-primary" onClick={handleExport} disabled={importing}>
              {importing ? 'Importing...' : 'Export contacts'}
            </button>
          </div>
        </Card>
      </div>

      <div className="contacts-table" style={{ marginTop: 16 }}>
        <div className="ct-head">
          <span />
          <span>Name</span>
          <span>Phone</span>
          <span>Label</span>
          <span>Last</span>
          <span>Actions</span>
        </div>
        {loading && <div className="ct-row">Loading...</div>}
        {contacts.map((c) => (
          <div className="ct-row" key={c.id}>
            <input type="checkbox" className="ct-checkbox" />
            <div className="ct-name-cell">
              <div className="ct-av" style={{ background: '#00E676' }}>
                {c.name?.[0]?.toUpperCase() || 'C'}
              </div>
              <div>
                <div className="ct-name">{c.name}</div>
                <div className="ct-phone">{c.waJid || c.phoneNumber}</div>
              </div>
            </div>
            <div className="ct-label">{c.phoneNumber}</div>
            <div className="ct-label">{c.label}</div>
            <div className="ct-last">{c.lastMessageAt || '—'}</div>
            <div className="ct-row-acts">
              <button className="ct-act" onClick={() => api.post(`/contacts/${c.id}/block`)}>
                Block
              </button>
              <button className="ct-act" onClick={() => api.post(`/contacts/${c.id}/mute`)}>
                Mute
              </button>
              <button className="ct-act" onClick={() => handleDelete(c.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
        {!contacts.length && !loading && (
          <div className="ct-row">
            <div className="ct-last">No contacts yet</div>
          </div>
        )}
      </div>
    </div>
  )
}

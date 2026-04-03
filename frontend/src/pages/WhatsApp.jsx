import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/common/Card'

export const WhatsAppPage = () => {
  const { api } = useAuth()
  const [numbers, setNumbers] = useState([])
  const [selectedNumberId, setSelectedNumberId] = useState('')
  const [qr, setQr] = useState('')
  const [qrStatus, setQrStatus] = useState('')
  const [qrIssue, setQrIssue] = useState(null)
  const [error, setError] = useState('')
  const [pollingQr, setPollingQr] = useState(false)
  const [newNumber, setNewNumber] = useState({ label: '' })

  const load = useCallback(async () => {
    try {
      const res = await api.get('/whatsapp')
      const data = res.data?.data?.numbers || res.data?.data || []
      setNumbers(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load numbers')
    }
  }, [api])

  useEffect(() => {
    load()
  }, [load])

  const addNumber = async (e) => {
    e.preventDefault()
    try {
      await api.post('/whatsapp', newNumber)
      setNewNumber({ label: '' })
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Add failed')
    }
  }

  const showQr = async (id) => {
    setSelectedNumberId(id)
    try {
      const res = await api.get(`/whatsapp/${id}/qr`)
      const payload = res.data?.data || {}
      setQr(payload?.qrCode || payload?.qr || '')
      setQrStatus(payload?.sessionStatus || '')
      setQrIssue(payload?.issue || null)
      const status = payload?.sessionStatus || ''
      setPollingQr(!payload?.qrCode && status !== 'connected' && status !== 'disconnected')
    } catch (err) {
      setError(err.response?.data?.error || 'QR fetch failed')
    }
  }

  useEffect(() => {
    if (!selectedNumberId || !pollingQr) return undefined
    const timer = setInterval(() => {
      showQr(selectedNumberId)
    }, 2500)
    return () => clearInterval(timer)
  }, [selectedNumberId, pollingQr])

  const disconnect = (id) => api.post(`/whatsapp/${id}/disconnect`).then(load)
  const reconnect = (id) => api.post(`/whatsapp/${id}/reconnect`).then(load)
  const remove = (id) => api.delete(`/whatsapp/${id}`).then(load)

  return (
    <div className="page active">
      <div className="section-title">WhatsApp Numbers</div>
      <div className="section-sub">Connect multiple numbers, view QR, reconnect sessions.</div>
      {error && <div className="badge red">{error}</div>}

      <div className="grid-2">
        <Card title="Add number">
          <form onSubmit={addNumber}>
            <div className="form-group">
              <label className="form-label">Label</label>
              <input
                className="form-input"
                value={newNumber.label}
                onChange={(e) => setNewNumber({ ...newNumber, label: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <button className="btn btn-primary" type="submit">
              Add number
            </button>
          </form>
        </Card>

        <Card title="QR / Status">
          {qr ? <img src={qr} alt="QR" style={{ maxWidth: '100%' }} /> : <div className="act-time">Select a number</div>}
          {qrStatus && <div className="cc-desc" style={{ marginTop: 8 }}>Status: {qrStatus}</div>}
          {pollingQr && !qr && <div className="act-time" style={{ marginTop: 8 }}>Generating QR… please wait</div>}
          {qrIssue?.reason && (
            <div className="badge red" style={{ marginTop: 8 }}>
              {qrIssue.reason}
              {qrIssue.actionableMessage ? ` ${qrIssue.actionableMessage}` : ''}
            </div>
          )}
        </Card>
      </div>

      <div className="camp-grid">
        {numbers.map((n) => (
          <div key={n.id} className="camp-card">
            <div className="cc-status-row">
              <span className="badge green">{n.sessionStatus}</span>
              <span className="cc-date">{n.createdAt}</span>
            </div>
            <div className="cc-name">{n.displayName || n.phoneNumber}</div>
            <div className="cc-desc">Device: {n.device || 'N/A'}</div>
            <div className="cc-actions">
              <button className="cc-btn" onClick={() => showQr(n.id)}>
                QR
              </button>
              <button className="cc-btn" onClick={() => reconnect(n.id)}>
                Reconnect
              </button>
              <button className="cc-btn" onClick={() => disconnect(n.id)}>
                Disconnect
              </button>
              <button className="cc-btn" onClick={() => remove(n.id)}>
                Delete
              </button>
            </div>
          </div>
        ))}
        {!numbers.length && <div className="cc-desc">No numbers yet</div>}
      </div>
    </div>
  )
}

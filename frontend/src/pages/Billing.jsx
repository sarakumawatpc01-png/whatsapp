import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/common/Card'

export const BillingPage = () => {
  const { api } = useAuth()
  const [plans, setPlans] = useState([])
  const [subscription, setSubscription] = useState(null)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const [p, s] = await Promise.all([api.get('/billing/plans'), api.get('/billing/subscription')])
      setPlans(p.data?.data || p.data || [])
      setSubscription(s.data?.data || s.data || null)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load billing')
    }
  }

  useEffect(() => {
    load()
  }, [load])

  const createOrder = async (planId) => {
    try {
      await api.post('/billing/create-order', { planId })
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Order failed')
    }
  }

  const cancel = async () => {
    await api.post('/billing/cancel')
    load()
  }

  return (
    <div className="page active">
      <div className="section-title">Billing & Plans</div>
      <div className="section-sub">Manage subscription, invoices and upgrades.</div>
      {error && <div className="badge red">{error}</div>}

      <Card title="Current subscription">
        {subscription ? (
          <div className="resp-time-row">
            <span className="resp-time-label">
              {subscription.planName} · {subscription.status}
            </span>
            <span className="resp-time-val">
              Renews {subscription.renewsAt || subscription.currentPeriodEnd || '—'}
            </span>
          </div>
        ) : (
          <div className="act-time">No active subscription</div>
        )}
        <div className="status-actions" style={{ marginTop: 8 }}>
          <button className="btn btn-danger" onClick={cancel}>
            Cancel subscription
          </button>
        </div>
      </Card>

      <div className="camp-grid">
        {plans.map((p) => (
          <div key={p.id} className="camp-card">
            <div className="cc-name">{p.name}</div>
            <div className="cc-desc">
              {p.description} · ₹{p.price}/mo · Limits: {p.messageLimit} msgs
            </div>
            <button className="btn btn-primary" onClick={() => createOrder(p.id)}>
              Choose plan
            </button>
          </div>
        ))}
        {!plans.length && <div className="cc-desc">No plans configured</div>}
      </div>
    </div>
  )
}

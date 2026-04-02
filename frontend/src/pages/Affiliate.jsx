import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/common/Card'

export const AffiliatePage = () => {
  const { api, role } = useAuth()
  const [dashboard, setDashboard] = useState(null)
  const [referrals, setReferrals] = useState([])
  const [earnings, setEarnings] = useState(null)
  const [error, setError] = useState('')

  const load = async () => {
    if (role !== 'affiliate') return
    try {
      const [d, r, e] = await Promise.all([
        api.get('/affiliate/dashboard'),
        api.get('/affiliate/referrals'),
        api.get('/affiliate/earnings'),
      ])
      setDashboard(d.data?.data || d.data)
      setReferrals(r.data?.data || r.data || [])
      setEarnings(e.data?.data || e.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load affiliate data')
    }
  }

  useEffect(() => {
    load()
  }, [load])

  const requestPayout = async () => {
    await api.post('/affiliate/payout/request')
    load()
  }

  if (role !== 'affiliate') {
    return (
      <div className="page active">
        <div className="section-title">Affiliate</div>
        <div className="section-sub">Login as affiliate from the auth page.</div>
      </div>
    )
  }

  return (
    <div className="page active">
      <div className="section-title">Affiliate Dashboard</div>
      <div className="section-sub">Track referrals and payouts.</div>
      {error && <div className="badge red">{error}</div>}

      <div className="grid-3">
        <Card title="Earnings">
          <div className="kpi-val">{earnings?.totalEarned ?? 0}</div>
          <div className="kpi-label">Total earned</div>
        </Card>
        <Card title="Pending">
          <div className="kpi-val">{earnings?.pending ?? 0}</div>
          <div className="kpi-label">Pending payout</div>
        </Card>
        <Card title="Referral link">
          <div className="ai-s-text">{dashboard?.referralLink || '—'}</div>
        </Card>
      </div>

      <Card title="Referrals">
        <div className="contacts-table">
          <div className="ct-head">
            <span />
            <span>Name</span>
            <span>Email</span>
            <span>Status</span>
            <span />
            <span />
          </div>
          {referrals.map((r) => (
            <div className="ct-row" key={r.id}>
              <input type="checkbox" className="ct-checkbox" />
              <div className="ct-name-cell">
                <div className="ct-av">{r.name?.[0] || 'R'}</div>
                <div>
                  <div className="ct-name">{r.name}</div>
                  <div className="ct-phone">{r.phone}</div>
                </div>
              </div>
              <div className="ct-label">{r.email}</div>
              <div className="ct-label">{r.status}</div>
              <div />
              <div />
            </div>
          ))}
          {!referrals.length && <div className="ct-row">No referrals</div>}
        </div>
      </Card>

      <div className="status-actions" style={{ marginTop: 12 }}>
        <button className="btn btn-primary" onClick={requestPayout}>
          Request payout
        </button>
      </div>
    </div>
  )
}

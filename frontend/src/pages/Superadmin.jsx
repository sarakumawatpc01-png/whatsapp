import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/common/Card'

export const SuperadminPage = () => {
  const { api, role } = useAuth()
  const [stats, setStats] = useState(null)
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')

  const load = async () => {
    if (role !== 'superadmin') return
    try {
      const [s, u] = await Promise.all([api.get('/superadmin/stats'), api.get('/superadmin/users')])
      setStats(s.data?.data || s.data)
      const usersData = u.data?.data || u.data || {}
      setUsers(usersData.data || usersData)
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

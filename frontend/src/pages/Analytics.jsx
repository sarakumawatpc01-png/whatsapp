import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/common/Card'

export const AnalyticsPage = () => {
  const { api } = useAuth()
  const [responseTimes, setResponseTimes] = useState([])
  const [labels, setLabels] = useState([])
  const [messagesByDay, setMessagesByDay] = useState([])
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const [rt, lb, msg] = await Promise.all([
        api.get('/analytics/response-times'),
        api.get('/analytics/labels'),
        api.get('/analytics/messages-by-day?days=14'),
      ])
      setResponseTimes(rt.data?.data?.rows || rt.data?.data || [])
      setLabels(lb.data?.data?.labels || lb.data?.labels || [])
      setMessagesByDay(msg.data?.data?.data || msg.data?.data || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load analytics')
    }
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="page active">
      <div className="section-title">Analytics</div>
      <div className="section-sub">Messages, response times, labels and trends.</div>
      {error && <div className="badge red">{error}</div>}

      <div className="analytics-grid">
        <Card title="Messages trend">
          <div className="chart-container">
            {messagesByDay.map((d) => (
              <div
                key={d.date}
                className="a-bar"
                style={{ height: Math.max(4, d.total * 2) }}
              >
                <div className="bar-tip">{d.total}</div>
                <div className="a-bar-label">{d.date.slice(5)}</div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Labels">
          {labels.map((l) => (
            <div className="resp-time-row" key={l.label}>
              <span className="resp-time-label">{l.label}</span>
              <span className="resp-time-val">{l.count}</span>
            </div>
          ))}
          {!labels.length && <div className="act-time">No label stats</div>}
        </Card>
      </div>

      <Card title="Response times (ms)">
        {responseTimes.map((r, idx) => (
          <div className="resp-time-row" key={idx}>
            <span className="resp-time-label">{r.label || r.bucket || 'Slot'}</span>
            <span className="resp-time-val">{r.value || r.avgMs}</span>
          </div>
        ))}
        {!responseTimes.length && <div className="act-time">No data</div>}
      </Card>
    </div>
  )
}

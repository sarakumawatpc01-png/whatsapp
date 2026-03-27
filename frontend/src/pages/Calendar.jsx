import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/common/Card'

export const CalendarPage = () => {
  const { api } = useAuth()
  const [status, setStatus] = useState(null)
  const [events, setEvents] = useState([])
  const [appointments, setAppointments] = useState([])
  const [newAppointment, setNewAppointment] = useState({
    title: '',
    startTime: '',
    endTime: '',
    contactId: '',
  })
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const [st, ev, appt] = await Promise.all([
        api.get('/calendar/status'),
        api.get('/calendar/events'),
        api.get('/calendar/appointments'),
      ])
      setStatus(st.data?.data || st.data)
      setEvents(ev.data?.data || ev.data || [])
      setAppointments(appt.data?.data || appt.data || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load calendar')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const connect = () => {
    window.location.href = `${api.defaults.baseURL.replace('/api', '')}/api/calendar/auth`
  }

  const disconnect = async () => {
    await api.delete('/calendar/disconnect')
    load()
  }

  const createAppointment = async (e) => {
    e.preventDefault()
    try {
      await api.post('/calendar/appointments', newAppointment)
      setNewAppointment({ title: '', startTime: '', endTime: '', contactId: '' })
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create appointment')
    }
  }

  return (
    <div className="page active">
      <div className="section-title">Calendar & Appointments</div>
      <div className="section-sub">Sync with Google Calendar, manage slots and bookings.</div>
      {error && <div className="badge red">{error}</div>}

      <div className="grid-2">
        <Card title="Connection">
          <div className="resp-time-row">
            <span className="resp-time-label">Status</span>
            <span className="resp-time-val">{status?.connected ? 'Connected' : 'Not connected'}</span>
          </div>
          <div className="status-actions" style={{ marginTop: 10 }}>
            <button className="btn btn-primary" onClick={connect}>
              Connect Google
            </button>
            <button className="btn btn-ghost" onClick={disconnect}>
              Disconnect
            </button>
          </div>
        </Card>

        <Card title="Create appointment">
          <form onSubmit={createAppointment}>
            <div className="form-group">
              <label className="form-label">Title</label>
              <input
                className="form-input"
                value={newAppointment.title}
                onChange={(e) => setNewAppointment({ ...newAppointment, title: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Start time (ISO)</label>
              <input
                className="form-input"
                value={newAppointment.startTime}
                onChange={(e) => setNewAppointment({ ...newAppointment, startTime: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">End time (ISO)</label>
              <input
                className="form-input"
                value={newAppointment.endTime}
                onChange={(e) => setNewAppointment({ ...newAppointment, endTime: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Contact ID</label>
              <input
                className="form-input"
                value={newAppointment.contactId}
                onChange={(e) => setNewAppointment({ ...newAppointment, contactId: e.target.value })}
              />
            </div>
            <button className="btn btn-primary" type="submit">
              Create
            </button>
          </form>
        </Card>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <Card title="Upcoming events">
          {events.map((e) => (
            <div className="activity-item" key={e.id || e.eventId}>
              <div className="act-dot" style={{ background: '#00E676' }} />
              <div className="act-text">
                {e.summary || e.title} <div className="act-time">{e.start?.dateTime || e.startTime}</div>
              </div>
            </div>
          ))}
          {!events.length && <div className="act-time">No events</div>}
        </Card>

        <Card title="Appointments">
          {appointments.map((a) => (
            <div className="activity-item" key={a.id}>
              <div className="act-dot" style={{ background: '#00BCD4' }} />
              <div className="act-text">
                {a.title || a.summary} <div className="act-time">{a.startTime}</div>
              </div>
            </div>
          ))}
          {!appointments.length && <div className="act-time">No appointments</div>}
        </Card>
      </div>
    </div>
  )
}

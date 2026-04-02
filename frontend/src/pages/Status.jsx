import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/common/Card'

export const StatusPage = () => {
  const { api } = useAuth()
  const [posts, setPosts] = useState([])
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const res = await api.get('/status')
      const data = res.data?.data || res.data || []
      setPosts(data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load status')
    }
  }

  useEffect(() => {
    load()
  }, [load])

  const publish = async () => {
    try {
      await api.post('/status', { text })
      setText('')
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Publish failed')
    }
  }

  const remove = async (id) => {
    await api.delete(`/status/${id}`)
    load()
  }

  return (
    <div className="page active">
      <div className="section-title">Status Posts</div>
      <div className="section-sub">Publish and schedule WhatsApp statuses.</div>
      {error && <div className="badge red">{error}</div>}

      <Card title="Compose">
        <textarea
          className="status-input"
          maxLength={700}
          placeholder="Write a status update..."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="status-actions">
          <button className="btn btn-primary" onClick={publish}>
            Post now
          </button>
          <div className="status-char">{text.length}/700</div>
        </div>
      </Card>

      <div className="prev-statuses">
        <div className="ps-head">Recent posts</div>
        {posts.map((p) => (
          <div className="ps-item" key={p.id}>
            <div className="ps-bubble">{p.text}</div>
            <div>
              <div className="ps-time">{p.createdAt}</div>
              <div className="ps-views">{p.views || 0} views</div>
            </div>
            <button className="btn btn-ghost" onClick={() => remove(p.id)}>
              Delete
            </button>
          </div>
        ))}
        {!posts.length && <div className="ps-item">No posts yet</div>}
      </div>
    </div>
  )
}

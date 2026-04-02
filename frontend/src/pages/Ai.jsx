import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Card } from '../components/common/Card'

export const AiPage = () => {
  const { api } = useAuth()
  const [config, setConfig] = useState(null)
  const [docs, setDocs] = useState([])
  const [testPrompt, setTestPrompt] = useState('')
  const [testResponse, setTestResponse] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const [cfg, documents] = await Promise.all([api.get('/ai/config'), api.get('/ai/docs')])
      setConfig(cfg.data?.data || cfg.data)
      setDocs(documents.data?.data || documents.data || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load AI settings')
    }
  }

  useEffect(() => {
    load()
  }, [load])

  const saveConfig = async (e) => {
    e.preventDefault()
    try {
      await api.patch('/ai/config', config)
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Save failed')
    }
  }

  const uploadDoc = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    try {
      await api.post('/ai/docs', form, { headers: { 'Content-Type': 'multipart/form-data' } })
      load()
    } catch (err) {
      setError(err.response?.data?.error || 'Upload failed')
    }
  }

  const deleteDoc = async (id) => {
    try {
      await api.delete(`/ai/docs/${id}`)
      setDocs((prev) => prev.filter((d) => d.id !== id))
    } catch (err) {
      setError(err.response?.data?.error || 'Delete failed')
    }
  }

  const testAi = async () => {
    try {
      const res = await api.post('/ai/test', { prompt: testPrompt })
      setTestResponse(res.data?.data?.reply || res.data?.reply || JSON.stringify(res.data))
    } catch (err) {
      setError(err.response?.data?.error || 'Test failed')
    }
  }

  if (!config) {
    return <div className="page active">Loading AI settings...</div>
  }

  return (
    <div className="page active">
      <div className="section-title">AI Agent</div>
      <div className="section-sub">Configure provider, persona, instructions and knowledge docs.</div>
      {error && <div className="badge red">{error}</div>}

      <div className="grid-2">
        <Card title="Configuration">
          <form onSubmit={saveConfig}>
            <div className="form-group">
              <label className="form-label">Provider / Model</label>
              <select
                className="form-input"
                value={config.provider}
                onChange={(e) => setConfig({ ...config, provider: e.target.value })}
              >
                <option value="claude">Claude</option>
                <option value="openai">OpenAI</option>
                <option value="deepseek">DeepSeek</option>
                <option value="samas">Sarvam</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Business context</label>
              <textarea
                className="form-input"
                rows={4}
                value={config.businessContext || ''}
                onChange={(e) => setConfig({ ...config, businessContext: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Tone</label>
              <input
                className="form-input"
                value={config.tone || ''}
                onChange={(e) => setConfig({ ...config, tone: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Language</label>
              <input
                className="form-input"
                value={config.language || ''}
                onChange={(e) => setConfig({ ...config, language: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Custom instructions</label>
              <textarea
                className="form-input"
                rows={3}
                value={config.customInstructions || ''}
                onChange={(e) => setConfig({ ...config, customInstructions: e.target.value })}
              />
            </div>
            <button className="btn btn-primary" type="submit">
              Save configuration
            </button>
          </form>
        </Card>

        <Card title="Knowledge docs">
          <div className="status-actions">
            <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
              Upload PDF/TXT
              <input type="file" hidden onChange={uploadDoc} />
            </label>
          </div>
          <div style={{ marginTop: 10 }}>
            {docs.map((d) => (
              <div className="status-actions" key={d.id}>
                <div>{d.filename}</div>
                <button className="btn btn-danger" onClick={() => deleteDoc(d.id)}>
                  Delete
                </button>
              </div>
            ))}
            {!docs.length && <div className="act-time">No docs uploaded</div>}
          </div>
        </Card>
      </div>

      <Card title="Test AI Reply">
        <div className="form-group">
          <label className="form-label">Prompt</label>
          <textarea
            className="form-input"
            rows={3}
            value={testPrompt}
            onChange={(e) => setTestPrompt(e.target.value)}
          />
        </div>
        <div className="status-actions">
          <button className="btn btn-primary" onClick={testAi}>
            Generate reply
          </button>
        </div>
        {testResponse && (
          <div className="ai-s-text" style={{ marginTop: 10 }}>
            {testResponse}
          </div>
        )}
      </Card>
    </div>
  )
}

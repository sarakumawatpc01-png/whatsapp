import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useAuth } from '../context/AuthContext'
import { useSocket } from '../hooks/useSocket'

dayjs.extend(relativeTime)

export const InboxPage = () => {
  const { api } = useAuth()
  const { socket } = useSocket(true)
  const [conversations, setConversations] = useState([])
  const [selected, setSelected] = useState(null)
  const [messages, setMessages] = useState([])
  const [messageText, setMessageText] = useState('')
  const [aiSuggestion, setAiSuggestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const loadConversations = async () => {
    try {
      const res = await api.get('/messages/conversations')
      const data = res.data?.data || res.data?.results || res.data
      setConversations(data?.data || data || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load inbox')
    }
  }

  const loadMessages = async (contactId) => {
    if (!contactId) return
    setLoading(true)
    try {
      const res = await api.get(`/messages/contact/${contactId}?limit=50`)
      const data = res.data?.data || res.data?.results || res.data
      setMessages(data?.data || data || [])
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load messages')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadConversations()
  }, [])

  useEffect(() => {
    if (!socket) return
    socket.on('message:new', (msg) => {
      if (selected && msg.contactId === selected.id) {
        setMessages((prev) => [...prev, msg])
      }
      loadConversations()
    })
    return () => {
      socket?.off('message:new')
    }
  }, [socket, selected])

  const handleSend = async () => {
    if (!messageText.trim() || !selected) return
    try {
      await api.post('/messages/send/text', {
        numberId: selected.numberId,
        toJid: selected.waJid || `${selected.phoneNumber}@s.whatsapp.net`,
        contactId: selected.id,
        message: messageText.trim(),
      })
      setMessageText('')
      await loadMessages(selected.id)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to send message')
    }
  }

  const handleAiSuggestion = async () => {
    if (!selected) return
    try {
      const res = await api.post(`/messages/ai/suggestion/${selected.id}`)
      setAiSuggestion(res.data?.data?.suggestion || res.data?.suggestion || '')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch suggestion')
    }
  }

  return (
    <div id="inbox-page" className="page active">
      <div className="inbox-shell">
        <div className="cl-panel">
          <div className="cl-top">
            <div className="cl-top-row">
              <div className="cl-heading">Conversations</div>
              <button className="cl-new-btn" onClick={loadConversations}>
                Refresh
              </button>
            </div>
            <div className="cl-search">
              <span role="img" aria-label="search">
                🔍
              </span>
              <input placeholder="Search name or number" />
            </div>
          </div>
          <div className="cl-list">
            {conversations.map((c) => (
              <div
                key={c.id}
                className={`ci ${selected?.id === c.id ? 'active' : ''}`}
                onClick={() => {
                  setSelected(c)
                  loadMessages(c.id)
                }}
              >
                <div className="ci-av" style={{ background: '#00E676' }}>
                  {c.name?.[0]?.toUpperCase() || 'C'}
                </div>
                <div className="ci-info">
                  <div className="ci-name">
                    <span>
                      {c.name}
                      {c.aiEnabled && <span className="ci-num-tag">AI</span>}
                    </span>
                    <span className="ci-time">
                      {c.lastMessageAt ? dayjs(c.lastMessageAt).fromNow() : ''}
                    </span>
                  </div>
                  <div className="ci-preview">
                    <span>{c.lastMessage?.body || 'No messages yet'}</span>
                    {c.unreadCount > 0 && <span className="ci-unread">{c.unreadCount}</span>}
                  </div>
                </div>
              </div>
            ))}
            {!conversations.length && <div className="act-time" style={{ padding: 12 }}>No conversations yet</div>}
          </div>
        </div>

        <div className="chat-panel">
          {selected ? (
            <>
              <div className="cp-head">
                <div className="cp-av">{selected.name?.[0]?.toUpperCase()}</div>
                <div>
                  <div className="cp-name">{selected.name}</div>
                  <div className="cp-status">{selected.label || selected.phoneNumber}</div>
                </div>
                <div className="cp-actions">
                  <button className={`cp-act-btn ${selected.aiEnabled ? 'ai-on' : ''}`}>
                    AI {selected.aiEnabled ? 'On' : 'Off'}
                  </button>
                </div>
              </div>

              <div className="msgs">
                {loading && <div className="system-msg">Loading...</div>}
                {messages.map((m) => (
                  <div
                    key={m.id || m.timestamp}
                    className={`msg-row ${m.direction === 'outbound' ? 'out' : 'in'}`}
                  >
                    <div className="msg-bubble">{m.body}</div>
                    <div className="msg-meta">
                      <span>{dayjs(m.timestamp).format('HH:mm')}</span>
                      {m.aiSent && <span className="ai-sent-tag">AI sent</span>}
                    </div>
                  </div>
                ))}
              </div>

              <div className="ai-suggest-bar">
                <div className="ai-s-label">AI suggestion</div>
                <div className="ai-s-text" onClick={() => setMessageText(aiSuggestion)}>
                  {aiSuggestion || 'Click "Generate" to fetch a suggested reply'}
                </div>
                <div className="status-actions" style={{ marginTop: 8 }}>
                  <button className="btn btn-ghost" onClick={handleAiSuggestion}>
                    Generate
                  </button>
                </div>
              </div>

              <div className="attach-row">
                <div className="attach-btn">📎 Media</div>
                <div className="attach-btn">📍 Location</div>
                <div className="attach-btn">📊 Poll</div>
              </div>

              <div className="chat-input-area">
                <div className="chat-input-row">
                  <textarea
                    className="chat-ta"
                    rows={2}
                    placeholder="Type a message"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                  />
                  <button className="send-btn" onClick={handleSend}>
                    ➤
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="system-msg" style={{ padding: 40 }}>
              Select a conversation to start
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

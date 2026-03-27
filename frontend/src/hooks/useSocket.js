import { useEffect, useMemo, useState } from 'react'
import { io } from 'socket.io-client'
import { useAuth } from '../context/AuthContext'

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL?.replace(/\/$/, '') || 'http://localhost:5000'

export const useSocket = (enabled = true) => {
  const { tokens } = useAuth()
  const [socket, setSocket] = useState(null)
  const [connected, setConnected] = useState(false)

  const authToken = tokens?.accessToken

  useEffect(() => {
    if (!enabled || !authToken) {
      if (socket) socket.disconnect()
      setSocket(null)
      setConnected(false)
      return
    }

    const client = io(SOCKET_URL, {
      transports: ['websocket'],
      auth: { token: authToken },
    })

    client.on('connect', () => setConnected(true))
    client.on('disconnect', () => setConnected(false))

    setSocket(client)

    return () => {
      client.disconnect()
    }
  }, [enabled, authToken])

  return useMemo(
    () => ({
      socket,
      connected,
    }),
    [socket, connected],
  )
}

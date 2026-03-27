import { useEffect, useMemo, useState } from 'react'
import { io } from 'socket.io-client'
import { useAuth } from '../context/AuthContext'

export const useSocket = (enabled = true) => {
  const { tokens } = useAuth()
  const [socket, setSocket] = useState(null)
  const [connected, setConnected] = useState(false)
  const socketUrl =
    import.meta.env.VITE_SOCKET_URL?.replace(/\/$/, '') || 'http://localhost:5000'

  const authToken = tokens?.accessToken

  useEffect(() => {
    if (!enabled || !authToken) {
      if (socket) socket.disconnect()
      setSocket(null)
      setConnected(false)
      return
    }

    const client = io(socketUrl, {
      transports: ['websocket'],
      auth: { token: authToken },
    })

    client.on('connect', () => setConnected(true))
    client.on('disconnect', () => setConnected(false))

    setSocket(client)

    return () => {
      client.disconnect()
    }
  }, [enabled, authToken, socketUrl])

  return useMemo(
    () => ({
      socket,
      connected,
    }),
    [socket, connected],
  )
}

import axios from 'axios'

export const defaultBaseURL =
  import.meta.env.VITE_API_URL?.replace(/\/$/, '') || 'http://localhost:5000/api'

export const createApiClient = ({ getTokens, role, onTokens, onLogout }) => {
  const instance = axios.create({
    baseURL: defaultBaseURL,
  })

  instance.interceptors.request.use((config) => {
    const tokens = getTokens?.()
    if (tokens?.accessToken) {
      config.headers.Authorization = `Bearer ${tokens.accessToken}`
    }
    return config
  })

  instance.interceptors.response.use(
    (res) => res,
    async (error) => {
      const status = error.response?.status
      const tokens = getTokens?.()
      const originalRequest = error.config

      if (status === 401 && tokens?.refreshToken && !originalRequest._retry) {
        originalRequest._retry = true
        try {
          const refreshPath =
            role === 'superadmin'
              ? '/superadmin/refresh'
              : role === 'affiliate'
                ? '/affiliate/refresh'
                : '/auth/refresh-token'

          const payload = { refreshToken: tokens.refreshToken }

          const refreshRes = await axios.post(`${defaultBaseURL}${refreshPath}`, payload)
          const newAccess =
            refreshRes.data?.accessToken ||
            refreshRes.data?.token ||
            refreshRes.data?.data?.accessToken ||
            refreshRes.data?.data?.token
          const newRefresh =
            refreshRes.data?.refreshToken ||
            refreshRes.data?.data?.refreshToken ||
            tokens.refreshToken

          if (newAccess) {
            onTokens?.({ accessToken: newAccess, refreshToken: newRefresh })
            originalRequest.headers.Authorization = `Bearer ${newAccess}`
            return instance(originalRequest)
          }
        } catch (refreshErr) {
          onLogout?.()
        }
      }

      return Promise.reject(error)
    },
  )

  return instance
}

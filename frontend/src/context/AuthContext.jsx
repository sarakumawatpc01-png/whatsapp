import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import axios from 'axios'
import { createApiClient, defaultBaseURL } from '../api/client'

const AuthContext = createContext(null)

const storageKey = 'waizai_auth'

export const AuthProvider = ({ children }) => {
  const [tokens, setTokens] = useState(() => {
    const stored = localStorage.getItem(storageKey)
    return stored ? JSON.parse(stored).tokens : null
  })
  const [role, setRole] = useState(() => {
    const stored = localStorage.getItem(storageKey)
    return stored ? JSON.parse(stored).role : null
  })
  const [profile, setProfile] = useState(() => {
    const stored = localStorage.getItem(storageKey)
    return stored ? JSON.parse(stored).profile : null
  })
  const [loading, setLoading] = useState(false)

  const persist = useCallback(
    (nextTokens, nextRole, nextProfile) => {
      if (!nextTokens) {
        localStorage.removeItem(storageKey)
        setTokens(null)
        setRole(nextRole ?? null)
        setProfile(nextProfile ?? null)
        return
      }

      const payload = {
        tokens: nextTokens,
        role: nextRole ?? role,
        profile: nextProfile ?? profile,
      }
      localStorage.setItem(storageKey, JSON.stringify(payload))
      setTokens(nextTokens)
      setRole(payload.role)
      setProfile(payload.profile)
    },
    [profile, role],
  )

  const logout = useCallback(() => {
    persist(null, null, null)
  }, [persist])

  const api = useMemo(
    () =>
      createApiClient({
        getTokens: () => tokens,
        role,
        onTokens: (next) => persist(next, role, profile),
        onLogout: logout,
      }),
    [tokens, role, persist, profile, logout],
  )

  const login = useCallback(
    async ({ email, password }) => {
      setLoading(true)
      try {
        const { data } = await axios.post(`${defaultBaseURL}/auth/login`, { email, password })
        const accessToken = data?.accessToken || data?.data?.accessToken
        const refreshToken = data?.refreshToken || data?.data?.refreshToken
        const tenant = data?.tenant || data?.data?.tenant
        persist({ accessToken, refreshToken }, 'tenant', tenant)
        return tenant
      } finally {
        setLoading(false)
      }
    },
    [persist],
  )

  const register = useCallback(
    async (payload) => {
      setLoading(true)
      try {
        const { data } = await axios.post(`${defaultBaseURL}/auth/register`, payload)
        return data
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const verifyEmail = useCallback(
    async ({ email, otp }) => {
      return axios.post(`${defaultBaseURL}/auth/verify-email`, { email, otp })
    },
    [],
  )

  const loginSuperAdmin = useCallback(
    async ({ email, password, slug }) => {
      setLoading(true)
      try {
        const endpointSlug = slug || import.meta.env.VITE_SUPERADMIN_SLUG || 'superadmin'
        const { data } = await axios.post(
          `${defaultBaseURL}/superadmin/${endpointSlug}/login`,
          { email, password },
        )
        const accessToken = data?.accessToken || data?.data?.accessToken
        const refreshToken = data?.refreshToken || data?.data?.refreshToken
        const admin = data?.admin || data?.data?.admin
        persist({ accessToken, refreshToken }, 'superadmin', admin)
        return admin
      } finally {
        setLoading(false)
      }
    },
    [persist],
  )

  const loginAffiliate = useCallback(
    async ({ email, password }) => {
      setLoading(true)
      try {
        const { data } = await axios.post(`${defaultBaseURL}/affiliate/login`, {
          email,
          password,
        })
        const accessToken = data?.accessToken || data?.data?.accessToken
        const refreshToken = data?.refreshToken || data?.data?.refreshToken
        const affiliate = data?.affiliate || data?.data?.affiliate
        persist({ accessToken, refreshToken }, 'affiliate', affiliate)
        return affiliate
      } finally {
        setLoading(false)
      }
    },
    [persist],
  )

  return (
    <AuthContext.Provider
      value={{
        tokens,
        role,
        profile,
        loading,
        api,
        login,
        register,
        verifyEmail,
        loginSuperAdmin,
        loginAffiliate,
        logout,
        setProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

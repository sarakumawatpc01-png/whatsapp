import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const Input = ({ label, ...rest }) => (
  <div className="form-group">
    <label className="form-label">{label}</label>
    <input className="form-input" {...rest} />
  </div>
)

export const AuthPage = () => {
  const { login, register, verifyEmail, loginSuperAdmin, loginAffiliate, loading } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [feedback, setFeedback] = useState('')

  const [form, setForm] = useState({
    email: '',
    password: '',
    businessName: '',
    ownerName: '',
    phone: '',
    otp: '',
    slug: '',
  })

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }))

  const handleTenantLogin = async (e) => {
    e.preventDefault()
    setFeedback('')
    try {
      await login({ email: form.email, password: form.password })
      navigate('/dashboard')
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Login failed')
    }
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setFeedback('')
    try {
      await register({
        ownerName: form.ownerName,
        businessName: form.businessName,
        email: form.email,
        phone: form.phone,
        password: form.password,
      })
      setFeedback('Registered. Please verify your email OTP.')
      setMode('verify')
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Registration failed')
    }
  }

  const handleVerify = async (e) => {
    e.preventDefault()
    setFeedback('')
    try {
      await verifyEmail({ email: form.email, otp: form.otp })
      setFeedback('Email verified. You can login now.')
      setMode('login')
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Verification failed')
    }
  }

  const handleSuperAdmin = async (e) => {
    e.preventDefault()
    setFeedback('')
    try {
      await loginSuperAdmin({ email: form.email, password: form.password, slug: form.slug })
      navigate('/superadmin')
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Superadmin login failed')
    }
  }

  const handleAffiliate = async (e) => {
    e.preventDefault()
    setFeedback('')
    try {
      await loginAffiliate({ email: form.email, password: form.password })
      navigate('/affiliate')
    } catch (err) {
      setFeedback(err.response?.data?.error || 'Affiliate login failed')
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-layout">
        <div className="auth-side">
          <div>
            <div className="badge green">Unified login</div>
            <h2>WaizAI Platform Access</h2>
            <p>
              Use tenant mode for daily operations, superadmin mode for platform control, and affiliate mode for
              partner workflows.
            </p>
            <div className="auth-points">
              <div className="auth-point">
                <span className="dot" /> Superadmin controls users, plans, settings and APIs
              </div>
              <div className="auth-point">
                <span className="dot" /> Tenant login for daily WhatsApp operations
              </div>
              <div className="auth-point">
                <span className="dot" /> Affiliate login for partner workflows
              </div>
            </div>
          </div>
          <div className="act-time">Secure session with role-based routing</div>
        </div>

        <div className="card auth-card">
          <div className="card-head">
            <div className="card-title">Welcome to WaizAI</div>
            <div className="badge green">Secure login</div>
          </div>

          <div className="auth-mode-tabs">
            <button
              className={`tb-btn ghost ${mode === 'login' ? 'primary' : ''}`}
              onClick={() => setMode('login')}
            >
              Tenant Login
            </button>
            <button
              className={`tb-btn ghost ${mode === 'register' ? 'primary' : ''}`}
              onClick={() => setMode('register')}
            >
              Register
            </button>
            <button
              className={`tb-btn ghost ${mode === 'verify' ? 'primary' : ''}`}
              onClick={() => setMode('verify')}
            >
              Verify Email
            </button>
            <button
              className={`tb-btn ghost ${mode === 'superadmin' ? 'primary' : ''}`}
              onClick={() => setMode('superadmin')}
            >
              Superadmin
            </button>
            <button
              className={`tb-btn ghost ${mode === 'affiliate' ? 'primary' : ''}`}
              onClick={() => setMode('affiliate')}
            >
              Affiliate
            </button>
          </div>

          {mode === 'login' && (
            <form onSubmit={handleTenantLogin}>
              <Input
                label="Email"
                type="email"
                required
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
              />
              <Input
                label="Password"
                type="password"
                required
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
              />
              <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          )}

          {mode === 'register' && (
            <form onSubmit={handleRegister}>
              <Input
                label="Owner Name"
                required
                value={form.ownerName}
                onChange={(e) => update('ownerName', e.target.value)}
              />
              <Input
                label="Business Name"
                required
                value={form.businessName}
                onChange={(e) => update('businessName', e.target.value)}
              />
              <Input
                label="Email"
                type="email"
                required
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
              />
              <Input
                label="Phone"
                required
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
              />
              <Input
                label="Password"
                type="password"
                required
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
              />
              <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
                {loading ? 'Creating...' : 'Create account'}
              </button>
            </form>
          )}

          {mode === 'verify' && (
            <form onSubmit={handleVerify}>
              <Input
                label="Email"
                type="email"
                required
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
              />
              <Input
                label="Email OTP"
                required
                value={form.otp}
                onChange={(e) => update('otp', e.target.value)}
              />
              <button className="btn btn-primary" type="submit" style={{ width: '100%' }}>
                Verify
              </button>
            </form>
          )}

          {mode === 'superadmin' && (
            <form onSubmit={handleSuperAdmin}>
              <Input
                label="Slug"
                placeholder="superadmin"
                value={form.slug}
                onChange={(e) => update('slug', e.target.value)}
              />
              <Input
                label="Email"
                type="email"
                required
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
              />
              <Input
                label="Password"
                type="password"
                required
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
              />
              <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
                {loading ? 'Signing in...' : 'Login as Superadmin'}
              </button>
            </form>
          )}

          {mode === 'affiliate' && (
            <form onSubmit={handleAffiliate}>
              <Input
                label="Email"
                type="email"
                required
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
              />
              <Input
                label="Password"
                type="password"
                required
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
              />
              <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>
                {loading ? 'Signing in...' : 'Login as Affiliate'}
              </button>
            </form>
          )}

          {feedback && (
            <div
              className="badge orange"
              style={{ marginTop: 12, justifyContent: 'center', width: '100%', textAlign: 'center' }}
            >
              {feedback}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const rateLimit = require('express-rate-limit');

function parseIntOr(defaultValue, value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

const limiterDefaults = {
  standardHeaders: true,
  legacyHeaders: false,
};

// General API rate limit
const apiLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: parseIntOr(15 * 60 * 1000, process.env.RATE_LIMIT_WINDOW_MS),
  max: parseIntOr(100, process.env.RATE_LIMIT_MAX),
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.path === '/health' || req.path.startsWith('/webhooks'),
});

// Strict limit for auth endpoints
const authLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, account locked for 15 minutes.' },
  skipSuccessfulRequests: true,
});

// OTP limit
const otpLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: 10 * 60 * 1000,
  max: 3,
  message: { error: 'Too many OTP requests. Try again in 10 minutes.' },
});

// Stricter superadmin login limit
const adminAuthLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many admin login attempts. Try again later.' },
  skipSuccessfulRequests: true,
});

// Stricter limit for superadmin operations
const adminApiLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many admin requests, please try again later.' },
});

module.exports = { apiLimiter, authLimiter, otpLimiter, adminAuthLimiter, adminApiLimiter };

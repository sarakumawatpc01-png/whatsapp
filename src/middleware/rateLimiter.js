// src/middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');
const { getRedis } = require('../config/redis');

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Strict limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, account locked for 15 minutes.' },
  skipSuccessfulRequests: true,
});

// OTP limit
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  message: { error: 'Too many OTP requests. Try again in 10 minutes.' },
});

module.exports = { apiLimiter, authLimiter, otpLimiter };

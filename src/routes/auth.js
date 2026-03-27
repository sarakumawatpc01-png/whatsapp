// src/routes/auth.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const {
  register, verifyEmailOTP, resendEmailOTP,
  login, refreshToken, logout,
  forgotPassword, resetPassword, changePassword,
  getMe, giveConsent,
} = require('../controllers/authController');

// ── PUBLIC ─────────────────────────────────────────────────────
router.post('/register',            authLimiter, register);
router.post('/login',               authLimiter, login);
router.post('/refresh-token',       refreshToken);
router.post('/forgot-password',     authLimiter, forgotPassword);
router.post('/reset-password',      authLimiter, resetPassword);

// ── OTP ────────────────────────────────────────────────────────
router.post('/verify-email',        otpLimiter, verifyEmailOTP);
router.post('/resend-email-otp',    otpLimiter, resendEmailOTP);

// ── PROTECTED ──────────────────────────────────────────────────
router.use(protect);
router.post('/logout',              logout);
router.post('/change-password',     changePassword);
router.get('/me',                   getMe);
router.post('/consent',             giveConsent);

module.exports = router;

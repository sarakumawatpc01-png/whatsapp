const router = require('express').Router();
const { body } = require('express-validator');
const { protect } = require('../middleware/auth');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../utils/requestValidation');
const {
  register, verifyEmailOTP, resendEmailOTP,
  login, refreshToken, logout,
  forgotPassword, resetPassword, changePassword,
  getMe, giveConsent,
} = require('../controllers/authController');

const emailField = body('email').isEmail().withMessage('Valid email is required').normalizeEmail();

// ── PUBLIC ─────────────────────────────────────────────────────
router.post(
  '/register',
  authLimiter,
  [
    body('ownerName').trim().notEmpty().withMessage('ownerName is required'),
    body('businessName').trim().notEmpty().withMessage('businessName is required'),
    emailField,
    body('phone').trim().isLength({ min: 8, max: 20 }).withMessage('Valid phone is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('affiliateCode').optional().trim().isLength({ min: 3, max: 64 }).withMessage('Invalid affiliateCode'),
    validate,
  ],
  register
);

router.post(
  '/login',
  authLimiter,
  [emailField, body('password').isString().notEmpty().withMessage('Password is required'), validate],
  login
);

router.post('/refresh-token', [body('refreshToken').optional().isString(), validate], refreshToken);

router.post('/forgot-password', authLimiter, [emailField, validate], forgotPassword);

router.post(
  '/reset-password',
  authLimiter,
  [
    body('token').isString().notEmpty().withMessage('Token is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    validate,
  ],
  resetPassword
);

// ── OTP ────────────────────────────────────────────────────────
router.post(
  '/verify-email',
  otpLimiter,
  [emailField, body('otp').isLength({ min: 4, max: 10 }).withMessage('Valid OTP is required'), validate],
  verifyEmailOTP
);

router.post('/resend-email-otp', otpLimiter, [emailField, validate], resendEmailOTP);

// ── PROTECTED ──────────────────────────────────────────────────
router.use(protect);
router.post('/logout', [body('refreshToken').optional().isString(), validate], logout);
router.post(
  '/change-password',
  [
    body('currentPassword').isString().notEmpty().withMessage('currentPassword is required'),
    body('newPassword').isLength({ min: 8 }).withMessage('newPassword must be at least 8 characters'),
    validate,
  ],
  changePassword
);
router.get('/me', getMe);
router.post('/consent', giveConsent);

module.exports = router;

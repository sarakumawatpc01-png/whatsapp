const router = require('express').Router();
const { body } = require('express-validator');
const { protectAffiliate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../utils/requestValidation');
const {
  affiliateLogin, affiliateRefresh,
  getDashboard, getReferrals, getEarnings,
  requestPayout, getPayoutHistory, getMarketingMaterials,
} = require('../controllers/affiliateController');

// ── PUBLIC ─────────────────────────────────────────────────────
router.post(
  '/login',
  authLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').isString().notEmpty().withMessage('Password is required'),
    validate,
  ],
  affiliateLogin
);
router.post('/refresh', [body('refreshToken').isString().notEmpty().withMessage('refreshToken is required'), validate], affiliateRefresh);

// ── PROTECTED ──────────────────────────────────────────────────
router.use(protectAffiliate);

router.get('/dashboard',            getDashboard);
router.get('/referrals',            getReferrals);
router.get('/earnings',             getEarnings);
router.post('/payout/request',      requestPayout);
router.get('/payout/history',       getPayoutHistory);
router.get('/marketing-materials',  getMarketingMaterials);

module.exports = router;

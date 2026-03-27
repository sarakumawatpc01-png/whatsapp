// src/routes/affiliate.js
const router = require('express').Router();
const { protectAffiliate } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiter');
const {
  affiliateLogin, affiliateRefresh,
  getDashboard, getReferrals, getEarnings,
  requestPayout, getPayoutHistory, getMarketingMaterials,
} = require('../controllers/affiliateController');

// ── PUBLIC ─────────────────────────────────────────────────────
router.post('/login',   authLimiter, affiliateLogin);
router.post('/refresh', affiliateRefresh);

// ── PROTECTED ──────────────────────────────────────────────────
router.use(protectAffiliate);

router.get('/dashboard',            getDashboard);
router.get('/referrals',            getReferrals);
router.get('/earnings',             getEarnings);
router.post('/payout/request',      requestPayout);
router.get('/payout/history',       getPayoutHistory);
router.get('/marketing-materials',  getMarketingMaterials);

module.exports = router;

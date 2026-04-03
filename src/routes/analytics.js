// src/routes/analytics.js
const router = require('express').Router();
const { query } = require('express-validator');
const { protect } = require('../middleware/auth');
const { validate } = require('../utils/requestValidation');
const {
  getDashboardStats, getMessagesByDay, getTopContacts,
  getCampaignStats, getFollowupStats, getApiUsage,
  getResponseTimes, getLabelBreakdown,
} = require('../controllers/analyticsController');

router.use(protect);

router.get('/dashboard',        getDashboardStats);
router.get(
  '/messages-by-day',
  [query('days').optional().isInt({ min: 1, max: 365 }).withMessage('days must be between 1 and 365'), validate],
  getMessagesByDay
);
router.get(
  '/top-contacts',
  [query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'), validate],
  getTopContacts
);
router.get('/campaigns',        getCampaignStats);
router.get('/followups',        getFollowupStats);
router.get('/api-usage',        getApiUsage);
router.get('/response-times',   getResponseTimes);
router.get('/labels',           getLabelBreakdown);

module.exports = router;

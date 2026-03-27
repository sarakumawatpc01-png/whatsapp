// src/routes/analytics.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const {
  getDashboardStats, getMessagesByDay, getTopContacts,
  getCampaignStats, getFollowupStats, getApiUsage,
  getResponseTimes, getLabelBreakdown,
} = require('../controllers/analyticsController');

router.use(protect);

router.get('/dashboard',        getDashboardStats);
router.get('/messages-by-day',  getMessagesByDay);
router.get('/top-contacts',     getTopContacts);
router.get('/campaigns',        getCampaignStats);
router.get('/followups',        getFollowupStats);
router.get('/api-usage',        getApiUsage);
router.get('/response-times',   getResponseTimes);
router.get('/labels',           getLabelBreakdown);

module.exports = router;

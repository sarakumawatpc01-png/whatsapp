// src/routes/tenant.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const {
  getProfile, updateProfile, getUsage,
} = require('../controllers/tenantController');

router.use(protect);

router.get('/profile',    getProfile);
router.patch('/profile',  updateProfile);
router.get('/usage',      getUsage);

module.exports = router;

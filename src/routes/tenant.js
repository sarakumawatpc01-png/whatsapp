// src/routes/tenant.js
const router = require('express').Router();
const { body } = require('express-validator');
const { protect } = require('../middleware/auth');
const { validate } = require('../utils/requestValidation');
const {
  getProfile, updateProfile, getUsage,
} = require('../controllers/tenantController');

router.use(protect);

router.get('/profile',    getProfile);
router.patch(
  '/profile',
  [
    body('ownerName').optional().isString().trim().isLength({ min: 1, max: 120 }).withMessage('ownerName is invalid'),
    body('businessName').optional().isString().trim().isLength({ min: 1, max: 120 }).withMessage('businessName is invalid'),
    body('phone').optional().isString().trim().isLength({ min: 7, max: 20 }).withMessage('phone is invalid'),
    validate,
  ],
  updateProfile
);
router.get('/usage',      getUsage);

module.exports = router;

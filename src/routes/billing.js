// src/routes/billing.js
const router = require('express').Router();
const { body, query } = require('express-validator');
const { protect } = require('../middleware/auth');
const { validate } = require('../utils/requestValidation');
const {
  getPlans, getCurrentSubscription, createOrder,
  verifyPayment, cancelSubscription, getInvoices,
  getBillingHistory,
} = require('../controllers/billingController');

router.use(protect);

router.get('/plans',                    getPlans);
router.get('/subscription',             getCurrentSubscription);
router.get('/invoices',                 getInvoices);
router.get(
  '/history',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    validate,
  ],
  getBillingHistory
);
router.post('/create-order',            [body('planId').isUUID().withMessage('planId is required'), validate], createOrder);
router.post(
  '/verify-payment',
  [
    body('razorpay_order_id').isString().trim().notEmpty().withMessage('razorpay_order_id is required'),
    body('razorpay_payment_id').isString().trim().notEmpty().withMessage('razorpay_payment_id is required'),
    body('razorpay_signature').isString().trim().notEmpty().withMessage('razorpay_signature is required'),
    body('planId').isUUID().withMessage('planId is required'),
    validate,
  ],
  verifyPayment
);
router.post('/cancel',                  cancelSubscription);

module.exports = router;

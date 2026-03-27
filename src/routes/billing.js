// src/routes/billing.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const {
  getPlans, getCurrentSubscription, createOrder,
  verifyPayment, cancelSubscription, getInvoices,
  getBillingHistory,
} = require('../controllers/billingController');

router.use(protect);

router.get('/plans',                    getPlans);
router.get('/subscription',             getCurrentSubscription);
router.get('/invoices',                 getInvoices);
router.get('/history',                  getBillingHistory);
router.post('/create-order',            createOrder);
router.post('/verify-payment',          verifyPayment);
router.post('/cancel',                  cancelSubscription);

module.exports = router;

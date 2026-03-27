// src/routes/webhooks.js
const router = require('express').Router();
const { handleRazorpayWebhook } = require('../controllers/webhookController');

// NOTE: Raw body parsing is applied in app.js for /api/webhooks
// Razorpay sends the HMAC signature in the X-Razorpay-Signature header
router.post('/razorpay', handleRazorpayWebhook);

module.exports = router;

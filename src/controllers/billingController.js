// src/controllers/billingController.js
const Razorpay = require('razorpay');
const crypto   = require('crypto');
const prisma   = require('../config/database');
const { AppError, ValidationError } = require('../utils/errors');
const { success, paginated } = require('../utils/response');
const logger   = require('../config/logger');
const { getSetting } = require('../services/settingsService');

async function fetchRazorpayKeys() {
  const [keyId, keySecret] = await Promise.all([
    getSetting('razorpay_key_id', { fallbackEnvKey: 'RAZORPAY_KEY_ID' }),
    getSetting('razorpay_key_secret', { fallbackEnvKey: 'RAZORPAY_KEY_SECRET' }),
  ]);

  return { keyId, keySecret };
}

function buildMissingRazorpayMessage(missing) {
  return `Razorpay credentials missing: ${missing.join(
    ', ',
  )}. Configure them in superadmin settings or environment variables.`;
}

// ── GET PLANS ─────────────────────────────────────────────────
async function getPlans(req, res, next) {
  try {
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { price: 'asc' },
      select: {
        id: true, name: true, displayName: true, price: true,
        maxNumbers: true, maxMessages: true, maxAiCalls: true,
        maxContacts: true, storageGb: true, maxCampaigns: true,
        maxFollowups: true, calendarEnabled: true, analyticsLevel: true,
        minMsgGapSeconds: true, supportLevel: true,
      },
    });
    return success(res, { plans });
  } catch (err) {
    next(err);
  }
}

// ── GET CURRENT SUBSCRIPTION ──────────────────────────────────
async function getCurrentSubscription(req, res, next) {
  try {
    const subscription = await prisma.subscription.findFirst({
      where: { tenantId: req.tenantId, status: 'active' },
      orderBy: { startDate: 'desc' },
      include: {
        plan: {
          select: {
            name: true, displayName: true, price: true,
            maxNumbers: true, maxMessages: true,
          },
        },
      },
    });

    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: { trialEndsAt: true, status: true },
    });

    return success(res, { subscription, trialEndsAt: tenant?.trialEndsAt });
  } catch (err) {
    next(err);
  }
}

// ── CREATE ORDER ──────────────────────────────────────────────
// Creates a Razorpay order; frontend confirms payment with the order_id
async function createOrder(req, res, next) {
  try {
    const { planId } = req.body;
    if (!planId) return next(new ValidationError('planId is required'));

    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || !plan.isActive) return next(new AppError('Plan not found or inactive', 404));
    if (plan.price === 0) return next(new AppError('Free plan does not require payment', 400));

    const { keyId, keySecret } = await fetchRazorpayKeys();
    if (!keyId || !keySecret) {
      const missing = [];
      if (!keyId) missing.push('key ID');
      if (!keySecret) missing.push('key secret');
      return next(new AppError(buildMissingRazorpayMessage(missing), 500));
    }

    const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
    const order = await razorpay.orders.create({
      amount:   plan.price,   // already in paise
      currency: 'INR',
      receipt:  `order_${req.tenantId.slice(0, 8)}_${Date.now()}`,
      notes: {
        tenantId: req.tenantId,
        planId,
      },
    });

    return success(res, {
      orderId:  order.id,
      amount:   order.amount,
      currency: order.currency,
      planId,
      planName: plan.displayName,
      keyId,
    });
  } catch (err) {
    next(err);
  }
}

// ── VERIFY PAYMENT ────────────────────────────────────────────
async function verifyPayment(req, res, next) {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, planId } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !planId) {
      return next(new ValidationError('razorpay_order_id, razorpay_payment_id, razorpay_signature and planId are required'));
    }

    // Verify signature
    const body      = `${razorpay_order_id}|${razorpay_payment_id}`;
    const { keySecret } = await fetchRazorpayKeys();
    if (!keySecret) {
      return next(new AppError(buildMissingRazorpayMessage(['key secret']), 500));
    }

    const expected  = crypto
      .createHmac('sha256', keySecret)
      .update(body)
      .digest('hex');

    if (expected !== razorpay_signature) {
      return next(new AppError('Payment verification failed — invalid signature', 400));
    }

    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return next(new AppError('Plan not found', 404));

    // Deactivate old subscriptions
    await prisma.subscription.updateMany({
      where: { tenantId: req.tenantId, status: 'active' },
      data:  { status: 'cancelled' },
    });

    // Create new subscription (monthly — 30 days)
    const now     = new Date();
    const endDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const subscription = await prisma.subscription.create({
      data: {
        tenantId:           req.tenantId,
        planId,
        status:             'active',
        startDate:          now,
        endDate,
        razorpayOrderId:    razorpay_order_id,
        razorpayPaymentId:  razorpay_payment_id,
        amount:             plan.price,
      },
    });

    // Update tenant plan
    await prisma.tenant.update({
      where: { id: req.tenantId },
      data:  { planId },
    });

    // Update affiliate commission if applicable
    const referral = await prisma.affiliateReferral.findFirst({
      where: { tenantId: req.tenantId },
    });
    if (referral) {
      const commission = Math.round(plan.price * referral.commissionAmount / 100);
      await prisma.affiliateReferral.update({
        where: { id: referral.id },
        data: {
          plan:             plan.name,
          planPrice:        plan.price,
          isActive:         true,
          commissionAmount: commission,
          lastCalculatedAt: now,
        },
      });
      await prisma.affiliate.update({
        where: { id: referral.affiliateId },
        data:  { pendingPayout: { increment: commission }, totalEarned: { increment: commission } },
      });
    }

    logger.info(`Payment verified for tenant ${req.tenantId}, plan ${plan.name}`);

    return success(res, { subscription }, 'Payment verified. Subscription activated.');
  } catch (err) {
    next(err);
  }
}

// ── CANCEL SUBSCRIPTION ───────────────────────────────────────
async function cancelSubscription(req, res, next) {
  try {
    const subscription = await prisma.subscription.findFirst({
      where: { tenantId: req.tenantId, status: 'active' },
    });
    if (!subscription) return next(new AppError('No active subscription to cancel', 404));

    await prisma.subscription.update({
      where: { id: subscription.id },
      data:  { status: 'cancelled' },
    });

    return success(res, {}, 'Subscription cancelled. Access continues until the billing period ends.');
  } catch (err) {
    next(err);
  }
}

// ── GET INVOICES ──────────────────────────────────────────────
async function getInvoices(req, res, next) {
  try {
    const subscriptions = await prisma.subscription.findMany({
      where: { tenantId: req.tenantId },
      include: { plan: { select: { displayName: true } } },
      orderBy: { startDate: 'desc' },
    });

    const invoices = subscriptions.map((sub, i) => ({
      id:          sub.id,
      number:      `INV-${String(subscriptions.length - i).padStart(4, '0')}`,
      plan:        sub.plan?.displayName || 'Unknown',
      amount:      sub.amount,
      status:      sub.status,
      date:        sub.startDate,
      periodStart: sub.startDate,
      periodEnd:   sub.endDate,
      razorpayPaymentId: sub.razorpayPaymentId,
    }));

    return success(res, { invoices });
  } catch (err) {
    next(err);
  }
}

// ── GET BILLING HISTORY ───────────────────────────────────────
async function getBillingHistory(req, res, next) {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip  = (page - 1) * limit;

    const [subscriptions, total] = await Promise.all([
      prisma.subscription.findMany({
        where: { tenantId: req.tenantId },
        include: { plan: { select: { displayName: true, price: true } } },
        orderBy: { startDate: 'desc' },
        skip,
        take: limit,
      }),
      prisma.subscription.count({ where: { tenantId: req.tenantId } }),
    ]);

    return paginated(res, subscriptions, total, page, limit);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getPlans, getCurrentSubscription, createOrder,
  verifyPayment, cancelSubscription, getInvoices, getBillingHistory,
};

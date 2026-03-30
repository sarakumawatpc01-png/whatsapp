// src/controllers/webhookController.js
// Handles inbound webhooks from third-party services.
// Currently: Razorpay payment events.
const crypto  = require('crypto');
const prisma  = require('../config/database');
const logger  = require('../config/logger');
const { getSetting } = require('../services/settingsService');

// ── RAZORPAY WEBHOOK ──────────────────────────────────────────
// Raw body is passed by Express (configured in app.js for /api/webhooks)
async function handleRazorpayWebhook(req, res) {
  const signature = req.headers['x-razorpay-signature'];
  const secret    = await getSetting('razorpay_webhook_secret', {
    fallbackEnvKey: 'RAZORPAY_WEBHOOK_SECRET',
  });

  // Always respond 200 immediately — Razorpay retries if it doesn't get one quickly
  res.status(200).json({ received: true });

  if (!signature || typeof secret !== 'string' || !secret) {
    logger.warn('Razorpay webhook received without secret/signature — ignored');
    return;
  }

  try {
    // Verify the webhook signature
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(req.body) // raw Buffer body
      .digest('hex');

    if (expectedSig !== signature) {
      logger.warn('Razorpay webhook signature mismatch — ignored');
      return;
    }

    const event = JSON.parse(req.body.toString());
    logger.info(`Razorpay webhook event: ${event.event}`);

    switch (event.event) {
      case 'payment.captured':
        await handlePaymentCaptured(event.payload.payment.entity);
        break;

      case 'payment.failed':
        await handlePaymentFailed(event.payload.payment.entity);
        break;

      case 'subscription.charged':
        await handleSubscriptionCharged(event.payload.subscription.entity, event.payload.payment?.entity);
        break;

      case 'subscription.cancelled':
        await handleSubscriptionCancelled(event.payload.subscription.entity);
        break;

      default:
        logger.debug(`Unhandled Razorpay webhook event: ${event.event}`);
    }
  } catch (err) {
    logger.error('Razorpay webhook processing error:', err);
  }
}

// ── HANDLERS ──────────────────────────────────────────────────

async function handlePaymentCaptured(payment) {
  try {
    // Find the subscription by Razorpay order ID
    const subscription = await prisma.subscription.findFirst({
      where: { razorpayOrderId: payment.order_id },
    });

    if (!subscription) {
      logger.warn(`Payment captured for unknown order: ${payment.order_id}`);
      return;
    }

    // Update with payment ID if not already set
    if (!subscription.razorpayPaymentId) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data:  { razorpayPaymentId: payment.id, status: 'active' },
      });
      logger.info(`Subscription ${subscription.id} activated via webhook (payment ${payment.id})`);
    }
  } catch (err) {
    logger.error('handlePaymentCaptured error:', err);
  }
}

async function handlePaymentFailed(payment) {
  try {
    const subscription = await prisma.subscription.findFirst({
      where: { razorpayOrderId: payment.order_id },
    });

    if (!subscription) return;

    await prisma.subscription.update({
      where: { id: subscription.id },
      data:  { status: 'past_due' },
    });

    logger.warn(`Payment failed for subscription ${subscription.id} (order ${payment.order_id})`);

    // TODO: Send email to tenant notifying about failed payment
  } catch (err) {
    logger.error('handlePaymentFailed error:', err);
  }
}

async function handleSubscriptionCharged(rzpSubscription, payment) {
  try {
    if (!rzpSubscription?.id) return;

    const subscription = await prisma.subscription.findFirst({
      where: { razorpaySubId: rzpSubscription.id },
      include: { plan: true },
    });

    if (!subscription) {
      logger.warn(`Subscription charged for unknown Razorpay sub: ${rzpSubscription.id}`);
      return;
    }

    // Extend the subscription by one billing period (30 days)
    const newEnd = new Date(
      (subscription.endDate || new Date()).getTime() + 30 * 24 * 60 * 60 * 1000
    );

    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status:  'active',
        endDate: newEnd,
        ...(payment?.id && { razorpayPaymentId: payment.id }),
      },
    });

    // Update affiliate commission for this renewal
    const referral = await prisma.affiliateReferral.findFirst({
      where: { tenantId: subscription.tenantId },
    });

    if (referral && subscription.plan) {
      const commission = Math.round(subscription.plan.price * referral.commissionAmount / 100);
      await prisma.affiliateReferral.update({
        where: { id: referral.id },
        data: {
          commissionAmount: commission,
          lastCalculatedAt: new Date(),
          isActive: true,
        },
      });
      await prisma.affiliate.update({
        where: { id: referral.affiliateId },
        data: { pendingPayout: { increment: commission }, totalEarned: { increment: commission } },
      });
    }

    logger.info(`Subscription ${subscription.id} renewed via webhook, new end: ${newEnd}`);
  } catch (err) {
    logger.error('handleSubscriptionCharged error:', err);
  }
}

async function handleSubscriptionCancelled(rzpSubscription) {
  try {
    if (!rzpSubscription?.id) return;

    const subscription = await prisma.subscription.findFirst({
      where: { razorpaySubId: rzpSubscription.id },
    });

    if (!subscription) return;

    await prisma.subscription.update({
      where: { id: subscription.id },
      data:  { status: 'cancelled' },
    });

    // Mark referral as inactive
    await prisma.affiliateReferral.updateMany({
      where: { tenantId: subscription.tenantId },
      data:  { isActive: false },
    });

    logger.info(`Subscription ${subscription.id} cancelled via webhook`);
  } catch (err) {
    logger.error('handleSubscriptionCancelled error:', err);
  }
}

module.exports = { handleRazorpayWebhook };

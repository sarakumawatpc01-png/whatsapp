// src/services/billingService.js
// Billing enforcement utilities: quota checks, monthly reset, expiry handling.
// These are called from middleware and from the Bull scheduler.
const prisma = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

// ── QUOTA ENFORCEMENT ─────────────────────────────────────────

/**
 * Checks whether a tenant is within their monthly message quota.
 * Throws AppError (429) if the quota is exceeded.
 */
async function enforceMessageQuota(tenantId) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      messagesThisMonth: true,
      msgResetAt: true,
      status: true,
      plan: { select: { maxMessages: true } },
    },
  });

  if (!tenant) throw new AppError('Tenant not found', 404);
  if (tenant.status === 'suspended') throw new AppError('Account suspended', 403);

  // Auto-reset if it's a new month
  const now       = new Date();
  const resetAt   = new Date(tenant.msgResetAt);
  const isNewMonth = now.getMonth() !== resetAt.getMonth() || now.getFullYear() !== resetAt.getFullYear();

  if (isNewMonth) {
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { messagesThisMonth: 0, aiCallsThisMonth: 0, msgResetAt: now },
    });
    return; // Quota reset — allow the message
  }

  const limit = tenant.plan?.maxMessages ?? 500;
  if (tenant.messagesThisMonth >= limit) {
    throw new AppError(`Monthly message quota (${limit}) reached. Please upgrade your plan.`, 429);
  }
}

/**
 * Increments the monthly message counter.
 * Should be called AFTER a message is successfully sent.
 */
async function incrementMessageCount(tenantId, count = 1) {
  await prisma.tenant.update({
    where: { id: tenantId },
    data:  { messagesThisMonth: { increment: count } },
  }).catch(err => logger.warn(`incrementMessageCount failed for ${tenantId}:`, err.message));
}

/**
 * Checks whether a tenant is within their monthly AI-call quota.
 * Throws AppError (429) if the quota is exceeded.
 */
async function enforceAiQuota(tenantId) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      aiCallsThisMonth: true,
      plan: { select: { maxAiCalls: true } },
    },
  });

  if (!tenant) throw new AppError('Tenant not found', 404);

  const limit = tenant.plan?.maxAiCalls ?? 100;
  if (tenant.aiCallsThisMonth >= limit) {
    throw new AppError(`Monthly AI call quota (${limit}) reached. Please upgrade your plan.`, 429);
  }
}

/**
 * Increments the AI call counter.
 */
async function incrementAiCallCount(tenantId, count = 1) {
  await prisma.tenant.update({
    where: { id: tenantId },
    data:  { aiCallsThisMonth: { increment: count } },
  }).catch(err => logger.warn(`incrementAiCallCount failed for ${tenantId}:`, err.message));
}

// ── SUBSCRIPTION CHECKS ───────────────────────────────────────

/**
 * Returns true if the tenant has an active (non-expired) subscription or valid trial.
 */
async function hasActiveAccess(tenantId) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      status:      true,
      trialEndsAt: true,
      subscriptions: {
        where:   { status: 'active' },
        orderBy: { startDate: 'desc' },
        take: 1,
        select: { endDate: true },
      },
    },
  });

  if (!tenant || tenant.status === 'suspended' || tenant.status === 'deleted') return false;

  // Check trial
  if (tenant.trialEndsAt && tenant.trialEndsAt > new Date()) return true;

  // Check paid subscription
  const activeSub = tenant.subscriptions[0];
  if (activeSub && (!activeSub.endDate || activeSub.endDate > new Date())) return true;

  return false;
}

// ── STORAGE ENFORCEMENT ───────────────────────────────────────

/**
 * Checks if the tenant has storage capacity for a new file.
 * @param {string}  tenantId
 * @param {number}  fileSizeBytes  - size of the new file in bytes
 */
async function enforceStorageQuota(tenantId, fileSizeBytes) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      storageUsedMb: true,
      plan: { select: { storageGb: true } },
    },
  });

  if (!tenant) throw new AppError('Tenant not found', 404);

  const limitMb    = (tenant.plan?.storageGb || 0.05) * 1024;
  const fileSizeMb = fileSizeBytes / (1024 * 1024);

  if (tenant.storageUsedMb + fileSizeMb > limitMb) {
    throw new AppError(
      `Storage limit (${limitMb} MB) reached. Please delete old files or upgrade your plan.`,
      429
    );
  }
}

/**
 * Increments the tenant's storage usage.
 */
async function incrementStorageUsed(tenantId, fileSizeBytes) {
  const fileSizeMb = fileSizeBytes / (1024 * 1024);
  await prisma.tenant.update({
    where: { id: tenantId },
    data:  { storageUsedMb: { increment: fileSizeMb } },
  }).catch(err => logger.warn(`incrementStorageUsed failed for ${tenantId}:`, err.message));
}

/**
 * Decrements the tenant's storage usage (called on file deletion).
 */
async function decrementStorageUsed(tenantId, fileSizeBytes) {
  const fileSizeMb = fileSizeBytes / (1024 * 1024);
  await prisma.tenant.update({
    where: { id: tenantId },
    data:  {
      storageUsedMb: {
        decrement: fileSizeMb,
      },
    },
  }).catch(err => logger.warn(`decrementStorageUsed failed for ${tenantId}:`, err.message));
}

// ── SCHEDULED: EXPIRE SUBSCRIPTIONS ──────────────────────────
/**
 * Finds all subscriptions that have passed their endDate and marks them expired.
 * Run this daily via a cron job or Bull scheduler.
 */
async function expireSubscriptions() {
  const now = new Date();

  const expired = await prisma.subscription.findMany({
    where: { status: 'active', endDate: { lt: now } },
    select: { id: true, tenantId: true },
  });

  if (expired.length === 0) return;

  const expiredIds = expired.map(s => s.id);
  await prisma.subscription.updateMany({
    where: { id: { in: expiredIds } },
    data:  { status: 'expired' },
  });

  // Downgrade tenant to free plan if no other active subscription exists
  for (const sub of expired) {
    const stillActive = await prisma.subscription.findFirst({
      where: { tenantId: sub.tenantId, status: 'active' },
    });

    if (!stillActive) {
      const freePlan = await prisma.plan.findUnique({ where: { name: 'free' } });
      if (freePlan) {
        await prisma.tenant.update({
          where: { id: sub.tenantId },
          data:  { planId: freePlan.id },
        });
      }
    }
  }

  logger.info(`Expired ${expired.length} subscription(s)`);
}

// ── SCHEDULED: MONTHLY QUOTA RESET ───────────────────────────
/**
 * Resets all tenants' monthly message and AI-call counters.
 * Run on the 1st of each month.
 */
async function resetMonthlyQuotas() {
  const now = new Date();
  await prisma.tenant.updateMany({
    data: { messagesThisMonth: 0, aiCallsThisMonth: 0, msgResetAt: now },
  });
  logger.info('Monthly quotas reset for all tenants');
}

module.exports = {
  enforceMessageQuota,
  incrementMessageCount,
  enforceAiQuota,
  incrementAiCallCount,
  hasActiveAccess,
  enforceStorageQuota,
  incrementStorageUsed,
  decrementStorageUsed,
  expireSubscriptions,
  resetMonthlyQuotas,
};

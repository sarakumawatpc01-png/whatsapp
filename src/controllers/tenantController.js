// src/controllers/tenantController.js
const prisma  = require('../config/database');
const bcrypt  = require('bcryptjs');
const { AppError, ValidationError } = require('../utils/errors');
const { success } = require('../utils/response');
const logger  = require('../config/logger');

// ── GET PROFILE ───────────────────────────────────────────────
async function getProfile(req, res, next) {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: {
        id: true,
        ownerName: true,
        businessName: true,
        email: true,
        phone: true,
        emailVerified: true,
        phoneVerified: true,
        consentGiven: true,
        status: true,
        themeId: true,
        trialEndsAt: true,
        lastLoginAt: true,
        createdAt: true,
        plan: {
          select: {
            name: true,
            displayName: true,
            price: true,
            maxNumbers: true,
            maxMessages: true,
            maxAiCalls: true,
            maxContacts: true,
            storageGb: true,
            maxCampaigns: true,
            maxFollowups: true,
            calendarEnabled: true,
            analyticsLevel: true,
            minMsgGapSeconds: true,
            supportLevel: true,
          },
        },
        subscriptions: {
          where: { status: 'active' },
          orderBy: { startDate: 'desc' },
          take: 1,
          select: {
            id: true,
            status: true,
            startDate: true,
            endDate: true,
          },
        },
      },
    });

    if (!tenant) return next(new AppError('Tenant not found', 404));
    return success(res, { tenant });
  } catch (err) {
    next(err);
  }
}

// ── UPDATE PROFILE ────────────────────────────────────────────
async function updateProfile(req, res, next) {
  try {
    const { ownerName, businessName, phone } = req.body;

    // If changing phone, check it's not taken
    if (phone) {
      const existing = await prisma.tenant.findFirst({
        where: { phone, id: { not: req.tenantId } },
      });
      if (existing) return next(new AppError('Phone number already in use', 409));
    }

    const updated = await prisma.tenant.update({
      where: { id: req.tenantId },
      data: {
        ...(ownerName    !== undefined && { ownerName }),
        ...(businessName !== undefined && { businessName }),
        ...(phone        !== undefined && { phone }),
      },
      select: {
        id: true, ownerName: true, businessName: true,
        email: true, phone: true, themeId: true,
      },
    });

    return success(res, { tenant: updated }, 'Profile updated');
  } catch (err) {
    next(err);
  }
}

// ── GET USAGE ─────────────────────────────────────────────────
async function getUsage(req, res, next) {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: {
        messagesThisMonth: true,
        aiCallsThisMonth: true,
        storageUsedMb: true,
        msgResetAt: true,
        plan: {
          select: {
            maxMessages: true,
            maxAiCalls: true,
            storageGb: true,
            maxContacts: true,
            maxCampaigns: true,
            maxFollowups: true,
            maxNumbers: true,
          },
        },
      },
    });

    if (!tenant) return next(new AppError('Tenant not found', 404));

    const [contactCount, campaignCount, followupCount, numberCount] = await Promise.all([
      prisma.contact.count({ where: { tenantId: req.tenantId } }),
      prisma.campaign.count({ where: { tenantId: req.tenantId } }),
      prisma.followupSequence.count({ where: { tenantId: req.tenantId, isActive: true } }),
      prisma.tenantNumber.count({ where: { tenantId: req.tenantId } }),
    ]);

    const usage = {
      messages: {
        used: tenant.messagesThisMonth,
        limit: tenant.plan?.maxMessages || 500,
        resetAt: tenant.msgResetAt,
      },
      aiCalls: {
        used: tenant.aiCallsThisMonth,
        limit: tenant.plan?.maxAiCalls || 100,
      },
      storage: {
        usedMb: tenant.storageUsedMb,
        limitGb: tenant.plan?.storageGb || 0.05,
      },
      contacts: {
        used: contactCount,
        limit: tenant.plan?.maxContacts || 100,
      },
      campaigns: {
        used: campaignCount,
        limit: tenant.plan?.maxCampaigns || 1,
      },
      followups: {
        used: followupCount,
        limit: tenant.plan?.maxFollowups || 1,
      },
      numbers: {
        used: numberCount,
        limit: tenant.plan?.maxNumbers || 1,
      },
    };

    return success(res, { usage });
  } catch (err) {
    next(err);
  }
}

module.exports = { getProfile, updateProfile, getUsage };

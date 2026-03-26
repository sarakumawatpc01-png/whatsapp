// src/controllers/campaignController.js
const prisma  = require('../config/database');
const { AppError, ValidationError } = require('../utils/errors');
const { success, paginated } = require('../utils/response');
const { startCampaign, pauseCampaign } = require('../services/campaignService');
const logger  = require('../config/logger');

// ── LIST CAMPAIGNS ────────────────────────────────────────────
async function listCampaigns(req, res, next) {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip  = (page - 1) * limit;

    const [campaigns, total] = await Promise.all([
      prisma.campaign.findMany({
        where: { tenantId: req.tenantId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.campaign.count({ where: { tenantId: req.tenantId } }),
    ]);

    return paginated(res, campaigns, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── GET CAMPAIGN ──────────────────────────────────────────────
async function getCampaign(req, res, next) {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.campaignId, tenantId: req.tenantId },
    });
    if (!campaign) return next(new AppError('Campaign not found', 404));
    return success(res, { campaign });
  } catch (err) {
    next(err);
  }
}

// ── CREATE CAMPAIGN ───────────────────────────────────────────
async function createCampaign(req, res, next) {
  try {
    const {
      name, description, message, mediaUrl, mediaType,
      targetType, targetLabels, targetJids, scheduledAt,
    } = req.body;

    if (!name || !message) return next(new ValidationError('Name and message are required'));

    // Check plan limit
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      include: {
        plan: true,
        campaigns: { where: { status: { not: 'completed' } }, select: { id: true } },
      },
    });
    const maxCampaigns = tenant.plan?.maxCampaigns || 1;
    if (tenant.campaigns.length >= maxCampaigns) {
      return next(new AppError(`Your plan allows a maximum of ${maxCampaigns} active campaign(s). Please upgrade.`, 403));
    }

    const campaign = await prisma.campaign.create({
      data: {
        tenantId: req.tenantId,
        name,
        description: description || null,
        message,
        mediaUrl:     mediaUrl     || null,
        mediaType:    mediaType    || null,
        targetType:   targetType   || 'all',
        targetLabels: targetLabels || [],
        targetJids:   targetJids   || [],
        status: scheduledAt ? 'scheduled' : 'draft',
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      },
    });

    return success(res, { campaign }, 'Campaign created', 201);
  } catch (err) {
    next(err);
  }
}

// ── UPDATE CAMPAIGN ───────────────────────────────────────────
async function updateCampaign(req, res, next) {
  try {
    const { campaignId } = req.params;
    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId: req.tenantId } });
    if (!campaign) return next(new AppError('Campaign not found', 404));
    if (campaign.status === 'running') return next(new AppError('Cannot edit a running campaign', 400));

    const { name, description, message, targetType, targetLabels, targetJids, scheduledAt } = req.body;

    const updated = await prisma.campaign.update({
      where: { id: campaignId },
      data: {
        ...(name         !== undefined && { name }),
        ...(description  !== undefined && { description }),
        ...(message      !== undefined && { message }),
        ...(targetType   !== undefined && { targetType }),
        ...(targetLabels !== undefined && { targetLabels }),
        ...(targetJids   !== undefined && { targetJids }),
        ...(scheduledAt  !== undefined && { scheduledAt: scheduledAt ? new Date(scheduledAt) : null }),
      },
    });

    return success(res, { campaign: updated }, 'Campaign updated');
  } catch (err) {
    next(err);
  }
}

// ── DELETE CAMPAIGN ───────────────────────────────────────────
async function deleteCampaign(req, res, next) {
  try {
    const { campaignId } = req.params;
    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId: req.tenantId } });
    if (!campaign) return next(new AppError('Campaign not found', 404));
    if (campaign.status === 'running') return next(new AppError('Stop the campaign before deleting', 400));

    await prisma.campaign.delete({ where: { id: campaignId } });
    return success(res, {}, 'Campaign deleted');
  } catch (err) {
    next(err);
  }
}

// ── START CAMPAIGN ────────────────────────────────────────────
async function startCampaignCtrl(req, res, next) {
  try {
    const { campaignId } = req.params;

    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId: req.tenantId } });
    if (!campaign) return next(new AppError('Campaign not found', 404));
    if (campaign.status === 'running') return next(new AppError('Campaign is already running', 400));
    if (campaign.status === 'completed') return next(new AppError('Campaign has already completed', 400));

    const count = await startCampaign(campaignId);
    return success(res, { enqueued: count }, `Campaign started. ${count} messages queued.`);
  } catch (err) {
    next(err);
  }
}

// ── PAUSE CAMPAIGN ────────────────────────────────────────────
async function pauseCampaignCtrl(req, res, next) {
  try {
    const { campaignId } = req.params;

    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId: req.tenantId } });
    if (!campaign) return next(new AppError('Campaign not found', 404));
    if (campaign.status !== 'running') return next(new AppError('Campaign is not running', 400));

    await pauseCampaign(campaignId);
    return success(res, {}, 'Campaign paused');
  } catch (err) {
    next(err);
  }
}

// ── STOP / MARK COMPLETED ─────────────────────────────────────
async function stopCampaign(req, res, next) {
  try {
    const { campaignId } = req.params;

    const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId: req.tenantId } });
    if (!campaign) return next(new AppError('Campaign not found', 404));

    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'completed', completedAt: new Date() },
    });

    return success(res, {}, 'Campaign stopped');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listCampaigns, getCampaign, createCampaign, updateCampaign, deleteCampaign,
  startCampaignCtrl, pauseCampaignCtrl, stopCampaign,
};

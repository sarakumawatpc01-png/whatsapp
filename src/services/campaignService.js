// src/services/campaignService.js
// Handles campaign execution: resolve target contacts, enqueue messages.

const prisma  = require('../config/database');
const logger  = require('../config/logger');
const Bull    = require('bull');

const campaignQueue = new Bull('campaign-messages', {
  redis: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
});

/**
 * Resolve all target JIDs for a campaign based on its targetType.
 */
async function resolveCampaignTargets(campaign) {
  const { tenantId, targetType, targetLabels, targetJids } = campaign;

  if (targetType === 'custom' && targetJids?.length) {
    // Custom list — find contacts by JID
    return prisma.contact.findMany({
      where: { tenantId, waJid: { in: targetJids }, isBlocked: false },
      select: { id: true, waJid: true, name: true, numberId: true },
    });
  }

  if (targetType === 'label' && targetLabels?.length) {
    return prisma.contact.findMany({
      where: { tenantId, label: { in: targetLabels }, isBlocked: false },
      select: { id: true, waJid: true, name: true, numberId: true },
    });
  }

  // Default: all contacts
  return prisma.contact.findMany({
    where: { tenantId, isBlocked: false },
    select: { id: true, waJid: true, name: true, numberId: true },
  });
}

/**
 * Start a campaign: resolve targets, update status, enqueue messages.
 * Returns total count of messages enqueued.
 */
async function startCampaign(campaignId) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { tenant: { include: { numbers: { where: { isDefault: true } } } } },
  });

  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  if (campaign.status === 'running') throw new Error('Campaign already running');

  const targets = await resolveCampaignTargets(campaign);
  if (!targets.length) throw new Error('No target contacts found for this campaign');

  // Get default number for the tenant (or first connected number)
  const defaultNumber = campaign.tenant.numbers[0];
  if (!defaultNumber) throw new Error('No connected WhatsApp number found');

  // Update campaign status → running
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'running', startedAt: new Date() },
  });

  // Enqueue each message with increasing delay
  const MIN_GAP_MS  = (defaultNumber.minMsgGapSec || 10) * 1000;
  const MAX_GAP_MS  = (defaultNumber.maxMsgGapSec || 30) * 1000;

  let cumulativeDelay = 1000; // start 1s after now

  for (const contact of targets) {
    const gap = randomBetween(MIN_GAP_MS, MAX_GAP_MS);
    cumulativeDelay += gap;

    await campaignQueue.add(
      {
        campaignId,
        tenantId:  campaign.tenantId,
        numberId:  defaultNumber.id,
        toJid:     contact.waJid,
        contactId: contact.id,
        message:   personalise(campaign.message, contact),
        mediaUrl:  campaign.mediaUrl,
        mediaType: campaign.mediaType,
      },
      {
        delay:    cumulativeDelay,
        attempts: 3,
        backoff:  { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      }
    );
  }

  logger.info(`Campaign ${campaignId}: enqueued ${targets.length} messages, total span: ${(cumulativeDelay / 1000).toFixed(0)}s`);
  return targets.length;
}

/**
 * Pause a running campaign (clears queued jobs).
 */
async function pauseCampaign(campaignId) {
  await campaignQueue.pause();
  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: 'paused' },
  });
  await campaignQueue.resume();
}

/**
 * Personalise message tokens: {name}, {business}, {date}
 */
function personalise(template, contact) {
  return template
    .replace(/\{name\}/gi, contact.name || 'Valued Customer')
    .replace(/\{date\}/gi, new Date().toLocaleDateString('en-IN'));
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

module.exports = { campaignQueue, startCampaign, pauseCampaign, resolveCampaignTargets };

// src/whatsapp/messageHandler.js
// Processes every incoming WhatsApp message.
// Determines tenant → saves message → triggers AI or queues follow-up

const prisma = require('../config/database');
const logger = require('../config/logger');
const { getSocketIO } = require('../socket/socketManager');
const { buildAIReply } = require('../ai/promptBuilder');
const { sendWithDelay } = require('./delayEngine');
const { getOrCreateContact } = require('./engine');
const { enrollFollowups, cancelFollowupsForContact } = require('../services/followupService');
const { cacheGet, cacheSet } = require('../config/redis');

async function handleIncomingMessage(waClient, msg, numberId, tenantId) {
  try {
    // ── 1. Parse message ─────────────────────────────────────
    const fromJid = msg.from;
    const toJid   = msg.to;
    const isGroup  = msg.from.includes('@g.us');
    const body     = msg.body || '';
    const type     = msg.type; // chat | image | audio | video | document | sticker | location | ...

    // Skip our own messages
    if (msg.fromMe) return;

    // ── 2. Get / create contact ───────────────────────────────
    const contact = await getOrCreateContact(tenantId, numberId, fromJid);

    // Update contact last message time
    await prisma.contact.update({
      where: { id: contact.id },
      data: {
        lastMessageAt: new Date(),
        messageCount: { increment: 1 },
        name: msg._data?.notifyName || contact.name || undefined,
      },
    });

    // ── 3. Save message to DB ────────────────────────────────
    const savedMsg = await prisma.message.create({
      data: {
        tenantId, numberId,
        contactId: contact.id,
        waMessageId: msg.id.id,
        fromJid, toJid,
        body: body,
        type: type,
        direction: 'inbound',
        aiSent: false,
        mediaUrl: msg.hasMedia ? `media:${msg.id.id}` : null,
        latitude: type === 'location' ? msg.location?.latitude : null,
        longitude: type === 'location' ? msg.location?.longitude : null,
        locationName: type === 'location' ? msg.location?.description : null,
        quotedMsgId: msg.hasQuotedMsg ? msg._data?.quotedStanzaID : null,
        metadata: { notifyName: msg._data?.notifyName },
        timestamp: new Date(msg.timestamp * 1000),
      },
    });

    // ── 4. Emit to frontend via socket ───────────────────────
    const io = getSocketIO();
    io.to(`tenant:${tenantId}`).emit('message:new', {
      message: { ...savedMsg, contact },
      numberId,
    });

    // ── 5. Cancel any pending follow-ups for this contact (they replied) ──
    await cancelFollowupsForContact(contact.id, tenantId);

    // ── 6. Check AI config ────────────────────────────────────
    if (contact.isBlocked) return;
    if (!contact.aiEnabled) return; // AI disabled for this specific contact

    const number = await prisma.tenantNumber.findUnique({ where: { id: numberId } });
    if (!number?.aiEnabled) return; // AI disabled for this number

    // Skip groups unless AI is configured to reply to groups
    const aiConfig = await getAiConfig(tenantId);
    if (!aiConfig) return;
    if (isGroup && !aiConfig.replyInGroups) return;
    if (isGroup && aiConfig.replyInGroups) {
      // In groups, only reply if mentioned
      const mentionedIds = msg._data?.mentionedJidList || [];
      const clientJid = waClient.info?.wid?._serialized;
      const isMentioned = mentionedIds.includes(clientJid);
      if (!isMentioned) return;
    }

    // ── 7. Ignore empty/media-only messages (no text to reply to) ──
    if (!body.trim() && !['location', 'contact_card'].includes(type)) {
      if (type !== 'chat' && type !== 'text') return;
    }

    // ── 8. Check for escalation triggers ─────────────────────
    if (aiConfig.escalationTriggers) {
      const triggers = aiConfig.escalationTriggers.toLowerCase().split('\n');
      const bodyLower = body.toLowerCase();
      for (const trigger of triggers) {
        if (trigger.trim() && bodyLower.includes(trigger.trim())) {
          // Disable AI for this chat temporarily
          await prisma.contact.update({
            where: { id: contact.id },
            data: { aiEnabled: false },
          });
          io.to(`tenant:${tenantId}`).emit('ai:escalated', {
            contactId: contact.id, trigger, message: body,
          });
          logger.info(`AI escalated for contact ${contact.id} — trigger: "${trigger}"`);
          return;
        }
      }
    }

    // ── 9. Get conversation history (last 10 messages) ────────
    const history = await prisma.message.findMany({
      where: { tenantId, contactId: contact.id, type: { in: ['text', 'chat'] } },
      orderBy: { timestamp: 'desc' },
      take: 10,
      select: { body: true, direction: true, aiSent: true, timestamp: true },
    });
    const sortedHistory = history.reverse();

    // ── 10. Build & send AI reply ─────────────────────────────
    await sendWithDelay(numberId, fromJid, body, sortedHistory, contact, tenantId, aiConfig, savedMsg.id);

    // ── 11. Enroll in follow-up sequences (if applicable) ─────
    await enrollFollowups(contact.id, tenantId, 'new_contact');

  } catch (err) {
    logger.error(`Error handling message from ${msg.from} (tenant: ${tenantId}):`, err);
  }
}

// Cache AI config for 5 minutes to avoid DB hit on every message
async function getAiConfig(tenantId) {
  const cacheKey = `aiconfig:${tenantId}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const config = await prisma.aiConfig.findUnique({ where: { tenantId } });
  if (config) await cacheSet(cacheKey, config, 300);
  return config;
}

module.exports = { handleIncomingMessage };

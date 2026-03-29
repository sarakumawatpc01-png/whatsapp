// src/controllers/messageController.js
const prisma   = require('../config/database');
const { AppError, ValidationError } = require('../utils/errors');
const { success, paginated } = require('../utils/response');
const logger   = require('../config/logger');
const {
  sendTextMessage, sendMediaMessage, sendLocation,
  sendContactCard, sendPoll, sendReaction,
} = require('../whatsapp/engine');
const { scheduledQueue } = require('../jobs/processors');

async function resolveTenantContactId(tenantId, contactId) {
  if (!contactId) return null;
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
    select: { id: true },
  });
  if (!contact) throw new AppError('Contact not found', 404);
  return contact.id;
}

// ── GET MESSAGES FOR A CONTACT ────────────────────────────────
async function getMessages(req, res, next) {
  try {
    const { contactId } = req.params;
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 30;
    const skip  = (page - 1) * limit;

    // Verify contact belongs to tenant
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, tenantId: req.tenantId },
    });
    if (!contact) return next(new AppError('Contact not found', 404));

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { tenantId: req.tenantId, contactId },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      prisma.message.count({ where: { tenantId: req.tenantId, contactId } }),
    ]);

    // Mark inbound messages as read
    await prisma.message.updateMany({
      where: { tenantId: req.tenantId, contactId, direction: 'inbound', isRead: false },
      data: { isRead: true },
    });

    return paginated(res, messages.reverse(), total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── GET ALL CONVERSATIONS (INBOX VIEW) ────────────────────────
async function getConversations(req, res, next) {
  try {
    const page    = parseInt(req.query.page)    || 1;
    const limit   = parseInt(req.query.limit)   || 25;
    const skip    = (page - 1) * limit;
    const numberId = req.query.numberId; // optional filter
    const aiFilter = req.query.aiFilter; // 'ai' | 'human' | undefined
    const search   = req.query.search;

    const where = {
      tenantId: req.tenantId,
      ...(numberId && { numberId }),
    };

    if (search) {
      where.OR = [
        { name:        { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search } },
      ];
    }

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        include: {
          messages: {
            orderBy: { timestamp: 'desc' },
            take: 1,
            select: { body: true, direction: true, aiSent: true, timestamp: true, type: true },
          },
          _count: { select: { messages: { where: { direction: 'inbound', isRead: false } } } },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.contact.count({ where }),
    ]);

    const result = contacts.map(c => ({
      id: c.id,
      name: c.name || c.phoneNumber,
      phoneNumber: c.phoneNumber,
      waJid: c.waJid,
      label: c.label,
      isMuted: c.isMuted,
      isBlocked: c.isBlocked,
      aiEnabled: c.aiEnabled,
      numberId: c.numberId,
      lastMessage: c.messages[0] || null,
      unreadCount: c._count.messages,
      lastMessageAt: c.lastMessageAt,
    }));

    return paginated(res, result, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── SEND TEXT MESSAGE ─────────────────────────────────────────
async function sendText(req, res, next) {
  try {
    const { numberId, toJid, message, contactId, quotedMsgId } = req.body;
    if (!numberId || !toJid || !message) {
      return next(new ValidationError('numberId, toJid, and message are required'));
    }

    // Verify number belongs to tenant
    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
    });
    if (!number) return next(new AppError('Number not found', 404));

    const safeContactId = await resolveTenantContactId(req.tenantId, contactId);

    const result = await sendTextMessage(numberId, toJid, message, quotedMsgId);

    // Save message
    await prisma.message.create({
      data: {
        tenantId: req.tenantId,
        numberId,
        contactId: safeContactId,
        waMessageId: result?.id?.id,
        fromJid: `${number.phoneNumber}@s.whatsapp.net`,
        toJid,
        body: message,
        type: 'text',
        direction: 'outbound',
        aiSent: false,
        timestamp: new Date(),
      },
    });

    return success(res, { sent: true, messageId: result?.id?.id }, 'Message sent');
  } catch (err) {
    next(err);
  }
}

// ── SEND MEDIA ─────────────────────────────────────────────────
async function sendMedia(req, res, next) {
  try {
    const { numberId, toJid, caption, contactId } = req.body;
    if (!numberId || !toJid) return next(new ValidationError('numberId and toJid are required'));
    if (!req.file) return next(new ValidationError('File is required'));

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
    });
    if (!number) return next(new AppError('Number not found', 404));

    const safeContactId = await resolveTenantContactId(req.tenantId, contactId);

    const base64 = req.file.buffer.toString('base64');
    const mediaData = {
      mimetype: req.file.mimetype,
      base64,
      filename: req.file.originalname,
    };

    const result = await sendMediaMessage(numberId, toJid, mediaData, caption || '');

    await prisma.message.create({
      data: {
        tenantId: req.tenantId,
        numberId,
        contactId: safeContactId,
        waMessageId: result?.id?.id,
        fromJid: `${number.phoneNumber}@s.whatsapp.net`,
        toJid,
        body: caption || '',
        type: req.file.mimetype.startsWith('image') ? 'image' : 'document',
        direction: 'outbound',
        aiSent: false,
        timestamp: new Date(),
      },
    });

    return success(res, { sent: true }, 'Media sent');
  } catch (err) {
    next(err);
  }
}

// ── SEND LOCATION ─────────────────────────────────────────────
async function sendLocationMsg(req, res, next) {
  try {
    const { numberId, toJid, lat, lng, name, contactId } = req.body;
    if (!numberId || !toJid || lat === undefined || lng === undefined) {
      return next(new ValidationError('numberId, toJid, lat, and lng are required'));
    }

    const number = await prisma.tenantNumber.findFirst({ where: { id: numberId, tenantId: req.tenantId } });
    if (!number) return next(new AppError('Number not found', 404));

    const safeContactId = await resolveTenantContactId(req.tenantId, contactId);

    await sendLocation(numberId, toJid, parseFloat(lat), parseFloat(lng), name || '');

    await prisma.message.create({
      data: {
        tenantId: req.tenantId, numberId, contactId: safeContactId,
        fromJid: `${number.phoneNumber}@s.whatsapp.net`, toJid,
        body: name || 'Location', type: 'location',
        latitude: parseFloat(lat), longitude: parseFloat(lng), locationName: name,
        direction: 'outbound', aiSent: false, timestamp: new Date(),
      },
    });

    return success(res, { sent: true }, 'Location sent');
  } catch (err) {
    next(err);
  }
}

// ── SEND POLL ─────────────────────────────────────────────────
async function sendPollMsg(req, res, next) {
  try {
    const { numberId, toJid, question, options, allowMultiple, contactId } = req.body;
    if (!numberId || !toJid || !question || !options?.length) {
      return next(new ValidationError('numberId, toJid, question, and options are required'));
    }

    const number = await prisma.tenantNumber.findFirst({ where: { id: numberId, tenantId: req.tenantId } });
    if (!number) return next(new AppError('Number not found', 404));

    const safeContactId = await resolveTenantContactId(req.tenantId, contactId);

    await sendPoll(numberId, toJid, question, options, allowMultiple || false);

    await prisma.message.create({
      data: {
        tenantId: req.tenantId, numberId, contactId: safeContactId,
        fromJid: `${number.phoneNumber}@s.whatsapp.net`, toJid,
        body: question, type: 'poll',
        direction: 'outbound', aiSent: false, timestamp: new Date(),
      },
    });

    return success(res, { sent: true }, 'Poll sent');
  } catch (err) {
    next(err);
  }
}

// ── REACT TO MESSAGE ──────────────────────────────────────────
async function reactToMessage(req, res, next) {
  try {
    const { numberId, msgId, emoji } = req.body;
    if (!numberId || !msgId || !emoji) return next(new ValidationError('numberId, msgId, and emoji are required'));

    const number = await prisma.tenantNumber.findFirst({ where: { id: numberId, tenantId: req.tenantId } });
    if (!number) return next(new AppError('Number not found', 404));

    await sendReaction(numberId, msgId, emoji);
    return success(res, { reacted: true }, 'Reaction sent');
  } catch (err) {
    next(err);
  }
}

// ── SCHEDULE MESSAGE ──────────────────────────────────────────
async function scheduleMessage(req, res, next) {
  try {
    const { numberId, toJid, message, contactId, scheduledAt } = req.body;
    if (!numberId || !toJid || !message || !scheduledAt) {
      return next(new ValidationError('numberId, toJid, message, and scheduledAt are required'));
    }

    const scheduleTime = new Date(scheduledAt);
    if (scheduleTime <= new Date()) return next(new ValidationError('Scheduled time must be in the future'));

    const number = await prisma.tenantNumber.findFirst({ where: { id: numberId, tenantId: req.tenantId } });
    if (!number) return next(new AppError('Number not found', 404));

    const safeContactId = await resolveTenantContactId(req.tenantId, contactId);

    const delay = scheduleTime.getTime() - Date.now();

    await scheduledQueue.add(
      { tenantId: req.tenantId, numberId, toJid, message, contactId: safeContactId },
      { delay, attempts: 3, removeOnComplete: true }
    );

    return success(res, { scheduled: true, scheduledAt: scheduleTime }, 'Message scheduled');
  } catch (err) {
    next(err);
  }
}

// ── TOGGLE AI FOR CONTACT ─────────────────────────────────────
async function toggleAIForContact(req, res, next) {
  try {
    const { contactId } = req.params;
    const { aiEnabled } = req.body;

    const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId: req.tenantId } });
    if (!contact) return next(new AppError('Contact not found', 404));

    await prisma.contact.update({ where: { id: contactId }, data: { aiEnabled: Boolean(aiEnabled) } });
    return success(res, { aiEnabled: Boolean(aiEnabled) }, `AI ${aiEnabled ? 'enabled' : 'disabled'} for this contact`);
  } catch (err) {
    next(err);
  }
}

// ── GET AI SUGGESTION ─────────────────────────────────────────
async function getAISuggestion(req, res, next) {
  try {
    const { contactId } = req.params;

    const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId: req.tenantId } });
    if (!contact) return next(new AppError('Contact not found', 404));

    const history = await prisma.message.findMany({
      where: { tenantId: req.tenantId, contactId, type: { in: ['text', 'chat'] } },
      orderBy: { timestamp: 'desc' },
      take: 10,
      select: { body: true, direction: true },
    });

    const aiConfig = await prisma.aiConfig.findUnique({ where: { tenantId: req.tenantId } });
    if (!aiConfig) return next(new AppError('AI config not found', 404));

    const { buildSystemPrompt, buildConversationHistory } = require('../ai/promptBuilder');
    const { generateAIReply } = require('../ai/modelRouter');

    const systemPrompt = buildSystemPrompt(aiConfig, contact);
    const sortedHistory = history.reverse();
    const lastMessage   = sortedHistory.filter(m => m.direction === 'inbound').pop();

    if (!lastMessage?.body) {
      return success(res, { suggestion: '' }, 'No incoming message to suggest for');
    }

    const { text } = await generateAIReply({
      systemPrompt,
      history: buildConversationHistory(sortedHistory.slice(0, -1)),
      userMessage: lastMessage.body,
      tenantId: req.tenantId,
      maxChars: aiConfig.maxResponseChars || 300,
    });

    return success(res, { suggestion: text });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getMessages, getConversations, sendText, sendMedia,
  sendLocationMsg, sendPollMsg, reactToMessage,
  scheduleMessage, toggleAIForContact, getAISuggestion,
};

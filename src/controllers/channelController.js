// src/controllers/channelController.js
// WhatsApp Channels — one-way broadcast communication to followers
const prisma  = require('../config/database');
const { AppError, ValidationError } = require('../utils/errors');
const { success, paginated } = require('../utils/response');
const logger  = require('../config/logger');
const { getSession } = require('../whatsapp/engine');

// ── LIST CHANNELS ──────────────────────────────────────────────
async function listChannels(req, res, next) {
  try {
    const { numberId } = req.query;
    if (!numberId) return next(new ValidationError('numberId query param is required'));

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
    });
    if (!number) return next(new AppError('Number not found', 404));
    if (number.sessionStatus !== 'connected') {
      return next(new AppError('WhatsApp number is not connected', 400));
    }

    const session = getSession(numberId);
    if (!session) return next(new AppError('Session not active', 400));

    // whatsapp-web.js: getChannels() returns an array of Channel objects
    const channels = await session.getChannels().catch(() => []);
    const channelList = channels.map(ch => ({
      id:    ch.id._serialized,
      name:  ch.name,
      description: ch.description || null,
      subscriberCount: ch.subscriberCount || 0,
      isAdmin: ch.isAdmin || false,
    }));

    return success(res, { channels: channelList });
  } catch (err) {
    next(err);
  }
}

// ── GET CHANNEL ────────────────────────────────────────────────
async function getChannel(req, res, next) {
  try {
    const { channelId } = req.params;
    const { numberId }  = req.query;
    if (!numberId) return next(new ValidationError('numberId query param is required'));

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
    });
    if (!number) return next(new AppError('Number not found', 404));

    const session = getSession(numberId);
    if (!session) return next(new AppError('Session not active', 400));

    const chat = await session.getChatById(channelId).catch(() => null);
    if (!chat || !chat.isChannel) return next(new AppError('Channel not found', 404));

    return success(res, {
      channel: {
        id:          chat.id._serialized,
        name:        chat.name,
        description: chat.description || null,
        subscriberCount: chat.subscriberCount || 0,
        isAdmin:     chat.isAdmin || false,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── CREATE CHANNEL ─────────────────────────────────────────────
async function createChannel(req, res, next) {
  try {
    const { numberId, name, description } = req.body;
    if (!numberId || !name) return next(new ValidationError('numberId and name are required'));

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
    });
    if (!number) return next(new AppError('Number not found', 404));
    if (number.sessionStatus !== 'connected') {
      return next(new AppError('WhatsApp number is not connected', 400));
    }

    const session = getSession(numberId);
    if (!session) return next(new AppError('Session not active', 400));

    // whatsapp-web.js: createChannel(name, description)
    const channel = await session.createChannel(name, description || '').catch(err => {
      throw new AppError(`Failed to create channel: ${err.message}`, 500);
    });

    return success(res, {
      channel: {
        id: channel.id._serialized,
        name: channel.name,
      },
    }, 'Channel created', 201);
  } catch (err) {
    next(err);
  }
}

// ── UPDATE CHANNEL ─────────────────────────────────────────────
async function updateChannel(req, res, next) {
  try {
    const { channelId }       = req.params;
    const { numberId, name, description } = req.body;
    if (!numberId) return next(new ValidationError('numberId is required'));

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
    });
    if (!number) return next(new AppError('Number not found', 404));

    const session = getSession(numberId);
    if (!session) return next(new AppError('Session not active', 400));

    const chat = await session.getChatById(channelId).catch(() => null);
    if (!chat) return next(new AppError('Channel not found', 404));
    if (!chat.isAdmin) return next(new AppError('You must be admin to update this channel', 403));

    if (name)        await chat.setSubject(name).catch(() => {});
    if (description) await chat.setDescription(description).catch(() => {});

    return success(res, {}, 'Channel updated');
  } catch (err) {
    next(err);
  }
}

// ── POST UPDATE ────────────────────────────────────────────────
async function postUpdate(req, res, next) {
  try {
    const { channelId }  = req.params;
    const { numberId, body, mediaUrl, mediaType } = req.body;
    if (!numberId || !body) return next(new ValidationError('numberId and body are required'));

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
    });
    if (!number) return next(new AppError('Number not found', 404));
    if (number.sessionStatus !== 'connected') {
      return next(new AppError('WhatsApp number is not connected', 400));
    }

    const session = getSession(numberId);
    if (!session) return next(new AppError('Session not active', 400));

    const chat = await session.getChatById(channelId).catch(() => null);
    if (!chat) return next(new AppError('Channel not found', 404));

    if (mediaUrl) {
      const { MessageMedia } = require('whatsapp-web.js');
      const media = await MessageMedia.fromUrl(mediaUrl).catch(() => null);
      if (media) {
        await chat.sendMessage(media, { caption: body });
      } else {
        await chat.sendMessage(body);
      }
    } else {
      await chat.sendMessage(body);
    }

    return success(res, {}, 'Update posted to channel');
  } catch (err) {
    next(err);
  }
}

// ── GET CHANNEL ANALYTICS ──────────────────────────────────────
async function getChannelAnalytics(req, res, next) {
  try {
    const { channelId } = req.params;
    const { numberId }  = req.query;
    if (!numberId) return next(new ValidationError('numberId query param is required'));

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
    });
    if (!number) return next(new AppError('Number not found', 404));

    const session = getSession(numberId);
    if (!session) return next(new AppError('Session not active', 400));

    const chat = await session.getChatById(channelId).catch(() => null);
    if (!chat) return next(new AppError('Channel not found', 404));

    // Basic analytics available from the chat object
    const analytics = {
      subscriberCount: chat.subscriberCount || 0,
      name:            chat.name,
      isAdmin:         chat.isAdmin || false,
    };

    return success(res, { analytics });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listChannels, getChannel, createChannel,
  updateChannel, postUpdate, getChannelAnalytics,
};
